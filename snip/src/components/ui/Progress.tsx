import { motion } from "motion/react";

/** Barra de progreso de Fluent con shimmer (solo transform/opacity). */
export function ProgressBar({ value, testId }: { value: number; testId?: string }) {
  const v = Math.min(100, Math.max(0, value)) / 100;
  return (
    <div
      className="progress relative h-[6px] w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      data-testid={testId}
    >
      <motion.div
        className="progress-fill shimmer absolute inset-0 origin-left rounded-full"
        initial={false}
        animate={{ scaleX: v }}
        transition={{ type: "spring", stiffness: 120, damping: 24, mass: 0.6 }}
      />
    </div>
  );
}

/** ProgressRing indeterminado. */
export function ProgressRing({ size = 24, stroke = 2.5, className = "" }: { size?: number; stroke?: number; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`progress-ring ${className}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * 0.28} ${c}`} />
    </svg>
  );
}
