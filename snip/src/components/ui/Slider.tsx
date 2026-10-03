import { useRef } from "react";

interface SliderProps {
  value: number; // 0..1
  onChange: (v: number) => void;
  label: string;
  width?: number;
}

/** Slider horizontal de Fluent (para el volumen). */
export function Slider({ value, onChange, label, width = 96 }: SliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const fromEvent = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return value;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="slider group relative flex h-8 cursor-default items-center outline-none"
      style={{ width }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onChange(fromEvent(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) onChange(fromEvent(e.clientX));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.max(0, value - 0.05));
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.min(1, value + 0.05));
        }
      }}
    >
      <div className="slider-track absolute inset-x-0 h-1 rounded-full" />
      <div className="slider-fill absolute left-0 h-1 origin-left rounded-full" style={{ width: "100%", transform: `scaleX(${value})` }} />
      <div className="slider-thumb absolute h-5 w-5 rounded-full" style={{ left: `calc(${value * 100}% - 10px)` }}>
        <span className="slider-dot absolute inset-[5px] rounded-full transition-transform duration-150 group-hover:scale-[1.2] group-active:scale-[0.8]" />
      </div>
    </div>
  );
}
