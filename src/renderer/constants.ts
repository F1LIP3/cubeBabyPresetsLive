import type { KnobValues } from '../protocol';

export const cubeBabyModel = {
  id: 'cube-baby',
  name: 'Cube Baby',
  knobs: {
    type: [0, 8],
    gain: [0, 7],
    tone: [0, 15],
    mod: [0, 15],
    time: [0, 31],
    fb: [0, 127],
    mix: [0, 118],
    reverb: [0, 15],
    ir_cab: [0, 8],
    volume: [0, 127],
  },
};

export const PRESET_COLORS: Record<string, string> = {
  A: '#f39c12',
  B: '#2ecc71',
  C: '#3498db',
};

export const EMPTY_KNOBS: KnobValues = {
  type: 0, gain: 0, tone: 0, mod: 0, time: 0,
  fb: 0, mix: 0, reverb: 0, ir_cab: 0, volume: 0,
  irSection: true, delaySection: true, toneSection: true,
};

export const FACTORY_DEFAULT_KNOBS: KnobValues = {
  type: 0, gain: 4, tone: 8, mod: 7, time: 16,
  fb: 0, mix: 59, reverb: 8, ir_cab: 0, volume: 100,
  irSection: true, delaySection: true, toneSection: true,
};

export const MAX_UNDO_DEPTH = 30;
