import { Add12Regular, Subtract12Regular } from "@fluentui/react-icons";
import { IconButton } from "./Button";

/** NumberBox compacto con − / +. */
export function Stepper({ value, min, max, onChange, label, suffix, testId }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; suffix?: string; testId?: string }) {
  return (
    <div className="stepper flex h-8 items-center rounded-[4px]" role="group" aria-label={label} data-testid={testId}>
      <IconButton label={`Menos ${label}`} size={30} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        <Subtract12Regular />
      </IconButton>
      <span className="t-body tabular min-w-[40px] text-center" aria-live="polite">
        {value}
        {suffix}
      </span>
      <IconButton label={`Más ${label}`} size={30} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
        <Add12Regular />
      </IconButton>
    </div>
  );
}
