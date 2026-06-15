import { useTranslation } from 'react-i18next';

interface HelpModalProps {
  show: boolean;
  onClose: () => void;
}

export function HelpModal({ show, onClose }: HelpModalProps) {
  const { t } = useTranslation();
  if (!show) return null;

  return (
    <div className="help-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="help-modal">
        <button className="btn btn-xs btn-danger" onClick={onClose} title={t('help.close')}>?</button>
        <h2>{t('help.appTitle')}</h2>
        <p className="help-desc">{t('help.appDesc')}</p>

        <h3>{t('help.features')}</h3>
        <ul className="help-features">
          <li>{t('help.feature1')}</li>
          <li>{t('help.feature2')}</li>
          <li>{t('help.feature3')}</li>
          <li>{t('help.feature4')}</li>
          <li>{t('help.feature5')}</li>
          <li>{t('help.feature6')}</li>
        </ul>

        <h3>{t('help.irTitle')}</h3>
        <p>{t('help.irDesc')}</p>
        <ul className="help-features">
          <li>{t('help.irFeature1')}</li>
          <li>{t('help.irFeature2')}</li>
          <li>{t('help.irFeature3')}</li>
          <li>{t('help.irFeature4')}</li>
        </ul>

        <h3>{t('help.protocol')}</h3>
        <p dangerouslySetInnerHTML={{ __html: t('help.protocolDesc', { link: '<a href="https://github.com/pferreir/cuvave-midi" target="_blank" rel="noopener noreferrer">pferreir/cuvave-midi</a>' }) }} />
        <p dangerouslySetInnerHTML={{ __html: t('help.protocolDoc', { file: '<code>knowledge_base.md</code>' }) }} />

        <h3>{t('help.hardware')}</h3>
        <p>{t('help.hardwareDesc')}</p>

        <h3>{t('help.version')}</h3>
        <p>v0.3.2 — {t('help.license')}</p>
      </div>
    </div>
  );
}
