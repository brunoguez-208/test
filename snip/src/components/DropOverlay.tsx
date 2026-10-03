import { AnimatePresence, motion } from "motion/react";
import { ArrowDownload20Regular, Warning20Filled } from "@fluentui/react-icons";
import { useEditor } from "../store/editor";

/** Capa de drop sobre el editor: los videos se suman al proyecto; reacciona distinto si no sirve. */
export function DropOverlay() {
  const drag = useEditor((s) => s.drag);
  const phase = useEditor((s) => s.phase);
  const show = phase === "editor" && drag !== "none";
  const valid = drag === "valid";
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="drop"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6 pt-[calc(var(--titlebar-h)+8px)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          data-testid="drop-overlay"
          data-valid={valid}
        >
          <div className="absolute inset-0 bg-[var(--smoke-fill)]" />
          <motion.div
            className={`drop-zone relative flex h-full w-full flex-col items-center justify-center gap-3 rounded-[12px] ${valid ? "is-valid" : "is-invalid"}`}
            initial={{ scale: 0.98 }}
            animate={{ scale: 1, x: valid ? 0 : [0, -8, 7, -4, 0] }}
            transition={{ duration: 0.35 }}
          >
            <span className="drop-icon flex h-14 w-14 items-center justify-center rounded-full text-[28px]">{valid ? <ArrowDownload20Regular /> : <Warning20Filled />}</span>
            <p className="t-subtitle">{valid ? "Soltalo para sumarlo al proyecto" : "Ese formato no se abre"}</p>
            <p className="t-body text-[var(--text-secondary)]">
              {valid ? "Los videos van al final del timeline; un audio va a la pista de música." : "Snip abre MP4, MOV, MKV, WebM y proyectos .snip."}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
