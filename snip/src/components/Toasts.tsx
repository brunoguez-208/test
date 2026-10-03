import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { dismissToast, useEditor, type Toast } from "../store/editor";
import { InfoBar } from "./ui/InfoBar";
import { Button } from "./ui/Button";

function AutoDismiss({ toast }: { toast: Toast }) {
  useEffect(() => {
    const ms = toast.action ? 9000 : toast.severity === "critical" ? 9000 : 5000;
    const t = window.setTimeout(() => dismissToast(toast.id), ms);
    return () => window.clearTimeout(t);
  }, [toast]);
  return null;
}

/** Avisos tipo InfoBar flotantes, arriba al centro. */
export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--titlebar-h)+10px)] z-[70] flex flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="pointer-events-auto w-full max-w-[520px]"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 500, damping: 36 }}
          >
            <AutoDismiss toast={t} />
            <InfoBar
              severity={t.severity}
              title={t.title}
              message={t.message}
              onClose={() => dismissToast(t.id)}
              className="floating"
              testId={`toast-${t.severity}`}
              action={
                t.action && (
                  <Button
                    className="!h-7"
                    onClick={() => {
                      t.action!.run();
                      dismissToast(t.id);
                    }}
                    data-testid="toast-action"
                  >
                    {t.action.label}
                  </Button>
                )
              }
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
