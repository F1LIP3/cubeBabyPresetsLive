import { useCallback, useRef } from 'react';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  onChangeEnd?: (val: number) => void;
  disabled?: boolean;
  labelLeft?: string;
  labelRight?: string;
  marks?: { value: number; label: string }[];
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onChangeEnd,
  disabled = false,
  labelLeft,
  labelRight,
  marks,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const pct = ((value - min) / (max - min)) * 100;

  const getValue = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    let p = (clientX - rect.left) / rect.width;
    p = Math.max(0, Math.min(1, p));
    const raw = min + p * (max - min);
    return Math.max(min, Math.min(max, Math.round((raw - min) / step) * step + min));
  }, [min, max, step, value]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onChange(getValue(e.clientX));
  }, [disabled, getValue, onChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (disabled || !draggingRef.current) return;
    onChange(getValue(e.clientX));
  }, [disabled, getValue, onChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onChangeEnd?.(getValue(e.clientX));
  }, [getValue, onChangeEnd]);

  return (
    <div className={`slider ${disabled ? 'slider-disabled' : ''}`}>
      {labelLeft && <div className="slider-label slider-label-left">{labelLeft}</div>}
      <div
        ref={trackRef}
        className="slider-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div className="slider-fill" style={{ width: `${pct}%` }} />
        {marks?.map((m) => {
          const mpct = ((m.value - min) / (max - min)) * 100;
          return (
            <div
              key={m.value}
              className={`slider-mark ${value === m.value ? 'slider-mark-active' : ''}`}
              style={{ left: `${mpct}%` }}
            >
              <span className="slider-mark-label">{m.label}</span>
            </div>
          );
        })}
        <div className="slider-thumb" style={{ left: `${pct}%` }} />
      </div>
      {labelRight && <div className="slider-label slider-label-right">{labelRight}</div>}
    </div>
  );
}
