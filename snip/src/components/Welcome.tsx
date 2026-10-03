import { AnimatePresence, motion } from "motion/react";
import { FolderOpen20Regular } from "@fluentui/react-icons";
import { useSnip } from "../store/snip";
import { openWithDialog } from "../store/controller";
import { TrimIllustration } from "./TrimIllustration";
import { Button } from "./ui/Button";
import { ProgressRing } from "./ui/Progress";

const HINTS: [string, string][] = [
  ["Espacio", "Reproducir"],
  ["I / O", "Marcar inicio y fin"],
  ["← →", "Cuadro a cuadro"],
  ["Ctrl+E", "Exportar"],
];

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.1, 0.9, 0.2, 1] as const } },
};

/** Pantalla de bienvenida: zona de drop con la ilustración viva. */
export function Welcome() {
  const drag = useSnip((s) => s.drag);
  const opening = useSnip((s) => s.opening);

  const title = drag === "valid" ? "Soltalo para abrirlo" : drag === "invalid" ? "Por ahora solo MP4" : "Recortá un video en segundos";
  const subtitle =
    drag === "valid"
      ? "Lo cargamos al toque."
      : drag === "invalid"
        ? "Ese archivo no es un .mp4. Probá con otro."
        : "Arrastrá un MP4 a esta ventana, o hacé click derecho en el archivo y elegí «Recortar con Snip».";

  return (
    <motion.section
      className="flex h-full flex-col items-center justify-center px-8 pb-10"
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.18, ease: [0.3, 0, 1, 1] } }}
      variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } }}
      data-testid="welcome"
    >
      <motion.div variants={item} className="relative mb-12">
        <div className="welcome-spot pointer-events-none absolute left-1/2 top-1/2 h-[340px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <TrimIllustration drag={drag} />
      </motion.div>

      <motion.div variants={item} className="relative h-[52px] w-full max-w-[640px] text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h1
            key={title}
            className={`t-title-lg absolute inset-x-0 ${drag === "invalid" ? "text-[var(--critical)]" : ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0, 0, 0, 1] }}
            data-testid="welcome-title"
          >
            {title}
          </motion.h1>
        </AnimatePresence>
      </motion.div>

      <motion.p variants={item} className="t-body mt-3 max-w-[460px] text-center text-[var(--text-secondary)]" aria-live="polite">
        {subtitle}
      </motion.p>

      <motion.div variants={item} className="mt-8 flex items-center gap-3">
        <Button
          variant="accent"
          size="lg"
          icon={opening ? <ProgressRing size={16} stroke={2} className="!text-[var(--text-on-accent)]" /> : <FolderOpen20Regular />}
          onClick={() => void openWithDialog()}
          disabled={opening}
          data-testid="welcome-open"
          className="min-w-[180px]"
        >
          {opening ? "Abriendo…" : "Abrir video"}
          <kbd className="kbd ml-1">Ctrl+O</kbd>
        </Button>
      </motion.div>

      <motion.p variants={item} className="t-caption mt-4 text-[var(--text-tertiary)]">
        Solo .mp4 · Exportá sin pérdida o en H.264 con tu GPU
      </motion.p>

      <motion.ul variants={item} className="mt-14 flex flex-wrap justify-center gap-x-6 gap-y-2">
        {HINTS.map(([k, label]) => (
          <li key={k} className="t-caption flex items-center gap-2 text-[var(--text-tertiary)]">
            <kbd className="kbd">{k}</kbd>
            {label}
          </li>
        ))}
      </motion.ul>
    </motion.section>
  );
}
