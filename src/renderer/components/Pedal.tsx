import { Slider } from './Slider';

interface Model {
  id: string;
  name: string;
  knobs: Record<string, [number, number]>;
}

import type { AppMode } from '../types';

interface PedalProps {
  model: Model;
  knobValues: Record<string, number>;
  sections: Record<string, boolean>;
  mode: AppMode;
  selectedPreset: string;
  onChange: (name: string, value: number) => void;
  onChangeEnd: (name: string, value: number) => void;
  onFootswitch: (section: 'A' | 'B' | 'C') => void;
  disabled?: boolean;
}

const AMP_TYPES = [
  'P-Zone Clean', 'US Gold 100', 'Two Stone OD',
  'Doctor3 B', 'Cali JP A', 'Day Tripper',
  'Shittcow Dist', 'Wo Stone OD', 'Mr Smith Dist',
];

const IR_CABS = [
  'IR Off',
  'Line 6 Vetta 2×12',
  'Marshall 1960AV 4×12',
  'Marshall 1960A T75 4×12',
  'VHT Deliverance 2×12',
  'Soldano 2×12',
  'Peavey 5150+Mesa 4×12',
  'JSX + Mesa C1000 4×12',
  'Diezel V30 SM57 4×12',
];

const FOOTSWITCHES: { section: 'A' | 'B' | 'C'; label: string; liveLabel: string; presetLabel: string }[] = [
  { section: 'A', label: 'IR+REV', liveLabel: 'IR+REV', presetLabel: 'PRESET A' },
  { section: 'B', label: 'MOD+DLY', liveLabel: 'MOD+DLY', presetLabel: 'PRESET B' },
  { section: 'C', label: 'AMP', liveLabel: 'AMP', presetLabel: 'PRESET C' },
];

export function Pedal({ model, knobValues, sections, mode, selectedPreset, onChange, onChangeEnd, onFootswitch, disabled = false }: PedalProps) {
  return (
    <div className="pedal">
      <div className="pedal-card pedal-card-highlight">
        <div className="pedal-card-header">
          <span className="pedal-card-icon">⚡</span>
          PREAMP
        </div>
        <div className="pedal-card-body">
          <div className="pedal-row">
            <div className="pedal-label">AMP TYPE</div>
            <select
              className="pedal-select"
              value={knobValues.type ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange('type', v);
                onChangeEnd('type', v);
              }}
              disabled={disabled}
            >
              {AMP_TYPES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>
          <Slider
            value={knobValues.gain ?? 0}
            min={0}
            max={7}
            onChange={(v) => onChange('gain', v)}
            onChangeEnd={(v) => onChangeEnd('gain', v)}
            disabled={disabled}
            labelLeft="CLEAN"
            labelRight="GAIN"
          />
          <Slider
            value={knobValues.tone ?? 0}
            min={0}
            max={15}
            onChange={(v) => onChange('tone', v)}
            onChangeEnd={(v) => onChangeEnd('tone', v)}
            disabled={disabled}
            labelLeft="DARK"
            labelRight="BRIGHT"
          />
        </div>
      </div>

      <div className="pedal-card">
        <div className="pedal-card-header">
          <span className="pedal-card-icon">〰️</span>
          MODULATION
        </div>
        <div className="pedal-card-body">
          <Slider
            value={knobValues.mod ?? 0}
            min={0}
            max={15}
            onChange={(v) => onChange('mod', v)}
            onChangeEnd={(v) => onChangeEnd('mod', v)}
            disabled={disabled}
            marks={[
              { value: 0, label: 'CHORUS' },
              { value: 7, label: 'OFF' },
              { value: 15, label: 'PHASER' },
            ]}
          />
          <Slider
            value={knobValues.time ?? 0}
            min={0}
            max={31}
            onChange={(v) => onChange('time', v)}
            onChangeEnd={(v) => onChangeEnd('time', v)}
            disabled={disabled}
            labelLeft="SHORT"
            labelRight="LONG"
          />
          <Slider
            value={knobValues.fb ?? 0}
            min={0}
            max={127}
            onChange={(v) => onChange('fb', v)}
            onChangeEnd={(v) => onChangeEnd('fb', v)}
            disabled={disabled}
            labelLeft="FB MIN"
            labelRight="FB MAX"
          />
          <Slider
            value={knobValues.mix ?? 0}
            min={0}
            max={118}
            onChange={(v) => onChange('mix', v)}
            onChangeEnd={(v) => onChangeEnd('mix', v)}
            disabled={disabled}
            labelLeft="DRY"
            labelRight="WET"
          />
        </div>
      </div>

      <div className="pedal-card">
        <div className="pedal-card-header">
          <span className="pedal-card-icon">🌊</span>
          AMBIENCE
        </div>
        <div className="pedal-card-body">
          <Slider
            value={knobValues.reverb ?? 0}
            min={0}
            max={15}
            onChange={(v) => onChange('reverb', v)}
            onChangeEnd={(v) => onChangeEnd('reverb', v)}
            disabled={disabled}
            labelLeft="MIN"
            labelRight="+REVERB"
          />
          <div className="pedal-row">
            <div className="pedal-label">IR CAB</div>
            <select
              className="pedal-select"
              value={knobValues.ir_cab ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange('ir_cab', v);
                onChangeEnd('ir_cab', v);
              }}
              disabled={disabled}
            >
              {IR_CABS.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>
          <Slider
            value={knobValues.volume ?? 0}
            min={0}
            max={127}
            onChange={(v) => onChange('volume', v)}
            onChangeEnd={(v) => onChangeEnd('volume', v)}
            disabled={disabled}
            labelLeft="MIN"
            labelRight="MAX VOL"
          />
        </div>
      </div>

      <div className="pedal-card footswitch-card">
        <div className="pedal-card-header">
          <span className="pedal-card-icon">👟</span>
          {mode === 'preset' ? 'PRESET SELECT' : 'EFFECT BANKS'}
        </div>
        <div className="pedal-card-body">
          <div className="pedal-footswitches">
            {FOOTSWITCHES.map(({ section, label, liveLabel, presetLabel }) => {
              const isActive = mode === 'preset'
                ? selectedPreset === section
                : sections[section];
              return (
                <button
                  key={section}
                  className={`pedal-footswitch ${isActive ? 'on' : 'off'}`}
                  onClick={() => onFootswitch(section)}
                  title={mode === 'preset' ? `Select preset ${section}` : `Toggle ${label}`}
                >
                  <span className="pedal-footswitch-label">
                    {mode === 'preset' ? presetLabel : liveLabel}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="pedal-footswitch-hint">
            {mode === 'preset'
              ? 'Select a preset to view and edit'
              : 'Toggle effect banks (write to pedal)'}
          </div>
        </div>
      </div>
    </div>
  );
}
