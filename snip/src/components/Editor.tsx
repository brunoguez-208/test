import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useSnip } from "../store/snip";
import { Player } from "./Player";
import { Transport } from "./Transport";
import { Timeline } from "./Timeline";
import { ExportPanel } from "./ExportPanel";

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.1, 0.9, 0.2, 1] as const, delay },
});

/** Editor: preview grande al centro, timeline abajo y panel de exportación a la derecha. */
export function Editor() {
  const panelOpen = useSnip((s) => s.panelOpen);
  return (
    <motion.section
      className="flex h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      data-testid="editor"
    >
      <LayoutGroup>
        <motion.div layout transition={{ type: "spring", stiffness: 380, damping: 40 }} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-6 pb-6 pt-3">
          <motion.div layout="position" className="flex min-h-0 flex-1 flex-col" {...rise(0.02)}>
            <Player />
          </motion.div>
          <motion.div layout="position" {...rise(0.08)}>
            <Transport />
          </motion.div>
          <motion.div layout="position" {...rise(0.14)}>
            <Timeline />
          </motion.div>
        </motion.div>
        <AnimatePresence initial={true}>{panelOpen && <ExportPanel />}</AnimatePresence>
      </LayoutGroup>
    </motion.section>
  );
}
