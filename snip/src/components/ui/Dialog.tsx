import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  primary: string;
  secondary?: string;
  /** Tercer botón opcional (por ejemplo "Cancelar" en "Guardar / No guardar / Cancelar"). */
  tertiary?: string;
  danger?: boolean;
  onPrimary: () => void;
  /** Si no se pasa, el botón secundario cierra. */
  onSecondary?: () => void;
  onTertiary?: () => void;
  onClose: () => void;
}

/** ContentDialog de WinUI: smoke + tarjeta que entra con escala sutil. */
export function Dialog({ open, title, children, primary, secondary = "Cancelar", tertiary, danger, onPrimary, onSecondary, onTertiary, onClose }: DialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => primaryRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog"
          className="fixed inset-0 z-[80] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          data-modal="true"
        >
          <div className="absolute inset-0 bg-[var(--smoke-fill)]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dlg-title"
            initial={{ scale: 1.05, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.02, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.1, 0.9, 0.2, 1] }}
            className="dialog relative w-[460px] max-w-[calc(100vw-48px)] overflow-hidden rounded-[8px]"
          >
            <div className="px-6 pb-6 pt-6">
              <h2 id="dlg-title" className="t-subtitle mb-3">
                {title}
              </h2>
              <div className="t-body text-[var(--text-secondary)]">{children}</div>
            </div>
            <div className="dialog-footer flex justify-end gap-2 px-6 py-6">
              <Button ref={primaryRef} variant="accent" className={`min-w-[110px] flex-1 ${danger ? "btn-danger" : ""}`} onClick={onPrimary} data-testid="dialog-primary">
                {primary}
              </Button>
              <Button className="min-w-[110px] flex-1" onClick={onSecondary ?? onClose} data-testid="dialog-secondary">
                {secondary}
              </Button>
              {tertiary && (
                <Button className="min-w-[110px] flex-1" onClick={onTertiary ?? onClose} data-testid="dialog-tertiary">
                  {tertiary}
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
