import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  CheckmarkCircle20Filled,
  Dismiss16Regular,
  ErrorCircle20Filled,
  FolderOpen16Regular,
  Play16Filled,
} from "@fluentui/react-icons";
import { useEditor } from "../store/editor";
import { api } from "../lib/platform";
import { playOutput, revealOutput } from "../store/controller";
import { basename, formatBytes } from "../lib/files";
import type { QueueItem, Stage } from "../lib/types";
import { ProgressBar, ProgressRing } from "./ui/Progress";
import { Button, IconButton } from "./ui/Button";

const STAGE: Record<Stage, string> = {
  preparing: "Procesando efectos",
  copying: "Copiando sin recodificar",
  encoding: "Exportando",
  firstPass: "Analizando (1.ª pasada)",
  secondPass: "Exportando (2.ª pasada)",
  retrying: "Ajustando al tamaño",
};

function eta(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || !Number.isFinite(secs)) return "";
  if (secs < 1) return "terminando…";
  if (secs < 60) return `quedan ${Math.ceil(secs)} s`;
  return `quedan ${Math.floor(secs / 60)} min ${String(Math.round(secs % 60)).padStart(2, "0")} s`;
}

function Row({ it, queuedIndex, queuedCount }: { it: QueueItem; queuedIndex: number; queuedCount: number }) {
  const s = it.status;
  const [details, setDetails] = useState(false);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 16, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className="queue-row flex flex-col gap-2 rounded-[6px] px-3 py-2.5"
      data-testid="queue-item"
      data-state={s.state}
    >
      <div className="flex items-center gap-2">
        <span className="flex w-5 shrink-0 justify-center text-[18px]">
          {s.state === "running" && <ProgressRing size={16} stroke={2} />}
          {s.state === "done" && <CheckmarkCircle20Filled className="text-[var(--success)]" />}
          {s.state === "failed" && <ErrorCircle20Filled className="text-[var(--critical)]" />}
          {s.state === "queued" && <span className="queue-dot h-2 w-2 rounded-full" />}
          {s.state === "cancelled" && <Dismiss16Regular className="text-[var(--text-tertiary)]" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-body truncate">{it.title}</p>
          <p className="t-caption truncate text-[var(--text-secondary)]">
            {s.state === "queued" && "En espera"}
            {s.state === "running" && (s.progress ? `${STAGE[s.progress.stage]} · ${Math.floor(s.progress.percent)}% ${eta(s.progress.etaSecs)}` : "Arrancando…")}
            {s.state === "done" && `${basename(s.outcome.output)} · ${formatBytes(s.outcome.sizeBytes)}${s.outcome.mode === "fast" ? " · sin recodificar" : ""}`}
            {s.state === "failed" && s.error.message}
            {s.state === "cancelled" && "Cancelada · no quedó ningún archivo a medias"}
          </p>
        </div>
        {s.state === "queued" && queuedCount > 1 && (
          <>
            <IconButton label="Subir" size={28} disabled={queuedIndex === 0} onClick={() => void api.reorderExportItem(it.id, queuedIndex - 1)}>
              <ArrowUp16Regular />
            </IconButton>
            <IconButton label="Bajar" size={28} disabled={queuedIndex === queuedCount - 1} onClick={() => void api.reorderExportItem(it.id, queuedIndex + 1)}>
              <ArrowDown16Regular />
            </IconButton>
          </>
        )}
        {(s.state === "queued" || s.state === "running") && (
          <IconButton label="Cancelar" size={28} onClick={() => void api.cancelExportItem(it.id)} data-testid="queue-cancel">
            <Dismiss16Regular />
          </IconButton>
        )}
        {(s.state === "done" || s.state === "failed" || s.state === "cancelled") && (
          <IconButton label="Quitar de la lista" size={28} onClick={() => void api.removeExportItem(it.id)}>
            <Dismiss16Regular />
          </IconButton>
        )}
      </div>
      {s.state === "running" && <ProgressBar value={s.progress?.percent ?? 0} testId="queue-progress" />}
      {s.state === "failed" && s.error.detail && (
        <div className="pl-7">
          <button type="button" className="t-caption flex items-center gap-1 text-[var(--accent-text)]" onClick={() => setDetails((v) => !v)} data-testid="queue-details">
            {details ? "Ocultar detalles" : "Ver detalles"}
          </button>
          {details && <pre className="t-caption mt-1.5 max-h-28 select-text overflow-auto whitespace-pre-wrap rounded-[4px] bg-black/20 p-2 font-mono text-[11px]">{s.error.detail}</pre>}
        </div>
      )}
      {s.state === "done" && (
        <div className="flex gap-2">
          <Button className="!h-7 flex-1" icon={<FolderOpen16Regular />} onClick={() => void revealOutput(s.outcome.output)} data-testid="queue-open-folder">
            Abrir carpeta
          </Button>
          <Button className="!h-7 flex-1" icon={<Play16Filled />} onClick={() => void playOutput(s.outcome.output)} data-testid="queue-play">
            Reproducir
          </Button>
        </div>
      )}
    </motion.li>
  );
}

/** Panel de la cola de exportación (debajo de la barra de título). */
export function QueuePanel() {
  const open = useEditor((s) => s.queueOpen);
  const queue = useEditor((s) => s.queue);
  const queued = queue.filter((q) => q.status.state === "queued");
  const finished = queue.some((q) => ["done", "failed", "cancelled"].includes(q.status.state));
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => useEditor.setState({ queueOpen: false })} />
          <motion.div
            key="queue"
            className="flyout fixed right-3 top-[calc(var(--titlebar-h)+4px)] z-[56] flex max-h-[70vh] w-[380px] flex-col overflow-hidden"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 480, damping: 36 }}
            style={{ transformOrigin: "top right" }}
            data-testid="queue-panel"
          >
            <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <h2 className="t-body-strong">Cola de exportación</h2>
              {finished && (
                <button type="button" className="t-caption text-[var(--accent-text)] hover:underline" onClick={() => void api.removeExportItem(null)}>
                  Limpiar terminados
                </button>
              )}
            </div>
            {queue.length === 0 ? (
              <p className="t-caption px-4 pb-4 text-[var(--text-secondary)]">No hay exportaciones. Podés seguir editando mientras se exporta.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 overflow-y-auto px-2 pb-2">
                <AnimatePresence initial={false}>
                  {queue.map((it) => (
                    <Row key={it.id} it={it} queuedIndex={queued.findIndex((q) => q.id === it.id)} queuedCount={queued.length} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
