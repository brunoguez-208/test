import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect } from "react";
import { activeTab, useEditor, useProject } from "../../store/editor";
import { player } from "../../store/controller";
import { totalDuration } from "../../project/timeline";
import { Preview } from "./Preview";
import { Transport } from "../Transport";
import { Timeline } from "../timeline/Timeline";
import { Inspector } from "../inspector/Inspector";

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.1, 0.9, 0.2, 1] as const, delay },
});

/** Editor: preview grande, timeline abajo e inspector a la derecha. */
export function Editor() {
  const project = useProject();
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const loop = useEditor((s) => s.loop);
  const markIn = useEditor((s) => activeTab(s)?.markIn ?? null);
  const markOut = useEditor((s) => activeTab(s)?.markOut ?? null);

  // El loop sigue al rango I/O (o a todo el proyecto).
  useEffect(() => {
    if (!project) return;
    player().loop = loop ? [markIn ?? 0, markOut ?? totalDuration(project)] : null;
  }, [loop, markIn, markOut, project]);

  if (!project) return null;
  return (
    <motion.section
      className="flex h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      data-testid="editor"
    >
      <LayoutGroup>
        <motion.div layout transition={{ type: "spring", stiffness: 380, damping: 40 }} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-5 pb-4 pt-3">
          <motion.div layout="position" className="flex min-h-0 flex-1 flex-col" {...rise(0.02)}>
            <Preview project={project} />
          </motion.div>
          <motion.div layout="position" {...rise(0.08)}>
            <Transport project={project} />
          </motion.div>
          <motion.div layout="position" {...rise(0.14)}>
            <Timeline project={project} />
          </motion.div>
        </motion.div>
        <AnimatePresence initial={true}>{inspectorOpen && <Inspector project={project} />}</AnimatePresence>
      </LayoutGroup>
    </motion.section>
  );
}
