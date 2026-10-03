import { AnimatePresence, motion } from "motion/react";
import type { Project } from "../../project/model";
import { useEditor, type InspectorTab } from "../../store/editor";
import { ClipTab } from "./ClipTab";
import { VideoTab } from "./VideoTab";
import { AudioTab } from "./AudioTab";
import { ExportTab } from "./ExportTab";

export const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: "clip", label: "Clip" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "export", label: "Exportar" },
];

/** Inspector a la derecha: pestañas animadas con las opciones de lo seleccionado. */
export function Inspector({ project }: { project: Project }) {
  const tab = useEditor((s) => s.inspectorTab);
  const order = INSPECTOR_TABS.findIndex((t) => t.id === tab);
  return (
    <motion.aside
      key="inspector"
      className="export-panel relative flex h-full w-[var(--panel-w)] shrink-0 flex-col overflow-hidden"
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0, transition: { duration: 0.2, ease: [0.3, 0, 1, 1] } }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      data-testid="inspector"
    >
      <nav className="inspector-tabs flex gap-1 px-4 pb-1 pt-3" role="tablist" aria-label="Opciones">
        {INSPECTOR_TABS.map((t) => {
          const sel = t.id === tab;
          return (
            <motion.button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => useEditor.setState({ inspectorTab: t.id })}
              whileTap={{ scale: 0.96 }}
              className={`inspector-tab t-body relative rounded-[4px] px-3 py-1.5 outline-none ${sel ? "is-selected" : ""}`}
              data-testid={`inspector-tab-${t.id}`}
            >
              {t.label}
              {sel && <motion.span layoutId="inspector-pill" className="inspector-pill absolute bottom-0 left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
            </motion.button>
          );
        })}
      </nav>
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4">
        <AnimatePresence mode="wait" initial={false} custom={order}>
          <motion.div
            key={tab}
            className="h-full"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: [0.1, 0.9, 0.2, 1] }}
          >
            {tab === "clip" && <div className="pb-6"><ClipTab project={project} /></div>}
            {tab === "video" && <div className="pb-6"><VideoTab project={project} /></div>}
            {tab === "audio" && <div className="pb-6"><AudioTab project={project} /></div>}
            {tab === "export" && <ExportTab project={project} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
