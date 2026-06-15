import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VirtualPreset } from '../types';

interface VirtualPresetBarProps {
  virtualPresets: VirtualPreset[];
  selectedVirtualPresetId: string | null;
  mode: 'live' | 'preset';
  onSelectPreset: (id: string) => void;
  onAddPreset: () => void;
  onDeletePreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => void;
  onModeChange: (mode: 'live' | 'preset') => void;
}

export function VirtualPresetBar({
  virtualPresets, selectedVirtualPresetId, mode,
  onSelectPreset, onAddPreset, onDeletePreset, onRenamePreset, onModeChange,
}: VirtualPresetBarProps) {
  const { t } = useTranslation();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const selected = virtualPresets.find(p => p.id === selectedVirtualPresetId);
  const selectedValue = selected ? selected.id : (virtualPresets.length > 0 ? virtualPresets[0].id : '');

  const handleStartRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const handleFinishRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenamePreset(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className="preset-bar">
      <div className="virtual-preset-selector">
        <select
          className="virtual-preset-select"
          value={selectedValue}
          onChange={e => onSelectPreset(e.target.value)}
        >
          {virtualPresets.length === 0 && (
            <option value="">{t('virtual.noPresets')}</option>
          )}
          {virtualPresets.map(vp => (
            <option key={vp.id} value={vp.id}>
              {vp.name}
            </option>
          ))}
        </select>
        <div className="virtual-preset-actions">
          <button className="btn btn-xs btn-primary" onClick={onAddPreset} title={t('virtual.add')}>+</button>
          {selected && (
            <>
              {renamingId === selected.id ? (
                <input
                  className="vp-rename-input"
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={e => { if (e.key === 'Enter') handleFinishRename(); if (e.key === 'Escape') setRenamingId(null); }}
                  autoFocus
                  maxLength={32}
                />
              ) : (
                <button className="btn btn-xs" onClick={() => handleStartRename(selected.id, selected.name)} title={t('virtual.rename')}>✎</button>
              )}
              <button className="btn btn-xs btn-danger" onClick={() => onDeletePreset(selected.id)} title={t('virtual.delete')}>✕</button>
            </>
          )}
        </div>
        <span className="virtual-preset-count">{virtualPresets.length}/50</span>
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
      </div>
    </div>
  );
}
