import { useState } from 'react';
import { Slider } from './Slider';
import type { PedalId, PedalParameters } from '../types';

interface PedalControlsProps {
  pedalParams: PedalParameters;
  pedalStates: Record<PedalId, boolean>;
  onPedalParamChange: <K extends keyof PedalParameters>(pedal: K, param: keyof PedalParameters[K], value: number) => void;
  onPedalParamChangeEnd: (pedal: string, param: string, value: number) => void;
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

export function PedalControls({ pedalParams, pedalStates, onPedalParamChange, onPedalParamChangeEnd, disabled = false }: PedalControlsProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const card = (id: PedalId, icon: string, label: string, body: React.ReactNode) => {
    const isBypassed = id !== 'volume' && !pedalStates[id];
    const isCollapsed = collapsed[id];
    return (
      <div className={`pedal-card ${isBypassed ? 'pedal-card-bypassed' : ''} ${isCollapsed ? 'pedal-card-collapsed' : ''}`}>
        <button className="pedal-card-header" onClick={() => toggleCollapse(id)}>
          <span className="pedal-card-collapse-icon">{isCollapsed ? '▸' : '▾'}</span>
          <span className="pedal-card-icon">{icon}</span>
          {label} {isBypassed && <span className="pedal-controls-bypassed">(OFF)</span>}
        </button>
        <div className="pedal-card-body">{body}</div>
      </div>
    );
  };

  return (
    <div className="pedal">
      <div className="pedal-controls-grid">
        {card('amp', '⚡', 'AMP', (
          <>
            <div className="pedal-row">
              <div className="pedal-label">TYPE</div>
              <select
                className="pedal-select"
                value={pedalParams.amp.type}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onPedalParamChange('amp', 'type', v);
                  onPedalParamChangeEnd('amp', 'type', v);
                }}
                disabled={disabled || !pedalStates.amp}
              >
                {AMP_TYPES.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            </div>
            <Slider
              value={pedalParams.amp.gain}
              min={0}
              max={7}
              onChange={(v) => onPedalParamChange('amp', 'gain', v)}
              onChangeEnd={(v) => { onPedalParamChange('amp', 'gain', v); onPedalParamChangeEnd('amp', 'gain', v); }}
              disabled={disabled || !pedalStates.amp}
              labelLeft="CLEAN"
              labelRight="GAIN"
            />
            <Slider
              value={pedalParams.amp.tone}
              min={0}
              max={15}
              onChange={(v) => onPedalParamChange('amp', 'tone', v)}
              onChangeEnd={(v) => { onPedalParamChange('amp', 'tone', v); onPedalParamChangeEnd('amp', 'tone', v); }}
              disabled={disabled || !pedalStates.amp}
              labelLeft="DARK"
              labelRight="BRIGHT"
            />
          </>
        ))}

        {card('chorus', '〰️', 'CHORUS', (
          <Slider
            value={pedalParams.chorus.level}
            min={0}
            max={6}
            onChange={(v) => onPedalParamChange('chorus', 'level', v)}
            onChangeEnd={(v) => { onPedalParamChange('chorus', 'level', v); onPedalParamChangeEnd('chorus', 'level', v); }}
            disabled={disabled || !pedalStates.chorus}
            labelLeft="MIN"
            labelRight="MAX"
          />
        ))}

        {card('phaser', '🌀', 'PHASER', (
          <Slider
            value={pedalParams.phaser.level}
            min={0}
            max={6}
            onChange={(v) => onPedalParamChange('phaser', 'level', v)}
            onChangeEnd={(v) => { onPedalParamChange('phaser', 'level', v); onPedalParamChangeEnd('phaser', 'level', v); }}
            disabled={disabled || !pedalStates.phaser}
            labelLeft="MIN"
            labelRight="MAX"
          />
        ))}

        {card('delay', '⏱️', 'DELAY', (
          <>
            <Slider
              value={pedalParams.delay.time}
              min={0}
              max={31}
              onChange={(v) => onPedalParamChange('delay', 'time', v)}
              onChangeEnd={(v) => { onPedalParamChange('delay', 'time', v); onPedalParamChangeEnd('delay', 'time', v); }}
              disabled={disabled || !pedalStates.delay}
              labelLeft="SHORT"
              labelRight="LONG"
            />
            <Slider
              value={pedalParams.delay.fb}
              min={0}
              max={127}
              onChange={(v) => onPedalParamChange('delay', 'fb', v)}
              onChangeEnd={(v) => { onPedalParamChange('delay', 'fb', v); onPedalParamChangeEnd('delay', 'fb', v); }}
              disabled={disabled || !pedalStates.delay}
              labelLeft="FB MIN"
              labelRight="FB MAX"
            />
            <Slider
              value={pedalParams.delay.mix}
              min={0}
              max={118}
              onChange={(v) => onPedalParamChange('delay', 'mix', v)}
              onChangeEnd={(v) => { onPedalParamChange('delay', 'mix', v); onPedalParamChangeEnd('delay', 'mix', v); }}
              disabled={disabled || !pedalStates.delay}
              labelLeft="DRY"
              labelRight="WET"
            />
          </>
        ))}

        {card('reverb', '🌊', 'REVERB', (
          <Slider
            value={pedalParams.reverb.reverb}
            min={0}
            max={15}
            onChange={(v) => onPedalParamChange('reverb', 'reverb', v)}
            onChangeEnd={(v) => { onPedalParamChange('reverb', 'reverb', v); onPedalParamChangeEnd('reverb', 'reverb', v); }}
            disabled={disabled || !pedalStates.reverb}
            labelLeft="MIN"
            labelRight="+REVERB"
          />
        ))}

        {card('ircab', '📦', 'IR CAB', (
          <div className="pedal-row">
            <div className="pedal-label">CAB</div>
            <select
              className="pedal-select"
              value={pedalParams.ircab.slot}
              onChange={(e) => {
                const v = Number(e.target.value);
                onPedalParamChange('ircab', 'slot', v);
                onPedalParamChangeEnd('ircab', 'slot', v);
              }}
              disabled={disabled || !pedalStates.ircab}
            >
              {IR_CABS.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>
        ))}

        {card('volume', '🔊', 'VOLUME', (
          <Slider
            value={pedalParams.volume.level}
            min={0}
            max={127}
            onChange={(v) => onPedalParamChange('volume', 'level', v)}
            onChangeEnd={(v) => { onPedalParamChange('volume', 'level', v); onPedalParamChangeEnd('volume', 'level', v); }}
            disabled={disabled}
            labelLeft="MIN"
            labelRight="MAX"
          />
        ))}
      </div>
    </div>
  );
}
