import { useTranslation } from 'react-i18next';
import type { PresetName } from '../../protocol/types';
import type { KnobValues } from '../../protocol';
import type { ToolbarHandlers } from '../types';

interface ToolbarProps {
  isDirty: boolean;
  saving: boolean;
  loading: boolean;
  importing: boolean;
  undoCount: number;
  redoCount: number;
  selectedPreset: PresetName;
  handlers: ToolbarHandlers;
}

export function Toolbar({ isDirty, saving, loading, importing, undoCount, redoCount, handlers }: ToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="toolbar">
      <button
        className={`btn btn-primary btn-xs ${isDirty ? 'btn-dirty' : ''}`}
        onClick={handlers.onSave}
        disabled={saving || loading}
        title={`${t('preset.save')} (Ctrl+S)`}
      >
        {saving ? t('preset.saving') : isDirty ? `${t('preset.save')}*` : t('preset.save')}
      </button>
      {isDirty && <button className="btn btn-xs btn-revert" onClick={handlers.onRevert} title={t('preset.revert')}>↩</button>}
      <button className="btn btn-xs btn-undo" onClick={handlers.onUndo} disabled={undoCount === 0} title={`${t('preset.undo')} (Ctrl+Z)`}>↩</button>
      <button className="btn btn-xs btn-redo" onClick={handlers.onRedo} disabled={redoCount === 0} title={`${t('preset.redo')} (Ctrl+Shift+Z)`}>↪</button>
      <button className="btn btn-secondary btn-xs" onClick={handlers.onExportPreset} title={`${t('preset.export')} (Ctrl+E)`}>
        {t('preset.export')}
      </button>
      <button className="btn btn-secondary btn-xs" onClick={handlers.onExportBank} title={t('preset.bank')}>
        {t('preset.bank')}
      </button>
      <button className="btn btn-secondary btn-xs" onClick={handlers.onImport} disabled={importing} title={`${t('preset.import')} (Ctrl+I)`}>
        {importing ? t('preset.importing') : t('preset.import')}
      </button>
      <button className="btn btn-secondary btn-xs" onClick={handlers.onRefreshAll} title={t('preset.refresh')}>
        {t('preset.refresh')}
      </button>
      <button className="btn btn-xs btn-danger" onClick={handlers.onFactoryReset} title={t('preset.factoryReset')}>↺</button>
    </div>
  );
}
