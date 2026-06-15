import { useTranslation } from 'react-i18next';

interface AppHeaderProps {
  connected: boolean;
  connecting: boolean;
  mode: 'live' | 'preset';
  onConnect: () => void;
  onDisconnect: () => void;
}

export function AppHeader({ connected, connecting, mode, onConnect, onDisconnect }: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-logo">
          <span className="app-logo-icon">◆</span>
          <h1>{t('app.title')}</h1>
          <span className={`app-badge ${mode}`}>{mode.toUpperCase()}</span>
        </div>
        <div className="app-header-sub">{t('app.editor')}</div>
      </div>
      <div className="app-header-right">
        <div className="status-indicator-mini">
          <span className={`status-dot-mini ${connected ? 'on' : 'off'}`} />
          <span className="status-text-mini">{connected ? t('app.connected') : t('app.offline')}</span>
        </div>
        {!connected ? (
          <button className="btn-connect" onClick={onConnect} disabled={connecting}>
            {connecting ? t('app.connecting') : t('app.connect')}
          </button>
        ) : (
          <button className="btn-disconnect" onClick={onDisconnect}>
            {t('app.disconnect')}
          </button>
        )}
      </div>
    </header>
  );
}
