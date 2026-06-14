import { useMemo, useCallback, useRef } from 'react';

interface KnobProps {
  size?: number;
  min?: number;
  max?: number;
  numTicks?: number;
  degrees?: number;
  value?: number;
  onChange: (val: number) => void;
  disabled?: boolean;
  label?: string;
}

function convertRange(
  oldMin: number, oldMax: number,
  newMin: number, newMax: number,
  oldValue: number
): number {
  return ((oldValue - oldMin) * (newMax - newMin)) / (oldMax - oldMin) + newMin;
}

export function Knob({
  size = 45,
  min = 0,
  max = 127,
  numTicks = 0,
  degrees = 260,
  value = 0,
  disabled = false,
  onChange,
  label,
}: KnobProps) {
  const fullAngle = degrees;
  const startAngle = (360 - degrees) / 2;
  const endAngle = startAngle + degrees;
  const knobRef = useRef<HTMLDivElement>(null);

  const deg = useMemo(
    () => Math.floor(convertRange(min, max, startAngle, endAngle, value)),
    [min, max, startAngle, endAngle, value]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const knob = knobRef.current;
    if (!knob) return;

    const rect = knob.getBoundingClientRect();
    const pts = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    const handleMouseMove = (me: MouseEvent) => {
      const x = me.clientX - pts.x;
      const y = me.clientY - pts.y;
      let currentDeg = (Math.atan2(y, x) * 180) / Math.PI;
      currentDeg = (currentDeg + 360) % 360;
      currentDeg = Math.min(Math.max(startAngle, currentDeg), endAngle);
      const newValue = Math.round(convertRange(startAngle, endAngle, min, max, currentDeg));
      onChange(Math.max(min, Math.min(max, newValue)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [startAngle, endAngle, min, max, onChange]);

  const ticks = useMemo(() => {
    if (!numTicks) return [];
    const incr = fullAngle / numTicks;
    const tickSize = size / 2;
    const result = [];
    for (let d = startAngle; d <= endAngle; d += incr) {
      result.push({
        deg: d,
        style: {
          height: tickSize + 6,
          left: tickSize - 2,
          top: tickSize,
          transform: `rotate(${d}deg)`,
          transformOrigin: 'top',
        },
      });
    }
    return result;
  }, [numTicks, fullAngle, startAngle, endAngle, size]);

  return (
    <div className="knob-wrapper" style={{ textAlign: 'center' }}>
      <div
        ref={knobRef}
        style={{ width: size, height: size, position: 'relative', cursor: disabled ? 'default' : 'pointer' }}
      >
        {ticks.map((tick, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              background: 'transparent',
              width: 4,
              ...tick.style,
            }}
          >
            <div style={{
              position: 'absolute',
              bottom: 0,
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: '#888',
            }} />
          </div>
        ))}
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            border: '2px solid #666',
            background: '#444',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onMouseDown={disabled ? undefined : handleMouseDown}
        >
          <div
            style={{
              width: size * 0.6,
              height: size * 0.6,
              borderRadius: '50%',
              background: '#333',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              transform: `rotate(${deg}deg)`,
            }}
          >
            <div style={{
              width: '8.33%',
              height: '20%',
              background: '#ccc',
              marginBottom: 2,
              borderRadius: 1,
            }} />
          </div>
        </div>
      </div>
      {label && (
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#ccc',
          marginTop: 4,
          textTransform: 'uppercase',
        }}>
          {label}
        </div>
      )}
    </div>
  );
}
