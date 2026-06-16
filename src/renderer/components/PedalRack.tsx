import { PedalVisual } from './PedalVisual';
import type { PedalId } from '../types';

const PEDALS: { id: PedalId; label: string; icon: string; stompable: boolean }[] = [
  { id: 'amp', label: 'AMP', icon: '⚡', stompable: true },
  { id: 'chorus', label: 'CHORUS', icon: '〰️', stompable: true },
  { id: 'phaser', label: 'PHASER', icon: '🌀', stompable: true },
  { id: 'delay', label: 'DELAY', icon: '⏱️', stompable: true },
  { id: 'reverb', label: 'REVERB', icon: '🌊', stompable: true },
  { id: 'ircab', label: 'IR CAB', icon: '📦', stompable: true },
  { id: 'volume', label: 'VOLUME', icon: '🔊', stompable: false },
];

interface PedalRackProps {
  pedalStates: Record<PedalId, boolean>;
  onToggle: (id: PedalId) => void;
}

export function PedalRack({ pedalStates, onToggle }: PedalRackProps) {
  return (
    <div className="pedal-rack">
      <div className="pedal-rack-label">SIGNAL CHAIN</div>
      <div className="pedal-rack-pedals">
        {PEDALS.map(p => (
          <PedalVisual
            key={p.id}
            id={p.id}
            label={p.label}
            icon={p.icon}
            isEnabled={pedalStates[p.id]}
            stompable={p.stompable}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
