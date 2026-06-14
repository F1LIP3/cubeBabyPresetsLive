import type { Message, Settings, PresetName, ParameterName } from '../protocol/types';
import { messageFromSysex, messageToSysex } from '../protocol/parser';
import {
  buildReadPresetMessage,
  buildWritePresetBytes,
  buildWriteActivePresetMessage,
  buildWriteFlashPresetMessage,
  buildWriteParameterMessage,
  bytesToSettings,
  settingsToBytes,
  buildInitMessage,
  knobValueToParameterName,
  presetSlotAddr,
  buildWriteIRRamMessage,
  buildReadIRRamMessage,
  buildSetIRDistanceMessage,
  buildWriteIRRomMessage,
  buildReadIRRomMessage,
  buildEraseIRRomSectorMessage,
  KnobValues,
} from '../protocol';
import { PARAMETER_NAMES, ACTIVE_SETTINGS_ADDR, COMMAND_TYPE, IR_WRITE_CHUNK_SIZE, IR_SLOT_SIZE, IR_ROM_SLOT_SIZE } from '../protocol/types';
import type { MidiService } from './midiService';
import { WebMidiService } from './webMidiService';
import { CapacitorMidiService } from './capacitorMidiService';

const CUBE_BABY_NAME_PREFIX = 'CUBE_BABY';

function toHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function messagesMatch(request: Message, response: Message): boolean {
  if (request.type === 'Init' && response.type === 'ACK') return true;
  if (request.type === 'RequestNameVersion' && response.type === 'NameVersion') return true;
  if (request.type === 'ReadMemory' && response.type === 'MemoryContent') {
    return response.cmd === request.cmd && response.addr === request.addr;
  }
  if (request.type === 'WriteMemory' && response.type === 'ACK') return true;
  if (request.type === 'Erase' && response.type === 'ACK') return true;
  if (request.type === 'Mystery1' && response.type === 'ACK') return true;
  if (request.type === 'Mystery2' && response.type === 'ACK') return true;
  if (request.type === 'MysteryWrite' && response.type === 'ACK') return true;
  return false;
}

interface PendingEntry {
  request: Message;
  resolve: (msg: Message) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function createMidiService(): MidiService {
  if (typeof Capacitor !== 'undefined' && Capacitor.isNative) {
    return new CapacitorMidiService();
  }
  return new WebMidiService();
}

export class CubeBabyMidi {
  private midiService: MidiService;
  private pending: PendingEntry[] = [];
  private _connected = false;
  private seq = 0;
  private _activePreset: PresetName = 'A';
  onUnsolicited: ((msg: Message) => void) | null = null;

  constructor() {
    this.midiService = createMidiService();
  }

  get connected(): boolean {
    return this._connected;
  }

  get activePreset(): PresetName {
    return this._activePreset;
  }

  async connect(): Promise<void> {
    this.midiService.setMessageHandler((data: Uint8Array) => {
      this.handleRawMidiData(data);
    });

    await this.midiService.connect();
    this._connected = true;

    const initResponse = await this.sendAndWait(buildInitMessage());
    console.log('Connected, init response:', initResponse);
  }

  disconnect(): void {
    this.clearAllPending();
    this.midiService.setMessageHandler(null);
    this.midiService.disconnect();
    this._connected = false;
  }

  private handleRawMidiData(raw: Uint8Array): void {
    console.log('RX hex:', toHex(raw));

    try {
      const msg = messageFromSysex(raw);
      console.log('RX parsed:', JSON.stringify(msg));

      const idx = this.pending.findIndex(e => messagesMatch(e.request, msg));
      if (idx !== -1) {
        const [entry] = this.pending.splice(idx, 1);
        clearTimeout(entry.timeout);
        entry.resolve(msg);
        return;
      }

      if (this.onUnsolicited) {
        this.onUnsolicited(msg);
      }
    } catch (err) {
      console.log('RX unparseable:', err);
    }
  }

  private clearAllPending(): void {
    for (const entry of this.pending) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Disconnected'));
    }
    this.pending = [];
  }

  send(msg: Message): void {
    if (!this._connected) throw new Error('Not connected');
    const sysex = messageToSysex(msg);
    this.seq++;
    console.log(`TX#${this.seq}:`, msg.type, 'hex:', toHex(sysex));
    this.midiService.send([...sysex]);
  }

  async sendAndWait(msg: Message, timeoutMs = 5000, retries = 3): Promise<Message> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            const idx = this.pending.findIndex(e => e.request === msg);
            if (idx !== -1) this.pending.splice(idx, 1);
            reject(new Error('Response timeout'));
          }, timeoutMs);

          this.pending.push({ request: msg, resolve, reject, timeout });
          this.send(msg);
        });
      } catch (error: any) {
        lastError = error;
        if (error.message !== 'Response timeout' || attempt === retries) {
          throw error;
        }
        if (attempt < retries) {
          console.log(`MIDI retry ${attempt + 1}/${retries} for ${msg.type}`);
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }
    
    throw lastError;
  }

  async readPreset(preset: PresetName): Promise<Settings> {
    const msg = buildReadPresetMessage(preset);
    const response = await this.sendAndWait(msg);
    if (response.type !== 'MemoryContent') {
      throw new Error(`Unexpected response: ${response.type}`);
    }
    return bytesToSettings(response.data);
  }

  async readAllPresets(): Promise<Record<PresetName, Settings>> {
    const a = await this.readPreset('A');
    const b = await this.readPreset('B');
    const c = await this.readPreset('C');
    return { A: a, B: b, C: c };
  }

  /** Switch the pedal's active preset.
   *  1. Write target data to slot A (0x80000000) — immediate sound change
   *  2. Write target data to 0x0000 with preset selector bits — updates LED */
  async switchPreset(preset: PresetName, targetSettings: Settings): Promise<void> {
    this._activePreset = preset;

    // 1. Write ALL parameters to slot A — fire-and-forget (no ACK wait)
    const paramToField: Record<string, keyof Settings> = {
      Type: 'type', Gain: 'gain', Tone: 'tone',
      Reverb: 'reverb', Feedback: 'feedback', Volume: 'volume',
      Time: 'time', Mix: 'mix', Modulation: 'modulation',
      Cabinet: 'cabinet',
      IRSection: 'irSection', DelaySection: 'delaySection', ToneSection: 'toneSection',
    };
    for (const paramName of PARAMETER_NAMES) {
      const field = paramToField[paramName];
      if (!field) continue;
      const raw = targetSettings[field];
      const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
      const msg = buildWriteParameterMessage('A', paramName as ParameterName, value);
      this.send(msg);
    }

    // 2. Write full settings to 0x0000 with preset selector bits — updates LED
    const data = settingsToBytes(targetSettings);
    const presetBits = preset === 'A' ? 0x00 : preset === 'B' ? 0x10 : 0x20;
    data[0] = (data[0] & 0xCF) | presetBits;
    const settingsMsg: Message = {
      type: 'WriteMemory',
      cmd: COMMAND_TYPE,
      addr: ACTIVE_SETTINGS_ADDR,
      len: 16,
      data,
    };
    this.send(settingsMsg);
  }

  async writeSingleKnob(knobName: string, value: number): Promise<void> {
    const paramName = knobValueToParameterName(knobName);
    // Always write to slot A — that's where the pedal physically reads from
    const msg = buildWriteParameterMessage('A', paramName, value);
    await this.sendAndWait(msg);
  }

  async toggleSection(section: 'A' | 'B' | 'C', on: boolean): Promise<void> {
    const paramName: ParameterName = section === 'A' ? 'IRSection' : section === 'B' ? 'DelaySection' : 'ToneSection';
    // Always write to slot A — that's where the pedal physically reads from
    const msg = buildWriteParameterMessage('A', paramName, on ? 1 : 0);
    await this.sendAndWait(msg);
  }

  async writeParameterLive(param: ParameterName, value: number): Promise<void> {
    // Always write to slot A — that's where the pedal physically reads from
    const msg = buildWriteParameterMessage('A', param, value);
    await this.sendAndWait(msg);
  }

  async applySettingsToDsp(settings: Settings): Promise<void> {
    const paramToField: Record<string, keyof Settings> = {
      Type: 'type', Gain: 'gain', Tone: 'tone',
      Reverb: 'reverb', Feedback: 'feedback', Volume: 'volume',
      Time: 'time', Mix: 'mix', Modulation: 'modulation',
      Cabinet: 'cabinet',
      IRSection: 'irSection', DelaySection: 'delaySection', ToneSection: 'toneSection',
    };
    for (const paramName of PARAMETER_NAMES) {
      const field = paramToField[paramName];
      if (!field) continue;
      const raw = settings[field];
      const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
      // Always write to slot A — that's where the pedal physically reads from
      await this.writeParameterLive(paramName as ParameterName, value);
    }
  }

  async writePreset(preset: PresetName, settings: Settings): Promise<void> {
    const msg = buildWritePresetBytes(preset, settings);
    await this.sendAndWait(msg);
  }

  async saveActivePresetToSlot(preset: PresetName, settings: Settings): Promise<void> {
    await this.writePreset(preset, settings);
  }

  async writePresetToFlash(preset: PresetName, settings: Settings): Promise<void> {
    const msg = buildWriteFlashPresetMessage(preset, settings);
    await this.sendAndWait(msg);
  }

  /** Send a raw MIDI CC message */
  sendCC(cc: number, value: number, channel = 0): void {
    if (!this._connected) throw new Error('Not connected');
    const msg = [0xB0 | (channel & 0x0F), cc & 0x7F, value & 0x7F];
    console.log('TX CC:', msg.map(b => b.toString(16)).join(' '));
    this.midiService.send(msg);
  }

  /** Send a MIDI Program Change message */
  sendProgramChange(program: number, channel = 0): void {
    if (!this._connected) throw new Error('Not connected');
    const msg = [0xC0 | (channel & 0x0F), program & 0x7F];
    console.log('TX PC:', msg.map(b => b.toString(16)).join(' '));
    this.midiService.send(msg);
  }

  /** Send raw MIDI bytes (for SysEx without our encoding, or any raw MIDI) */
  sendRawMidi(data: number[]): void {
    if (!this._connected) throw new Error('Not connected');
    console.log('TX RAW:', data.map(b => b.toString(16)).join(' '));
    this.midiService.send(data);
  }

  /** Send MMC SysEx: F0 7F 7F 06 <cmd> F7 */
  sendMMC(command: number): void {
    this.sendRawMidi([0xF0, 0x7F, 0x7F, 0x06, command & 0x7F, 0xF7]);
  }

  // ── IR operations ──

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  /** Write IR data (2048 bytes) to IR RAM in chunks for immediate effect */
  async writeIRToRam(irData: Uint8Array): Promise<void> {
    if (irData.length !== IR_SLOT_SIZE) {
      throw new Error(`Invalid IR RAM data length: expected ${IR_SLOT_SIZE} bytes, got ${irData.length}`);
    }
    const chunks = Math.ceil(irData.length / IR_WRITE_CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      const offset = i * IR_WRITE_CHUNK_SIZE;
      const end = Math.min(offset + IR_WRITE_CHUNK_SIZE, irData.length);
      const chunk = irData.slice(offset, end);
      const msg = buildWriteIRRamMessage(chunk, offset);
      await this.sendAndWait(msg);
      await this.sleep(100);
    }
  }

  /** Read IR data back from IR RAM in chunks for verification */
  async readIRFromRam(len: number = IR_SLOT_SIZE): Promise<Uint8Array> {
    const result = new Uint8Array(len);
    const chunks = Math.ceil(len / IR_WRITE_CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      const offset = i * IR_WRITE_CHUNK_SIZE;
      const chunkLen = Math.min(IR_WRITE_CHUNK_SIZE, len - offset);
      const msg = buildReadIRRamMessage(chunkLen, offset);
      const response = await this.sendAndWait(msg);
      if (response.type !== 'MemoryContent') {
        throw new Error(`Unexpected response: ${response.type}`);
      }
      result.set(response.data.slice(0, chunkLen), offset);
      await this.sleep(50);
    }
    return result;
  }

  /** Set IR distance (0.0 = close, 1.0 = far) */
  async setIRDistance(distance: number): Promise<void> {
    const msg = buildSetIRDistanceMessage(distance);
    await this.sendAndWait(msg);
  }

  /** Write IR data (4096 bytes) to ROM (persistent storage, slot 0-7) in chunks */
  async writeIRToRom(slot: number, irData: Uint8Array): Promise<void> {
    if (irData.length !== IR_ROM_SLOT_SIZE) {
      throw new Error(`Invalid IR ROM data length: expected ${IR_ROM_SLOT_SIZE} bytes, got ${irData.length}`);
    }
    const chunks = Math.ceil(irData.length / IR_WRITE_CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      const offset = i * IR_WRITE_CHUNK_SIZE;
      const end = Math.min(offset + IR_WRITE_CHUNK_SIZE, irData.length);
      const chunk = irData.slice(offset, end);
      const msg = buildWriteIRRomMessage(slot, chunk, offset);
      await this.sendAndWait(msg);
      await this.sleep(100);
    }
  }

  /** Read IR data from ROM (persistent storage, slot 0-7) in chunks */
  async readIRFromRom(slot: number, len: number = IR_ROM_SLOT_SIZE): Promise<Uint8Array> {
    const result = new Uint8Array(len);
    const chunks = Math.ceil(len / IR_WRITE_CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      const offset = i * IR_WRITE_CHUNK_SIZE;
      const chunkLen = Math.min(IR_WRITE_CHUNK_SIZE, len - offset);
      const msg = buildReadIRRomMessage(slot, chunkLen, offset);
      const response = await this.sendAndWait(msg);
      if (response.type !== 'MemoryContent') {
        throw new Error(`Unexpected response: ${response.type}`);
      }
      result.set(response.data.slice(0, chunkLen), offset);
      await this.sleep(50);
    }
    return result;
  }

  /** Erase IR sector in ROM before writing */
  async eraseIRRomSector(slot: number): Promise<void> {
    const msg = buildEraseIRRomSectorMessage(slot);
    await this.sendAndWait(msg);
  }
}
