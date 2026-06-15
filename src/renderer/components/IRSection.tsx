import { useTranslation } from 'react-i18next';
import { IR_SLOT_COUNT, IR_ROM_SLOT_SIZE } from '../../protocol/types';
import type { IRSectionHandlers } from '../types';

interface IRSectionProps {
  irSlot: number;
  irName: string;
  irStatus: 'idle' | 'processing' | 'erasing' | 'writing' | 'verifying' | 'done' | 'error';
  irProgress: { current: number; total: number };
  irDistance: number;
  irFile: File | null;
  irPreprocessed: Float32Array | null;
  irNames: Record<number, string>;
  connected: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  onSlotChange: (slot: number) => void;
  onNameChange: (name: string) => void;
  onDistanceChange: (dist: number) => void;
  handlers: IRSectionHandlers;
}

export function IRSection({
  irSlot, irName, irStatus, irProgress, irDistance, irFile,
  irPreprocessed, irNames, connected, open,
  onToggle, onSlotChange, onNameChange, onDistanceChange,
  handlers,
}: IRSectionProps) {
  const { t } = useTranslation();
  const connectedAndReady = connected && irStatus !== 'processing' && irStatus !== 'writing' && irStatus !== 'erasing';

  return (
    <details className="ir-lab" open={open} onToggle={e => onToggle((e.target as HTMLDetailsElement).open)}>
      <summary className="ir-lab-summary">
        <span className="ir-lab-toggle">▼</span>
        {t('ir.title')}
      </summary>
      <div className="ir-lab-content">
        <div className="ir-upload-section">
          <div className="ir-upload-row">
            <button className="btn btn-xs btn-primary" onClick={handlers.onSelectFile} disabled={irStatus === 'processing'}>
              {irFile ? t('ir.changeFile') : t('ir.selectFile')}
            </button>
            <span className="ir-file-name">{irFile ? irFile.name : t('ir.noFile')}</span>
          </div>
          {irPreprocessed && (
            <div className="ir-upload-preview">
              <span className="ir-preview-text">{t('ir.processed', { samples: 512, peak: Math.max(...Array.from(irPreprocessed).map(Math.abs)).toFixed(3) })}</span>
            </div>
          )}
          <div className="ir-upload-row">
            <label className="ir-label">{t('ir.slot')}</label>
            <select className="ir-select" value={irSlot} onChange={e => onSlotChange(Number(e.target.value))} disabled={!connectedAndReady}>
              {Array.from({ length: IR_SLOT_COUNT }, (_, i) => (
                <option key={i} value={i}>{t('ir.slotOption', { number: i + 1 })}{irNames[i] ? ` — ${irNames[i]}` : ''}</option>
              ))}
            </select>
            <button className="btn btn-xs" onClick={handlers.onDownloadBackup} disabled={!connected || irStatus === 'processing' || irStatus === 'writing'} title={t('ir.backup')}>
              {t('ir.backup')}
            </button>
          </div>
          <div className="ir-upload-row">
            <label className="ir-label">{t('ir.dist')}</label>
            <input className="ir-range" type="range" min="0" max="1" step="0.01" value={irDistance} onChange={e => onDistanceChange(parseFloat(e.target.value))} disabled={!connectedAndReady} />
            <span className="ir-range-value">{irDistance.toFixed(2)}</span>
          </div>
          <div className="ir-upload-row">
            <label className="ir-label">{t('ir.name')}</label>
            <input className="ir-input" type="text" value={irName} onChange={e => onNameChange(e.target.value)} placeholder={t('ir.namePlaceholder', { number: irSlot + 1 })} maxLength={32} disabled={!connectedAndReady} />
          </div>
          <div className="ir-upload-row">
            <button
              className="btn btn-primary btn-sm"
              onClick={handlers.onUpload}
              disabled={!irPreprocessed || !connected || irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'}
            >
              {irStatus === 'erasing' ? t('ir.erasing') :
               irStatus === 'writing' ? `${Math.round(irProgress.current / irProgress.total * 100)}%` :
               irStatus === 'verifying' ? t('ir.verifying') :
               irStatus === 'done' ? t('ir.done') :
               t('ir.upload')}
            </button>
            {(irStatus === 'writing' || irStatus === 'erasing' || irStatus === 'verifying') && (
              <div className="ir-progress-bar">
                <div className="ir-progress-fill" style={{ width: `${(irProgress.current / irProgress.total) * 100}%` }} />
              </div>
            )}
          </div>
        </div>

        {Object.keys(irNames).length > 0 && (
          <div className="ir-names-list">
            {Array.from({ length: IR_SLOT_COUNT }, (_, i) => irNames[i] ? (
              <div key={i} className="ir-name-entry" onClick={() => handlers.onLoadSlot(i)} title={t('ir.clickToLoad')}>
                <span className="ir-name-slot">{t('ir.slotLabel', { number: i + 1 })}</span>
                <span className="ir-name-label">{irNames[i]}</span>
                <button className="btn btn-xs btn-danger" onClick={e => { e.stopPropagation(); handlers.onDeleteName(i); }} title={t('ir.removeName')}>✕</button>
              </div>
            ) : null)}
          </div>
        )}
      </div>
    </details>
  );
}
