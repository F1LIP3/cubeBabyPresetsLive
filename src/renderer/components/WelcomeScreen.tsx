import { useTranslation } from 'react-i18next';
import LanguageSelector from './LanguageSelector';
import type { MidiDeviceInfo } from '../../midi/midiService';

interface WelcomeScreenProps {
  connecting: boolean;
  status: string;
  statusType: 'info' | 'success' | 'error';
  midiDevices: MidiDeviceInfo[];
  selectedMidiDeviceId: string;
  onConnect: () => void;
  onDeviceChange: (id: string) => void;
}

export function WelcomeScreen({
  connecting,
  status,
  statusType,
  midiDevices,
  selectedMidiDeviceId,
  onConnect,
  onDeviceChange,
}: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="welcome">
      <div className="welcome-icon">◆</div>
      <h2>{t('welcome.title')}</h2>
      <p>{t('welcome.desc')}</p>
      <ul className="welcome-features">
        <li>{t('welcome.feature1')}</li>
        <li>{t('welcome.feature2')}</li>
        <li>{t('welcome.feature3')}</li>
        <li>{t('welcome.feature4')}</li>
      </ul>
      {midiDevices.length > 1 && (
        <div className="welcome-midi-devices">
          <label>{t('welcome.midiDevice')}: </label>
          <select className="pedal-select welcome-select" value={selectedMidiDeviceId} onChange={e => onDeviceChange(e.target.value)}>
            {midiDevices.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}
      {midiDevices.length === 0 && !connecting && (
        <p className="welcome-no-devices">{t('welcome.noMidiDevices')}</p>
      )}
      <div className="welcome-language">
        <label>{t('welcome.language')}: </label>
        <LanguageSelector />
      </div>
      <button className="btn-connect btn-connect-large" onClick={onConnect} disabled={connecting}>
        {connecting ? t('app.connecting') : t('app.connect')}
      </button>
      {status && (
        <div className={`status-msg welcome-status ${statusType}`}>
          <span className={`status-msg-dot ${statusType}`} />
          <span>{status}</span>
        </div>
      )}
    </div>
  );
}
