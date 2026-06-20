export * from './types';
export * from './encode';
export * from './parser';

import type { Settings, ParameterName, PresetName } from './types';
import {
  ACTIVE_SETTINGS_ADDR, COMMAND_TYPE, SETTINGS_BASE_ADDR,
  PARAMETER_ADDRESS_OFFSET,
} from './types';
import type { Message } from './types';

export function presetSlotAddr(preset: PresetName): number {
  return preset === 'A' ? 0x0000 : preset === 'B' ? 0x0010 : 0x0020;
}

export function settingsToBytes(settings: Settings): Uint8Array {
  return new Uint8Array([
    settings.type,
    settings.gain,
    settings.tone,
    settings.reverb,
    settings.feedback,
    settings.volume,
    settings.time,
    settings.mix,
    settings.modulation,
    settings.cabinet,
    settings.irSection ? 1 : 0,
    settings.delaySection ? 1 : 0,
    settings.toneSection ? 1 : 0,
    0, 0, 0,
  ]);
}

export function bytesToSettings(data: Uint8Array): Settings {
  return {
    type: data[0],
    gain: data[1],
    tone: data[2],
    reverb: data[3],
    feedback: data[4],
    volume: data[5],
    time: data[6],
    mix: data[7],
    modulation: data[8],
    cabinet: data[9],
    irSection: data[10] > 0,
    delaySection: data[11] > 0,
    toneSection: data[12] > 0,
  };
}

export function buildReadPresetMessage(preset: PresetName): Message {
  const addr = presetSlotAddr(preset);
  return {
    type: 'ReadMemory',
    cmd: COMMAND_TYPE,
    addr,
    len: 16,
  };
}

export function buildWritePresetBytes(preset: PresetName, settings: Settings): Message {
  const addr = presetSlotAddr(preset);
  const data = settingsToBytes(settings);
  return {
    type: 'WriteMemory',
    cmd: COMMAND_TYPE,
    addr,
    len: 16,
    data,
  };
}

export function buildWriteActivePresetMessage(settings: Settings): Message {
  const data = settingsToBytes(settings);
  return {
    type: 'WriteMemory',
    cmd: COMMAND_TYPE,
    addr: ACTIVE_SETTINGS_ADDR,
    len: 16,
    data,
  };
}

export function buildWriteFlashPresetMessage(preset: PresetName, settings: Settings): Message {
  const offset = presetSlotAddr(preset);
  const addr = SETTINGS_BASE_ADDR + offset;
  const data = settingsToBytes(settings);
  return {
    type: 'WriteMemory',
    cmd: COMMAND_TYPE,
    addr,
    len: 16,
    data,
  };
}

export function buildWriteParameterMessage(preset: PresetName, param: ParameterName, value: number): Message {
  const addr = SETTINGS_BASE_ADDR + presetSlotAddr(preset) + PARAMETER_ADDRESS_OFFSET[param];
  return {
    type: 'WriteMemory',
    cmd: COMMAND_TYPE,
    addr,
    len: 1,
    data: new Uint8Array([value]),
  };
}

export function buildInitMessage(): Message {
  return { type: 'Init' };
}

export function buildMystery1Message(): Message {
  return { type: 'Mystery1' };
}

export function buildMystery2Message(): Message {
  return { type: 'Mystery2' };
}

// IR memory operations
import {
  IR_CMD_RAM, IR_CMD_ROM,
  IR_USABLE_ADDR, IR_DISTANCE_ADDR, IR_DATA_RAM_ADDR, IR_DATA_ROM_ADDR,
  IR_SLOT_SIZE, IR_ROM_SLOT_SIZE,
} from './types';

export function buildWriteIRRamMessage(data: Uint8Array, offset: number = 0): Message {
  return {
    type: 'WriteMemory',
    cmd: IR_CMD_RAM,
    addr: IR_DATA_RAM_ADDR + offset,
    len: data.length,
    data,
  };
}

export function buildReadIRRamMessage(len: number = IR_SLOT_SIZE, offset: number = 0): Message {
  return {
    type: 'ReadMemory',
    cmd: IR_CMD_RAM,
    addr: IR_DATA_RAM_ADDR + offset,
    len,
  };
}

export function buildSetIRDistanceMessage(distance: number): Message {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, distance, true);
  return {
    type: 'WriteMemory',
    cmd: IR_CMD_RAM,
    addr: IR_DISTANCE_ADDR,
    len: 4,
    data: new Uint8Array(buf),
  };
}

export function buildSetIRUsableMessage(usable: boolean): Message {
  return {
    type: 'WriteMemory',
    cmd: IR_CMD_RAM,
    addr: IR_USABLE_ADDR,
    len: 1,
    data: new Uint8Array([usable ? 1 : 0]),
  };
}

export function buildWriteIRRomMessage(slot: number, data: Uint8Array, offset: number = 0): Message {
  const addr = IR_DATA_ROM_ADDR + (slot * IR_ROM_SLOT_SIZE) + offset;
  return {
    type: 'WriteMemory',
    cmd: IR_CMD_ROM,
    addr,
    len: data.length,
    data,
  };
}

export function buildReadIRRomMessage(slot: number, len: number = IR_ROM_SLOT_SIZE, offset: number = 0): Message {
  const addr = IR_DATA_ROM_ADDR + (slot * IR_ROM_SLOT_SIZE) + offset;
  return {
    type: 'ReadMemory',
    cmd: IR_CMD_ROM,
    addr,
    len,
  };
}

export function buildEraseIRRomSectorMessage(slot: number): Message {
  const addr = IR_DATA_ROM_ADDR + (slot * IR_ROM_SLOT_SIZE);
  return {
    type: 'Erase',
    cmd: IR_CMD_ROM,
    addr,
  };
}

export function settingsToKnobValues(settings: Settings): KnobValues {
  return {
    type: settings.type,
    gain: settings.gain,
    tone: settings.tone,
    mod: settings.modulation,
    time: settings.time,
    fb: settings.feedback,
    mix: settings.mix,
    reverb: settings.reverb,
    ir_cab: settings.cabinet,
    volume: settings.volume,
    irSection: settings.irSection,
    delaySection: settings.delaySection,
    toneSection: settings.toneSection,
  };
}

export interface KnobValues {
  type: number;
  gain: number;
  tone: number;
  mod: number;
  time: number;
  fb: number;
  mix: number;
  reverb: number;
  ir_cab: number;
  volume: number;
  irSection: boolean;
  delaySection: boolean;
  toneSection: boolean;
}

export function knobValuesToSettings(knobs: KnobValues): Settings {
  // Ensure section B is ON if modulation (chorus/phaser) or delay (mix) is active.
  // Saved presets may have stale delaySection:false while having mod/mix set,
  // which would silently kill all of section B (modulation + delay).
  const modActive = knobs.mod !== 7;
  const delayActive = knobs.mix > 0;
  return {
    type: knobs.type,
    gain: knobs.gain,
    tone: knobs.tone,
    reverb: knobs.reverb,
    feedback: knobs.fb,
    volume: knobs.volume,
    time: knobs.time,
    mix: knobs.mix,
    modulation: knobs.mod,
    cabinet: knobs.ir_cab,
    irSection: knobs.irSection,
    delaySection: knobs.delaySection || modActive || delayActive,
    toneSection: knobs.toneSection,
  };
}

export function knobValueToParameterName(knobName: string): ParameterName {
  const mapping: Record<string, ParameterName> = {
    type: 'Type',
    gain: 'Gain',
    tone: 'Tone',
    reverb: 'Reverb',
    fb: 'Feedback',
    volume: 'Volume',
    time: 'Time',
    mix: 'Mix',
    mod: 'Modulation',
    ir_cab: 'Cabinet',
  };
  return mapping[knobName] ?? 'Volume';
}
