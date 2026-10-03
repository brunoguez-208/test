import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion, useAnimate } from "motion/react";
import { frameToTimecode, parseTimecode, secondsToFrame } from "../lib/timecode";

interface TimecodeInputProps {
  label: string;
  /** Valor en segundos. */
  value: number;
  fps: number;
  /** Devuelve false si el valor no es aceptable. */
  onCommit: (frame: number) => boolean | void;
  testId?: string;
  /** Mostrar el cuadro final incluido (para el fin, que es exclusivo). */
  inclusiveEnd?: boolean;
}

/** Input de timecode editable: Enter confirma, Esc cancela, ↑/↓ mueven un cuadro. */
export function TimecodeInput({ label, value, fps, onCommit, testId, inclusiveEnd }: TimecodeInputProps) {
  const frame = Math.max(0, secondsToFrame(value + 1e-6, fps) - (inclusiveEnd ? 1 : 0));
  const display = frameToTimecode(frame, fps);
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  const [scope, animate] = useAnimate();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setText(display);
  }, [display, editing]);

  const reject = () => {
    setText(display);
    if (scope.current) void animate(scope.current, { x: [0, -6, 5, -3, 2, 0] }, { duration: 0.35 });
  };

  const commit = () => {
    setEditing(false);
    const f = parseTimecode(text, fps);
    if (f === null) return reject();
    const target = inclusiveEnd ? f + 1 : f;
    if (onCommit(target) === false) reject();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      ref.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      setText(display);
      ref.current?.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = (e.shiftKey ? Math.round(fps) : 1) * (e.key === "ArrowUp" ? 1 : -1);
      const base = parseTimecode(text, fps) ?? frame;
      const next = Math.max(0, base + step);
      setText(frameToTimecode(next, fps));
      onCommit(inclusiveEnd ? next + 1 : next);
    }
  };

  return (
    <motion.label ref={scope} className="flex flex-col gap-1">
      <span className="t-caption text-[var(--text-secondary)]">{label}</span>
      <input
        ref={ref}
        value={text}
        spellCheck={false}
        inputMode="numeric"
        aria-label={label}
        data-testid={testId}
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => editing && commit()}
        onKeyDown={onKey}
        className="tc-input t-body tabular h-8 w-[136px] rounded-[4px] px-2.5 text-center outline-none"
      />
    </motion.label>
  );
}
