import { useId } from "react";

/** Muestra de color con el selector nativo (el de Windows) y el valor en hex. */
export function ColorField({ value, onChange, label, testId }: { value: string; onChange: (v: string) => void; label: string; testId?: string }) {
  const id = useId();
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return (
    <label htmlFor={id} className="color-field t-caption inline-flex h-8 cursor-pointer items-center gap-2 rounded-[4px] px-2" data-testid={testId}>
      <span className="color-swatch h-5 w-5 rounded-[4px]" style={{ background: hex }} />
      <span className="tabular uppercase text-[var(--text-secondary)]">{hex}</span>
      <input id={id} type="color" aria-label={label} value={hex} onChange={(e) => onChange(e.target.value)} className="sr-only" />
    </label>
  );
}
