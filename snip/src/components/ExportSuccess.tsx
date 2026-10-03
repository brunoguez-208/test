import { motion, useReducedMotion } from "motion/react";
import { FolderOpen20Regular, Play20Filled, ArrowUndo16Regular } from "@fluentui/react-icons";
import { useSnip } from "../store/snip";
import { backToSettings, playOutput, revealOutput } from "../store/controller";
import { basename, formatBytes } from "../lib/files";
import { formatDuration } from "../lib/timecode";
import { Button } from "./ui/Button";
import { InfoBar } from "./ui/InfoBar";

/** Check animado: círculo con spring, anillo que se expande y tilde que se revela (solo transform/opacity). */
function SuccessCheck() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-20 w-20 items-center justify-center" data-testid="success-check">
      {!reduce && (
        <motion.span
          className="success-ring absolute inset-0 rounded-full"
          initial={{ scale: 0.6, opacity: 0.8 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.9, ease: [0, 0, 0, 1], delay: 0.15 }}
        />
      )}
      <motion.span
        className="success-disc absolute inset-0 rounded-full"
        initial={{ scale: reduce ? 1 : 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 18 }}
      />
      <div className="relative h-9 w-9 overflow-hidden">
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full" aria-hidden>
          <path d="M8 19 L15 26 L29 11" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="success-tick" />
        </svg>
        {/* Cortina del color del círculo que se corre para "dibujar" el tilde */}
        <motion.span
          className="success-cover absolute inset-0"
          initial={{ x: reduce ? "100%" : "0%" }}
          animate={{ x: "105%" }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1], delay: 0.25 }}
        />
      </div>
    </div>
  );
}

export function ExportSuccess() {
  const state = useSnip((s) => s.exportState);
  if (state.status !== "success") return null;
  const o = state.outcome;

  return (
    <div className="flex flex-col items-center gap-5 pt-6 text-center" data-testid="export-success">
      <SuccessCheck />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.35 }}>
        <p className="t-title">¡Listo!</p>
        <p className="t-body mt-1 max-w-[290px] break-all text-[var(--text-primary)]" data-testid="success-file">
          {basename(o.output)}
        </p>
        <p className="t-caption tabular mt-1 text-[var(--text-secondary)]">
          {formatBytes(o.sizeBytes)} · {formatDuration(o.duration)} · {o.width}×{o.height} · en {o.elapsedSecs.toFixed(1).replace(".", ",")} s
        </p>
      </motion.div>
      {o.fellBack && (
        <InfoBar severity="caution" title="Se usó la CPU" message="La GPU no pudo codificar este video, así que exportamos con x264." className="text-left" />
      )}
      <motion.div
        className="flex w-full gap-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.35 }}
      >
        <Button className="flex-1" icon={<FolderOpen20Regular />} onClick={() => void revealOutput(o.output)} data-testid="open-folder">
          Abrir carpeta
        </Button>
        <Button variant="accent" className="flex-1" icon={<Play20Filled />} onClick={() => void playOutput(o.output)} data-testid="play-output">
          Reproducir
        </Button>
      </motion.div>
      <Button variant="subtle" icon={<ArrowUndo16Regular />} onClick={backToSettings} data-testid="export-again">
        Exportar otro recorte
      </Button>
    </div>
  );
}
