import { useEffect, useRef, useState } from "react";
import { useAnimate } from "motion/react";
import { frameToTimecode, parseTimecode, secondsToFrame } from "../lib/timecode";

/** Timecode del playhead: se ve como texto; al tocarlo se edita y Enter salta ahí. */
export function GoToTime({ value, fps, onSeek }: { value: number; fps: number; onSeek: (t: number) => void }) {
  const display = frameToTimecode(secondsToFrame(value + 1e-6, fps), fps);
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  const [scope, animate] = useAnimate();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setText(display);
  }, [display, editing]);
  const commit = () => {
    setEditing(false);
    const f = parseTimecode(text, fps);
    if (f === null) {
      setText(display);
      if (scope.current) void animate(scope.current, { x: [0, -6, 5, -3, 2, 0] }, { duration: 0.35 });
      return;
    }
    onSeek(f / fps);
  };
  return (
    <span ref={scope} className="inline-flex">
      <input
        ref={ref}
        value={text}
        aria-label="Ir a un tiempo"
        spellCheck={false}
        inputMode="numeric"
        className="goto-tc t-body tabular w-[104px] rounded-[4px] px-1 outline-none"
        data-testid="current-tc"
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => editing && commit()}
        onKeyDown={(e) => {
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
          }
        }}
      />
    </span>
  );
}
