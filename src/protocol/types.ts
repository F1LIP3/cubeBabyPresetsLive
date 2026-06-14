export const PARAMETER = {
  Type: 0,
  Gain: 1,
  Tone: 2,
  Reverb: 3,
  Feedback: 4,
  Volume: 5,
  Time: 6,
  Mix: 7,
  Modulation: 8,
  Cabinet: 9,
  IRSection: 0xa,
  DelaySection: 0xb,
  ToneSection: 0xc,
} as const;

export type ParameterName = keyof typeof PARAMETER;
export type ParameterValue = (typeof PARAMETER)[ParameterName];

export const PRESET = { A: 0, B: 0x10, C: 0x20 } as const;
export type PresetName = keyof typeof PRESET;
export type PresetOffset = (typeof PRESET)[PresetName];

export interface Settings {
  type: number;
  gain: number;
  tone: number;
  reverb: number;
  feedback: number;
  volume: number;
  time: number;
  mix: number;
  modulation: number;
  cabinet: number;
  irSection: boolean;
  delaySection: boolean;
  toneSection: boolean;
}

export const PARAMETER_NAMES: ParameterName[] = [
  'Type', 'Gain', 'Tone', 'Reverb', 'Feedback',
  'Volume', 'Time', 'Mix', 'Modulation', 'Cabinet',
  'IRSection', 'DelaySection', 'ToneSection',
];

export const PARAMETER_RANGES: Record<ParameterName, [number, number]> = {
  Cabinet: [0, 8],
  Gain: [0, 7],
  Tone: [0, 15],
  Reverb: [0, 15],
  Feedback: [0, 127],
  Volume: [0, 127],
  Time: [0, 31],
  Mix: [0, 118],
  Modulation: [0, 15],
  Type: [0, 8],
  IRSection: [0, 1],
  DelaySection: [0, 1],
  ToneSection: [0, 1],
};

export const PRESETS: PresetName[] = ['A', 'B', 'C'];

export const PARAMETER_ADDRESS_OFFSET: Record<ParameterName, number> = {
  Type: 0,
  Gain: 1,
  Tone: 2,
  Reverb: 3,
  Feedback: 4,
  Volume: 5,
  Time: 6,
  Mix: 7,
  Modulation: 8,
  Cabinet: 9,
  IRSection: 10,
  DelaySection: 11,
  ToneSection: 12,
};

export const SETTINGS_BASE_ADDR = 0x80000000;  // persistent preset storage (saved presets)
export const ACTIVE_SETTINGS_ADDR = 0x0000;     // current active settings (live preset)
export const COMMAND_TYPE = 0x05;

// IR memory map (from pferreir/cuvave-midi reverse engineering)
export const IR_CMD_RAM = 0x04;                 // cmd for IR RAM access
export const IR_CMD_ROM = 0x00;                 // cmd for IR ROM access
export const IR_USABLE_ADDR = 0x0764;           // IR usable flag (bool, 1 byte)
export const IR_DISTANCE_ADDR = 0x0768;         // IR Distance (float32, 4 bytes)
export const IR_DATA_RAM_ADDR = 0x076c;         // IR Data [RAM] start (2048 bytes)
export const IR_DATA_ROM_ADDR = 0x00069000;     // IR Data [ROM] start (8 IRs × 4096 bytes = 32KB)
export const IR_DATA_ROM_END = 0x00071000;      // IR Data [ROM] end
export const IR_SLOT_SIZE = 2048;               // RAM: 512 float32 samples = 2048 bytes
export const IR_ROM_SLOT_SIZE = 4096;           // ROM: 1024 float32 samples = 4096 bytes per cabinet
export const IR_SAMPLE_RATE = 48000;
export const IR_SAMPLES = 512;                  // float32 samples per IR (RAM)
export const IR_ROM_SAMPLES = 1024;             // float32 samples per IR cabinet (ROM)
export const IR_SLOT_COUNT = 8;                 // pedal has 8 IR cabinets
export const IR_WRITE_CHUNK_SIZE = 128;          // max bytes per WriteMemory message

export type Message =
  | { type: 'Init' }
  | { type: 'ACK'; value: boolean }
  | { type: 'WriteMemory'; cmd: number; addr: number; len: number; data: Uint8Array }
  | { type: 'ReadMemory'; cmd: number; addr: number; len: number }
  | { type: 'MemoryContent'; cmd: number; addr: number; len: number; data: Uint8Array }
  | { type: 'RequestNameVersion' }
  | { type: 'NameVersion'; name: string; mystery: Uint8Array }
  | { type: 'Erase'; cmd: number; addr: number }
  | { type: 'Mystery1' }
  | { type: 'Mystery2' }
  | { type: 'MysteryWrite'; reg: number; data: Uint8Array };
