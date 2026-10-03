import { AnimatePresence, motion } from "motion/react";
import { useSnip } from "../store/snip";
import { ExportFooter, ExportSettings } from "./ExportSettings";
import { ExportProgress } from "./ExportProgress";
import { ExportSuccess } from "./ExportSuccess";

/** Panel de exportación (se desliza desde la derecha). */
export function ExportPanel() {
  const status = useSnip((s) => s.exportState.status);
  const view = status === "running" ? "running" : status === "success" ? "success" : "settings";

  return (
    <motion.aside
      key="panel"
      className="export-panel relative flex h-full w-[var(--panel-w)] shrink-0 flex-col overflow-hidden"
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0, transition: { duration: 0.2, ease: [0.3, 0, 1, 1] } }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      data-testid="export-panel"
    >
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 className="t-subtitle">Exportar</h2>
      </div>
      <div className={`relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-3 ${view === "settings" ? "pb-4" : "flex flex-col justify-center pb-16"}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, x: view === "settings" ? -16 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: view === "settings" ? -16 : 16 }}
            transition={{ duration: 0.22, ease: [0.1, 0.9, 0.2, 1] }}
          >
            {view === "settings" && <ExportSettings />}
            {view === "running" && <ExportProgress />}
            {view === "success" && <ExportSuccess />}
          </motion.div>
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {view === "settings" && (
          <motion.div
            key="footer"
            className="panel-footer px-6 pb-6 pt-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
          >
            <ExportFooter />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
