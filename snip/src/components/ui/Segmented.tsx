import { motion } from "motion/react";
import { useId, type ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Selector segmentado con indicador que se desliza (spring). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
  size = "md",
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  label: string;
  testId?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={`segmented flex w-full rounded-[6px] p-[3px] ${size === "sm" ? "h-8" : "h-9"}`} data-testid={testId}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            title={o.title}
            disabled={o.disabled}
            onClick={() => !sel && onChange(o.value)}
            whileTap={{ scale: 0.97 }}
            className={`segment t-caption relative flex flex-1 items-center justify-center gap-1 rounded-[4px] px-1.5 outline-none disabled:opacity-40 ${sel ? "is-selected" : ""}`}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
          >
            {sel && <motion.span layoutId={`${id}-pill`} className="segment-pill absolute inset-0 rounded-[4px]" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
            <span className="relative z-[1] flex items-center gap-1 truncate">{o.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
