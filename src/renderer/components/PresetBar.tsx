import { useTranslation } from 'react-i18next';
import type { PresetName } from '../../protocol/types';
import { PRESETS } from '../../protocol/types';
import { PRESET_COLORS } from '../constants';
import type { AppMode } from '../types';

interface PresetBarProps {
  selectedPreset: PresetName;
  mode: AppMode;
  loading: boolean;
  onSelectPreset: (preset: PresetName) => void;
  onModeChange: (mode: AppMode) => void;
}

export function PresetBar({ selectedPreset, mode, loading, onSelectPreset, onModeChange }: PresetBarProps) {
  const { t } = useTranslation();

  return (
    <div className="preset-bar">
      <div className="preset-selector">
        {PRESETS.map(p => (
          <button
            key={p}
            className={`preset-btn ${selectedPreset === p ? 'active' : ''}`}
            style={{ '--preset-color': PRESET_COLORS[p] } as React.CSSProperties}
            onClick={() => onSelectPreset(p)}
            disabled={loading || mode === 'advanced-live'}
          >
            <span className="preset-btn-letter">{p}</span>
          </button>
        ))}
      </div>
      <div className="mode-toggle">
        <button
          className={`mode-btn ${mode === 'preset' ? 'active' : ''}`}
          onClick={() => onModeChange('preset')}
        >
          {t('preset.modePreset')}
        </button>
        <button
          className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
          onClick={() => onModeChange('live')}
        >
          {t('preset.modeLive')}
        </button>
        <button
          className={`mode-btn ${mode === 'advanced-live' ? 'active' : ''}`}
          onClick={() => onModeChange('advanced-live')}
        >
          {t('preset.modeAdvancedLive')}
        </button>
      </div>
    </div>
  );
}
