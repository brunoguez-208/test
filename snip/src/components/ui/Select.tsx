import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown16Regular } from "@fluentui/react-icons";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

/** ComboBox de Fluent: botón + lista flotante, navegable con teclado. */
export function Select<T extends string>({ value, options, onChange, label, disabled, className = "", testId }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex];

  useLayoutEffect(() => {
    if (open && btn.current) setRect(btn.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    if (o.value !== value) onChange(o.value);
  };

  const move = (dir: 1 | -1) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (!open && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      setActive(selectedIndex);
      setOpen(true);
      return;
    }
    if (!open) return;
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  // Como en WinUI: la lista se abre con el ítem elegido alineado sobre el botón.
  const ITEM_H = 36;
  const listW = rect ? Math.max(rect.width + 8, 236) : 0;
  const left = rect ? Math.max(8, Math.min(rect.left - 4, window.innerWidth - listW - 8)) : 0;
  const top = rect ? Math.max(8, Math.min(window.innerHeight - options.length * ITEM_H - 16, rect.top - selectedIndex * ITEM_H - 4)) : 0;

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        disabled={disabled}
        data-testid={testId}
        onClick={() => {
          setActive(selectedIndex);
          setOpen((o) => !o);
        }}
        onKeyDown={onKey}
        className={`select-btn btn-standard t-body flex h-8 w-full items-center justify-between gap-2 rounded-[4px] pl-3 pr-2 text-left outline-none disabled:pointer-events-none disabled:text-[var(--text-disabled)] ${className}`}
      >
        <span className="truncate">{selected?.label}</span>
        <motion.span animate={{ y: open ? 2 : 0 }} className="flex text-[var(--text-secondary)]">
          <ChevronDown16Regular />
        </motion.span>
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              key="list"
              ref={list}
              id={id}
              role="listbox"
              aria-label={label}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.2, ease: [0, 0, 0, 1] }}
              className="flyout fixed z-[90] p-1"
              style={{ left, top, width: listW, transformOrigin: "top center" }}
              onKeyDown={onKey}
            >
              {options.map((o, i) => (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => commit(i)}
                  className={`select-item t-body relative flex h-9 items-center justify-between gap-3 rounded-[4px] pl-3 pr-2 ${
                    i === active ? "is-active" : ""
                  } ${o.disabled ? "is-disabled" : ""}`}
                >
                  {o.value === value && (
                    <motion.span layoutId={`${id}-pill`} className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent-fill)]" />
                  )}
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="t-caption shrink-0 text-[var(--text-tertiary)]">{o.hint}</span>}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
