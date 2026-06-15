import { useTranslation } from 'react-i18next';

interface StatusBarProps {
  status: string;
  statusType: 'info' | 'success' | 'error';
}

export function StatusBar({ status, statusType }: StatusBarProps) {
  const { t } = useTranslation();

  return (
    <div className="status-msg">
      <span className={`status-msg-dot ${statusType}`} />
      <span>{status || t('status.ready')}</span>
    </div>
  );
}
