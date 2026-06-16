import { useTranslation } from 'react-i18next';
import type { PresetName } from '../../protocol/types';
import type { ToolbarHandlers, PresetBank } from '../types';

interface ToolbarProps {
  isDirty: boolean;
  saving: boolean;
  loading: boolean;
  importing: boolean;
  undoCount: number;
  redoCount: number;
  presetBank: PresetBank;
  handlers: ToolbarHandlers;
}

export function Toolbar({ isDirty, saving, loading, importing, undoCount, redoCount, presetBank, handlers }: ToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="toolbar">
      <div className="toolbar-primary">
        <button
          className={`btn btn-primary ${isDirty ? 'btn-dirty' : ''}`}
          onClick={handlers.onSave}
          disabled={saving || loading}
          title={`${t('preset.save')} (Ctrl+S)`}
        >
          {saving ? t('preset.saving') : isDirty ? `${t('preset.save')}*` : t('preset.save')}
        </button>
        {isDirty && <button className="btn btn-revert" onClick={handlers.onRevert} title={t('preset.revert')}>↩</button>}
      </div>
      <div className="toolbar-secondary">
        <button className="btn btn-undo" onClick={handlers.onUndo} disabled={undoCount === 0} title={`${t('preset.undo')} (Ctrl+Z)`}>↩</button>
        <button className="btn btn-redo" onClick={handlers.onRedo} disabled={redoCount === 0} title={`${t('preset.redo')} (Ctrl+Shift+Z)`}>↪</button>
        <button className="btn btn-export" onClick={handlers.onExportPreset} title={`${t('preset.export')} (Ctrl+E)`}>{t('preset.export')}</button>
        {presetBank === 'hardware' && (
          <button className="btn btn-export" onClick={handlers.onExportBank} title={t('preset.bank')}>{t('preset.bank')}</button>
        )}
        <button className="btn btn-import" onClick={handlers.onImport} disabled={importing} title={`${t('preset.import')} (Ctrl+I)`}>
          {importing ? t('preset.importing') : t('preset.import')}
        </button>
        {presetBank === 'hardware' && (
          <button className="btn btn-refresh" onClick={handlers.onRefreshAll} title={t('preset.refresh')}>↻</button>
        )}
        <button className="btn btn-danger" onClick={handlers.onFactoryReset} title={t('preset.factoryReset')}>↺</button>
      </div>
    </div>
  );
}
