import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useSnip, type Toast } from "../store/snip";
import { InfoBar } from "./ui/InfoBar";

function AutoDismiss({ toast }: { toast: Toast }) {
  const dismiss = useSnip((s) => s.dismissToast);
  useEffect(() => {
    const ms = toast.severity === "critical" ? 9000 : 5000;
    const t = window.setTimeout(() => dismiss(toast.id), ms);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);
  return null;
}

/** Avisos tipo InfoBar flotantes, arriba al centro. */
export function Toasts() {
  const toasts = useSnip((s) => s.toasts);
  const dismiss = useSnip((s) => s.dismissToast);
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
            <InfoBar severity={t.severity} title={t.title} message={t.message} onClose={() => dismiss(t.id)} className="floating" testId={`toast-${t.severity}`} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
