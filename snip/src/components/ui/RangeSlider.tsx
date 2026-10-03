import { useRef } from "react";

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Al empezar y terminar de arrastrar (para que el arrastre sea un solo paso de deshacer). */
  onStart?: () => void;
  onEnd?: () => void;
  label: string;
  /** Doble click: vuelve a este valor. */
  resetTo?: number;
  /** Marca del valor "neutro" (centro en sliders bipolares). */
  origin?: number;
  testId?: string;
  disabled?: boolean;
  /** Mapeo no lineal (por ejemplo, la velocidad en escala logarítmica). */
  toPos?: (v: number) => number;
  fromPos?: (p: number) => number;
}

/** Slider de Fluent con rango, paso, doble click para resetear y teclado. */
export function RangeSlider({ value, min, max, step = 0.01, onChange, onStart, onEnd, label, resetTo, origin, testId, disabled, toPos, fromPos }: RangeSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const pos = (v: number) => (toPos ? toPos(v) : (v - min) / (max - min));
  const val = (p: number) => (fromPos ? fromPos(p) : min + p * (max - min));
  const clampStep = (v: number) => {
    const s = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, Number(s.toFixed(6))));
  };
  const fromEvent = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return value;
    return clampStep(val(Math.min(1, Math.max(0, (clientX - r.left) / r.width))));
  };
  const p = Math.min(1, Math.max(0, pos(value)));
  const o = origin !== undefined ? Math.min(1, Math.max(0, pos(origin))) : 0;
  const lo = Math.min(p, o);
  const hi = Math.max(p, o);
  return (
    <div
      ref={track}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 1000) / 1000}
      aria-disabled={disabled}
      data-testid={testId}
      className={`slider group relative flex h-8 w-full cursor-default items-center outline-none ${disabled ? "pointer-events-none opacity-40" : ""}`}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onStart?.();
        onChange(fromEvent(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) onChange(fromEvent(e.clientX));
      }}
      onPointerUp={() => onEnd?.()}
      onPointerCancel={() => onEnd?.()}
      onDoubleClick={() => {
        if (resetTo !== undefined) {
          onStart?.();
          onChange(resetTo);
          onEnd?.();
        }
      }}
      onKeyDown={(e) => {
        const big = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          onChange(clampStep(value - step * big));
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          onChange(clampStep(value + step * big));
        } else if (e.key === "Home" && resetTo !== undefined) {
          e.preventDefault();
          e.stopPropagation();
          onChange(resetTo);
        }
      }}
    >
      <div className="slider-track absolute inset-x-0 h-1 rounded-full" />
      <div className="slider-fill absolute h-1 rounded-full" style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />
      {origin !== undefined && <div className="slider-origin absolute h-2.5 w-[2px] rounded-full" style={{ left: `calc(${o * 100}% - 1px)` }} />}
      <div className="slider-thumb absolute h-5 w-5 rounded-full" style={{ left: `calc(${p * 100}% - 10px)` }}>
        <span className="slider-dot absolute inset-[5px] rounded-full transition-transform duration-150 group-hover:scale-[1.2] group-active:scale-[0.8]" />
      </div>
    </div>
  );
}
