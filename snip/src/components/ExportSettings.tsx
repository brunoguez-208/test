import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowExport20Regular,
  ChevronDown12Regular,
  DeveloperBoard16Regular,
  Flash16Regular,
  Folder16Regular,
  Info16Regular,
  Target20Regular,
} from "@fluentui/react-icons";
import { effectiveMode, useSnip } from "../store/snip";
import { chooseSavePath, startExport } from "../store/controller";
import { basename, dirname, middleEllipsis } from "../lib/files";
import { FPS_VALUE, isFpsIncrease, planScale } from "../lib/scale";
import { formatDuration, formatFps, secondsToTimecode } from "../lib/timecode";
import { keyframeAtOrBefore } from "../lib/keyframes";
import type { FpsChoice, ResolutionChoice, ResolutionKind } from "../lib/types";
import { Button } from "./ui/Button";
import { Select, type SelectOption } from "./ui/Select";
import { Toggle } from "./ui/Toggle";
import { Tooltip } from "./ui/Tooltip";
import { InfoBar } from "./ui/InfoBar";

/** Nombre legible del códec. */
export function codecLabel(codec: string): string {
  const c = codec.toLowerCase();
  if (c === "h264") return "H.264";
  if (c === "hevc" || c === "h265") return "HEVC";
  return codec.toUpperCase();
}

const RES_LABEL: Record<ResolutionKind, string> = {
  original: "Original",
  p2160: "4K (2160p)",
  p1440: "1440p",
  p1080: "1080p",
  p720: "720p",
  custom: "Personalizada",
};

function Field({ label, children, aside }: { label: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="t-body-strong">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Configuración de la exportación. */
export function ExportSettings() {
  const media = useSnip((s) => s.media)!;
  const settings = useSnip((s) => s.settings);
  const start = useSnip((s) => s.start);
  const keyframes = useSnip((s) => s.keyframes);
  const encoder = useSnip((s) => s.encoder);
  const defaultOutput = useSnip((s) => s.defaultOutput);
  const setMode = useSnip((s) => s.setMode);
  const setFrameExact = useSnip((s) => s.setFrameExact);
  const requestResolution = useSnip((s) => s.requestResolution);
  const requestFps = useSnip((s) => s.requestFps);
  const setOutputPath = useSnip((s) => s.setOutputPath);
  const mode = effectiveMode(settings);
  const src = useMemo(() => ({ width: media.width, height: media.height }), [media.width, media.height]);
  const plan = planScale(src, mode === "fast" ? { kind: "original" } : settings.resolution);
  const codec = mode === "fast" ? codecLabel(media.videoCodec) : "H.264";

  const resOptions: SelectOption<ResolutionKind>[] = useMemo(
    () =>
      (["original", "p2160", "p1440", "p1080", "p720", "custom"] as ResolutionKind[]).map((k) => {
        if (k === "original") return { value: k, label: "Original", hint: `${media.width}×${media.height}` };
        if (k === "custom") return { value: k, label: "Personalizada…" };
        const p = planScale(src, { kind: k } as ResolutionChoice);
        return { value: k, label: RES_LABEL[k], hint: p.upscale ? "agranda" : `${p.width}×${p.height}` };
      }),
    [media.width, media.height, src],
  );

  const fpsOptions: SelectOption<FpsChoice>[] = (["original", "fps120", "fps60", "fps30", "fps24"] as FpsChoice[]).map((f) => {
    const v = FPS_VALUE[f];
    if (v === null) return { value: f, label: "Original", hint: `${formatFps(media.fps)} fps` };
    return { value: f, label: `${v} fps`, hint: isFpsIncrease(v, media.fps) ? "duplica cuadros" : undefined };
  });

  // En modo rápido el corte real empieza en el keyframe anterior.
  const kf = mode === "fast" && keyframes ? keyframeAtOrBefore(keyframes, start) : null;
  const kfShift = kf !== null ? start - kf : 0;
  const showKfNote = kf !== null && kfShift > 0.5 / media.fps;

  const output = settings.outputPath ?? defaultOutput;

  return (
    <div className="flex flex-col gap-5" data-testid="export-settings">
      <Field
        label="Modo"
        aside={
          <Tooltip
            content={
              mode === "fast"
                ? "Copia el video sin recodificar: es instantáneo y conserva la calidad y el códec original. Como no recodifica, el corte cae en el keyframe más cercano anterior al inicio, así que puede empezar unos cuadros antes."
                : "Recodifica a H.264: el corte es exacto al cuadro y podés cambiar la resolución o los fps. Tarda más que el modo rápido."
            }
            maxWidth={300}
          >
            <span className="flex text-[var(--text-secondary)]" tabIndex={0} aria-label="Más info del modo" data-testid="mode-info">
              <Info16Regular />
            </span>
          </Tooltip>
        }
      >
        <ModeCards value={mode} onChange={setMode} codec={codec} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={mode + (showKfNote ? "kf" : "")}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="t-caption text-[var(--text-secondary)]"
            data-testid="mode-caption"
          >
            {mode === "fast" ? (
              showKfNote ? (
                <>
                  El corte va a empezar en el keyframe{" "}
                  <span className="tabular text-[var(--text-primary)]">{secondsToTimecode(kf!, media.fps)}</span>, {formatDuration(kfShift)} antes de tu inicio.
                </>
              ) : (
                <>El inicio coincide con un keyframe: el corte cae justo ahí.</>
              )
            ) : (
              <>Se va a codificar con {encoder ? encoder.label : "el mejor codificador disponible"}.</>
            )}
          </motion.p>
        </AnimatePresence>
      </Field>

      <div className="setting-row flex items-center justify-between gap-4 rounded-[6px] px-4 py-3">
        <div className="min-w-0">
          <p className="t-body">Corte exacto al cuadro</p>
          <p className="t-caption text-[var(--text-secondary)]">Recodifica para cortar justo donde marcaste.</p>
        </div>
        <Toggle checked={mode === "precise" && settings.frameExact} onChange={setFrameExact} label="Corte exacto al cuadro" testId="frame-exact" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Resolución">
          <Select
            label="Resolución"
            testId="select-resolution"
            value={mode === "fast" ? "original" : settings.resolution.kind}
            options={resOptions}
            onChange={(k) => {
              if (k === "custom") requestResolution({ kind: "custom", width: plan.width });
              else requestResolution({ kind: k } as ResolutionChoice);
            }}
          />
        </Field>
        <Field label="FPS">
          <Select label="FPS" testId="select-fps" value={mode === "fast" ? "original" : settings.fps} options={fpsOptions} onChange={requestFps} />
        </Field>
      </div>

      <AnimatePresence initial={false}>
        {mode === "precise" && settings.resolution.kind === "custom" && (
          <motion.div
            key="custom"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="-mt-3"
          >
            <CustomSize width={settings.resolution.width} />
          </motion.div>
        )}
      </AnimatePresence>

      <Field label="Destino">
        <div className="setting-row flex items-center gap-3 rounded-[6px] px-3 py-2.5">
          <Folder16Regular className="shrink-0 text-[16px] text-[var(--text-secondary)]" />
          <div className="min-w-0 flex-1">
            <p className="t-body truncate" title={output ?? undefined} data-testid="output-name">
              {output ? basename(output) : "…"}
            </p>
            <p className="t-caption truncate text-[var(--text-tertiary)]" title={output ? dirname(output) : undefined}>
              {output ? middleEllipsis(dirname(output), 40) : ""}
            </p>
          </div>
          <Button className="shrink-0" onClick={() => void chooseSavePath()} data-testid="save-as">
            Cambiar…
          </Button>
        </div>
        {settings.outputPath ? (
          <button type="button" className="t-caption self-start text-[var(--accent-text)] hover:underline" onClick={() => setOutputPath(null)}>
            Volver a guardar junto al original
          </button>
        ) : (
          <p className="t-caption text-[var(--text-tertiary)]">Junto al original. Nunca sobrescribe: si ya existe, suma (2), (3)…</p>
        )}
      </Field>

    </div>
  );
}

function ModeCards({ value, onChange, codec }: { value: "fast" | "precise"; onChange: (m: "fast" | "precise") => void; codec: string }) {
  const items = [
    { id: "fast" as const, icon: <Flash16Regular />, title: "Rápido · sin pérdida", desc: `Instantáneo. Mismo códec (${codec}) y calidad.` },
    { id: "precise" as const, icon: <Target20Regular className="text-[16px]" />, title: "Preciso", desc: "Recodifica a H.264. Corte exacto y cambios de tamaño o fps." },
  ];
  return (
    <div role="radiogroup" aria-label="Modo de exportación" className="flex flex-col gap-2">
      {items.map((it) => {
        const selected = value === it.id;
        return (
          <motion.button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`mode-${it.id}`}
            onClick={() => onChange(it.id)}
            whileTap={{ scale: 0.985 }}
            className={`mode-card relative flex items-start gap-3 rounded-[6px] px-3.5 py-3 text-left outline-none ${selected ? "is-selected" : ""}`}
          >
            {selected && (
              <motion.span
                layoutId="mode-outline"
                className="mode-outline pointer-events-none absolute -inset-px rounded-[6px]"
                transition={{ type: "spring", stiffness: 520, damping: 40 }}
              />
            )}
            <span className="mode-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[16px]">{it.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="t-body-strong block">{it.title}</span>
              <span className="t-caption block text-[var(--text-secondary)]">{it.desc}</span>
            </span>
            <span className="radio mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
              <motion.span className="radio-dot h-2 w-2 rounded-full" initial={false} animate={{ scale: selected ? 1 : 0 }} transition={{ type: "spring", stiffness: 600, damping: 30 }} />
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function CustomSize({ width }: { width: number }) {
  const media = useSnip((s) => s.media)!;
  const requestResolution = useSnip((s) => s.requestResolution);
  const plan = planScale({ width: media.width, height: media.height }, { kind: "custom", width });
  const [w, setW] = useState(String(plan.width));
  const [h, setH] = useState(String(plan.height));
  const confirmation = useSnip((s) => s.confirmation);
  const aspect = media.width / media.height;

  // Si se canceló la confirmación de agrandar, volvemos al valor vigente.
  useEffect(() => {
    if (!confirmation) {
      setW(String(plan.width));
      setH(String(plan.height));
    }
  }, [confirmation, plan.width, plan.height]);

  const commitWidth = (val: number) => {
    if (!Number.isFinite(val) || val < 16) {
      setW(String(plan.width));
      setH(String(plan.height));
      return;
    }
    const p = planScale({ width: media.width, height: media.height }, { kind: "custom", width: val });
    setW(String(p.width));
    setH(String(p.height));
    requestResolution({ kind: "custom", width: p.width });
  };

  return (
    <div className="flex items-end gap-2" title="Mantiene la proporción del original">
      <label className="flex flex-1 flex-col gap-1">
        <span className="t-caption text-[var(--text-secondary)]">Ancho (px)</span>
        <input
          className="tc-input t-body tabular h-8 w-full rounded-[4px] px-2.5 outline-none"
          value={w}
          inputMode="numeric"
          data-testid="custom-width"
          onChange={(e) => {
            setW(e.target.value.replace(/\D/g, ""));
            const n = Number(e.target.value);
            if (n > 0) setH(String(Math.round(n / aspect)));
          }}
          onBlur={() => commitWidth(Number(w))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitWidth(Number(w));
          }}
        />
      </label>
      <span className="t-body pb-1.5 text-[var(--text-tertiary)]">×</span>
      <label className="flex flex-1 flex-col gap-1">
        <span className="t-caption text-[var(--text-secondary)]">Alto (px)</span>
        <input
          className="tc-input t-body tabular h-8 w-full rounded-[4px] px-2.5 outline-none"
          value={h}
          inputMode="numeric"
          data-testid="custom-height"
          onChange={(e) => {
            setH(e.target.value.replace(/\D/g, ""));
            const n = Number(e.target.value);
            if (n > 0) setW(String(Math.round(n * aspect)));
          }}
          onBlur={() => commitWidth(Math.round(Number(h) * aspect))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitWidth(Math.round(Number(h) * aspect));
          }}
        />
      </label>
    </div>
  );
}

/** Pie fijo del panel: resumen, error y el botón de exportar (siempre visible). */
export function ExportFooter() {
  const media = useSnip((s) => s.media)!;
  const settings = useSnip((s) => s.settings);
  const start = useSnip((s) => s.start);
  const end = useSnip((s) => s.end);
  const encoder = useSnip((s) => s.encoder);
  const exportState = useSnip((s) => s.exportState);
  const [showDetail, setShowDetail] = useState(false);
  const mode = effectiveMode(settings);
  const plan = planScale({ width: media.width, height: media.height }, mode === "fast" ? { kind: "original" } : settings.resolution);
  const outFps = mode === "fast" ? media.fps : (FPS_VALUE[settings.fps] ?? media.fps);
  const codec = mode === "fast" ? codecLabel(media.videoCodec) : "H.264";
  const error = exportState.status === "error" ? exportState.error : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="px-0.5" data-testid="export-summary">
        <div className="t-caption flex items-center justify-between gap-2 text-[var(--text-secondary)]">
          <span>Vas a obtener</span>
          <span className="flex items-center gap-1">
            {mode === "fast" ? (
              <>
                <Flash16Regular /> {codec} sin recodificar
              </>
            ) : (
              <>
                <DeveloperBoard16Regular /> H.264 · {encoder ? encoder.label : "detectando…"}
              </>
            )}
          </span>
        </div>
        <p className="t-body-strong tabular mt-0.5">
          {formatDuration(end - start)} · {plan.width}×{plan.height} · {formatFps(outFps)} fps
        </p>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div key="err" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <InfoBar
              severity="critical"
              title="No se pudo exportar"
              message={error.message}
              testId="export-error"
              action={
                error.detail ? (
                  <div>
                    <button type="button" className="t-caption flex items-center gap-1 text-[var(--accent-text)]" onClick={() => setShowDetail((v) => !v)}>
                      Ver detalles
                      <motion.span animate={{ rotate: showDetail ? 180 : 0 }} className="flex">
                        <ChevronDown12Regular />
                      </motion.span>
                    </button>
                    {showDetail && (
                      <pre className="t-caption mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-[4px] bg-black/20 p-2 font-mono text-[11px] select-text">
                        {error.detail}
                      </pre>
                    )}
                  </div>
                ) : undefined
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Button variant="accent" size="lg" className="w-full" icon={<ArrowExport20Regular />} onClick={() => void startExport()} data-testid="export-btn">
        {error ? "Reintentar" : "Exportar"}
        <kbd className="kbd ml-1">Ctrl+E</kbd>
      </Button>
    </div>
  );
}
