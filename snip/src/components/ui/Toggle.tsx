import { motion } from "motion/react";

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  testId?: string;
}

/** ToggleSwitch de WinUI: la perilla se desliza con spring y se estira al presionar. */
export function Toggle({ checked, onChange, label, testId }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`toggle group relative h-5 w-10 shrink-0 rounded-full outline-none ${checked ? "is-on" : ""}`}
    >
      <motion.span
        className="toggle-knob absolute top-1/2 left-0 block h-3 w-3 rounded-full group-hover:scale-[1.17] group-active:scale-x-[1.42]"
        initial={false}
        animate={{ x: checked ? 24 : 4 }}
        style={{ y: "-50%" }}
        transition={{ type: "spring", stiffness: 600, damping: 32 }}
      />
    </button>
  );
}
