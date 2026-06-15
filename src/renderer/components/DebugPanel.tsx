import { useTranslation } from 'react-i18next';

interface DebugPanelProps {
  showDebug: boolean;
  debugLog: string[];
  connected: boolean;
  onToggle: () => void;
  onClear: () => void;
  onScanIR: () => void;
}

export function DebugPanel({
  showDebug,
  debugLog,
  connected,
  onToggle,
  onClear,
  onScanIR,
}: DebugPanelProps) {
  const { t } = useTranslation();

  return (
    <details className="debug-section">
      <summary className="debug-summary" onClick={(e) => { e.preventDefault(); onToggle(); }}>
        <span className="debug-toggle">{showDebug ? '▼' : '▶'}</span>
        {t('debug.title')} {debugLog.length > 0 && `(${debugLog.length})`}
      </summary>
      <div className="debug-content">
        <div className="debug-actions">
          <button className="btn btn-xs btn-danger" onClick={onClear}>{t('debug.clear')}</button>
          <button className="btn btn-xs btn-secondary" onClick={onScanIR} disabled={!connected}>{t('debug.scan')}</button>
        </div>
        {debugLog.length > 0 && (
          <div className="debug-log">
            {debugLog.map((r, i) => <div key={i} className="debug-line">{r}</div>)}
          </div>
        )}
      </div>
    </details>
  );
}
