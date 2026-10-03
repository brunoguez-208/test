import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  /** Atajo que se muestra a la derecha. */
  hint?: string;
  disabled?: boolean;
  run?: () => void;
  testId?: string;
}
export type MenuEntry = MenuItem | "separator";

interface MenuState {
  open: { x: number; y: number; items: MenuEntry[] } | null;
}

const useMenu = create<MenuState>(() => ({ open: null }));

/** Abre el menú contextual en la posición del mouse. */
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuEntry[]) {
  e.preventDefault();
  e.stopPropagation?.();
  useMenu.setState({ open: { x: e.clientX, y: e.clientY, items } });
}

export function closeContextMenu() {
  useMenu.setState({ open: null });
}

const ITEM_H = 32;

/** Menú contextual de Fluent (mismo flyout que las listas desplegables). */
export function ContextMenuHost() {
  const open = useMenu((s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeContextMenu();
      }
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("blur", closeContextMenu);
    };
  }, [open]);
  const w = 240;
  const h = open ? open.items.reduce((a, it) => a + (it === "separator" ? 9 : ITEM_H), 8) : 0;
  const left = open ? Math.min(open.x, window.innerWidth - w - 8) : 0;
  const top = open ? Math.min(open.y, window.innerHeight - h - 8) : 0;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key={`${open.x},${open.y}`}
          ref={ref}
          role="menu"
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.18, ease: [0, 0, 0, 1] }}
          className="flyout fixed z-[95] p-1"
          style={{ left, top, width: w, transformOrigin: "top left" }}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="context-menu"
        >
          {open.items.map((it, i) =>
            it === "separator" ? (
              <div key={`s${i}`} className="mx-1 my-1 h-px bg-[var(--stroke-divider)]" />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  closeContextMenu();
                  it.run?.();
                }}
                className="select-item t-body flex h-8 w-full items-center gap-2.5 rounded-[4px] px-2.5 text-left disabled:pointer-events-none disabled:text-[var(--text-disabled)]"
                data-testid={it.testId}
              >
                <span className="flex w-4 shrink-0 justify-center text-[var(--text-secondary)]">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && <span className="t-caption shrink-0 text-[var(--text-tertiary)]">{it.hint}</span>}
              </button>
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
