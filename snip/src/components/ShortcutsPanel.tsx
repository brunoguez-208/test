import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Dismiss16Regular } from "@fluentui/react-icons";
import { SHORTCUT_GROUPS } from "../lib/shortcuts";
import { useEditor } from "../store/editor";
import { IconButton } from "./ui/Button";

/** Panel de atajos (tecla ?). */
export function ShortcutsPanel() {
  const open = useEditor((s) => s.shortcutsOpen);
  const close = () => useEditor.setState({ shortcutsOpen: false });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="sc" className="fixed inset-0 z-[80] flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} data-modal="true">
          <div className="absolute inset-0 bg-[var(--smoke-fill)]" onClick={close} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Atajos de teclado"
            className="dialog relative max-h-[80vh] w-[720px] max-w-[calc(100vw-48px)] overflow-y-auto rounded-[8px] px-7 pb-7 pt-6"
            initial={{ scale: 1.04, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.02, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.1, 0.9, 0.2, 1] }}
            data-testid="shortcuts-panel"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="t-subtitle">Atajos de teclado</h2>
              <IconButton label="Cerrar" onClick={close}>
                <Dismiss16Regular />
              </IconButton>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
              {SHORTCUT_GROUPS.map((g, gi) => (
                <motion.section key={g.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * gi }}>
                  <h3 className="t-caption mb-2 uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{g.title}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {g.items.map(([k, label]) => (
                      <li key={k} className="t-body flex items-center justify-between gap-4">
                        <span className="text-[var(--text-secondary)]">{label}</span>
                        <kbd className="kbd shrink-0">{k}</kbd>
                      </li>
                    ))}
                  </ul>
                </motion.section>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
