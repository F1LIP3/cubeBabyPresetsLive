import type { PedalId } from '../types';

interface PedalVisualProps {
  id: PedalId;
  label: string;
  icon: string;
  isEnabled: boolean;
  stompable: boolean;
  onToggle: (id: PedalId) => void;
}

export function PedalVisual({ id, label, icon, isEnabled, stompable, onToggle }: PedalVisualProps) {
  return (
    <div
      className={`pedal-visual ${isEnabled ? 'enabled' : 'disabled'} ${!stompable ? 'always-on' : ''}`}
      onClick={() => stompable && onToggle(id)}
    >
      {stompable && (
        <div className="pedal-visual-led">
          <div className={`pedal-visual-led-light ${isEnabled ? 'on' : 'off'}`} />
        </div>
      )}
      <div className="pedal-visual-icon">{icon}</div>
      <div className="pedal-visual-label">{label}</div>
      {stompable ? (
        <button
          className={`pedal-visual-stomp ${isEnabled ? 'on' : 'off'}`}
          onClick={(e) => { e.stopPropagation(); onToggle(id); }}
        >
          {isEnabled ? 'ON' : 'OFF'}
        </button>
      ) : (
        <div className="pedal-visual-always">ALWAYS</div>
      )}
    </div>
  );
}
