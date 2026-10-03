import { motion } from "motion/react";
import { THUMB_COUNT, useSnip } from "../store/snip";
import { cancelExport } from "../store/controller";
import { basename } from "../lib/files";
import { ProgressBar } from "./ui/Progress";
import { Button } from "./ui/Button";

function formatEta(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return "Calculando…";
  if (secs < 1) return "Terminando…";
  if (secs < 60) return `Quedan ${Math.ceil(secs)} s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `Quedan ${m} min ${s.toString().padStart(2, "0")} s`;
}

/** Tira del recorte que se "revela" a medida que avanza la exportación. */
function ClipStrip({ percent }: { percent: number }) {
  const thumbs = useSnip((s) => s.thumbs);
  const media = useSnip((s) => s.media);
  const start = useSnip((s) => s.start);
  const end = useSnip((s) => s.end);
  if (!media) return null;
  const step = media.duration / THUMB_COUNT;
  let picked = thumbs.filter((_, i) => {
    const t = (i + 0.5) * step;
    return t >= start - step / 2 && t <= end + step / 2;
  });
  if (picked.length === 0) picked = [thumbs[Math.min(THUMB_COUNT - 1, Math.floor(start / step))] ?? null];
  // Entre 6 y 10 cuadros para que se lea bien.
  const n = Math.max(6, Math.min(10, picked.length));
  const frames = Array.from({ length: n }, (_, i) => picked[Math.floor((i / n) * picked.length)] ?? null);
  const p = Math.min(1, Math.max(0, percent / 100));
  return (
    <div className="clip-strip relative h-14 overflow-hidden rounded-[6px]" aria-hidden>
      <div className="absolute inset-0 flex">
        {frames.map((src, i) => (
          <div key={i} className="relative h-full flex-1 overflow-hidden">
            {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="skeleton absolute inset-0" />}
          </div>
        ))}
      </div>
      <motion.div
        className="clip-strip-dim absolute inset-0 origin-right"
        initial={false}
        animate={{ scaleX: 1 - p }}
        transition={{ type: "spring", stiffness: 120, damping: 24, mass: 0.6 }}
      />
      <motion.div className="absolute inset-0" initial={false} animate={{ x: `${p * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 24, mass: 0.6 }}>
        <div className="clip-strip-edge absolute inset-y-0 -left-[1px] w-[2px]" />
      </motion.div>
    </div>
  );
}

/** Progreso real de la exportación: porcentaje, velocidad, tiempo restante y cancelar. */
export function ExportProgress() {
  const state = useSnip((s) => s.exportState);
  const media = useSnip((s) => s.media);
  const settings = useSnip((s) => s.settings);
  const defaultOutput = useSnip((s) => s.defaultOutput);
  if (state.status !== "running") return null;
  const { progress, cancelling } = state;
  const out = settings.outputPath ?? defaultOutput;

  return (
    <div className="flex flex-col gap-5 pt-2" data-testid="export-progress">
      <div>
        <p className="t-subtitle">{cancelling ? "Cancelando…" : "Exportando…"}</p>
        <p className="t-caption mt-1 truncate text-[var(--text-secondary)]">{out ? basename(out) : media ? basename(media.path) : ""}</p>
      </div>
      <motion.p
        className="t-title-lg tabular"
        data-testid="export-percent"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {Math.floor(progress.percent)}
        <span className="t-subtitle ml-1 text-[var(--text-secondary)]">%</span>
      </motion.p>
      <ClipStrip percent={progress.percent} />
      <ProgressBar value={progress.percent} testId="export-bar" />
      <div className="t-caption tabular flex justify-between text-[var(--text-secondary)]">
        <span data-testid="export-speed">{progress.speed ? `${progress.speed.toFixed(1).replace(".", ",")}×` : "—"}</span>
        <span data-testid="export-eta">{formatEta(progress.etaSecs)}</span>
      </div>
      <Button onClick={() => void cancelExport()} disabled={cancelling} data-testid="export-cancel" className="mt-2">
        {cancelling ? "Cancelando…" : "Cancelar"}
      </Button>
    </div>
  );
}
