import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Info16Regular, Play24Filled, VideoAdd20Regular, Warning20Regular } from "@fluentui/react-icons";
import type { Project } from "../../project/model";
import { activeAt, layout } from "../../project/timeline";
import { heavyReason, needsHeavy } from "../../project/heavy";
import { basename } from "../../lib/files";
import { activeTab, useEditor } from "../../store/editor";
import { addVideosWithDialog, player, proxyNeed, relinkMedia } from "../../store/controller";
import { Button } from "../ui/Button";
import { ProgressRing } from "../ui/Progress";
import { Tooltip } from "../ui/Tooltip";
import { clipGeometry } from "../../project/geometry";
import { CropEditor, ZoomEditor } from "./ImageEditors";
import { OverlayEditor, selectOverlayAt } from "./OverlayEditor";
import { setChroma } from "../inspector/video/ChromaEditor";
import { toHex } from "../../engine/chroma";

/** Gotero del chroma key: un clic en el PiP toma el color de fondo; Esc cancela. */
function EyedropperLayer({ id }: { id: string }) {
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      useEditor.setState({ eyedropper: null });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div
      className="eyedropper-layer absolute inset-0 z-20"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const rgb = player().pipColorAt(id, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        if (!rgb) {
          setHint("Tocá dentro del video del PiP");
          return;
        }
        setChroma(id, (k) => (k ? { ...k, color: toHex(rgb) } : k));
        useEditor.setState({ eyedropper: null });
      }}
      data-testid="eyedropper-layer"
    >
      <span className="eyedropper-hint t-caption pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-[4px] px-2 py-1">{hint ?? "Tocá el color de fondo del PiP · Esc cancela"}</span>
    </div>
  );
}

/** Preview: canvas WebGL encajado con la proporción del lienzo. */
export function Preview({ project }: { project: Project }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const playing = useEditor((s) => s.playing);
  const time = useEditor((s) => s.time);
  const missing = useEditor((s) => activeTab(s)?.missing ?? []);
  const heavy = useEditor((s) => s.heavy);
  const proxies = useEditor((s) => s.proxies);
  const [glFailed, setGlFailed] = useState(false);
  const imageEdit = useEditor((s) => s.imageEdit);
  const eyedropper = useEditor((s) => s.eyedropper);
  const overlaySelected = useEditor((s) => {
    const sel = activeTab(s)?.selection ?? [];
    return project.overlays.some((o) => sel.includes(o.id));
  });
  const editClip = imageEdit ? project.clips.find((c) => c.id === imageEdit.clipId) ?? null : null;
  const editMedia = editClip ? project.media.find((m) => m.id === editClip.mediaId) ?? null : null;
  // Recortando: el preview muestra el cuadro completo del clip (con su proporción).
  const cropping = imageEdit?.mode === "crop" && editClip && editMedia;
  const full = cropping ? clipGeometry(editClip.video, editMedia) : null;
  const aspect = full ? full.fullWidth / full.fullHeight : project.canvas.width / project.canvas.height;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const w = Math.min(width, height * aspect);
      setSize({ w: Math.floor(w), h: Math.floor(w / aspect) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
    const pl = player();
    pl.attachCanvas(canvas.current);
    setGlFailed(!pl.hasRenderer());
    return () => pl.attachCanvas(null);
  }, []);

  // Resolución interna: la del lienzo, o menos si el preview es más chico (rendimiento).
  useEffect(() => {
    if (!size.w || !canvas.current) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(project.canvas.width, Math.round(size.w * dpr));
    const h = Math.round(w / aspect);
    canvas.current.width = w;
    canvas.current.height = h;
    player().setRenderSize(w, h);
  }, [size.w, project.canvas.width, aspect]);

  const spans = layout(project.clips);
  const frame = activeAt(spans, time);
  const clip = frame ? project.clips[frame.b ?? frame.a] : null;
  const media = clip ? project.media.find((m) => m.id === clip.mediaId) : null;
  const isMissing = !!media && missing.includes(media.id);
  const h = clip && needsHeavy(clip) ? heavy[clip.id] : undefined;
  const preparing = h?.status === "pending";
  const proxy = media ? proxies[media.path] : undefined;
  // Grabaciones con varias pistas o HDR: proxy que mezcla/convierte (no bloquea el preview).
  const need = media && clip ? proxyNeed(media, clip.audio.track) : null;
  const mix = need ? proxies[need.key] : undefined;
  const empty = project.clips.length === 0;

  return (
    <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center" data-testid="player">
      <div className="video-well group relative overflow-hidden rounded-[8px]" style={{ width: size.w, height: size.h }}>
        <canvas
          ref={canvas}
          className="absolute inset-0 h-full w-full"
          onClick={(e) => {
            if (imageEdit) return;
            // Click sobre un texto o logo: lo selecciona (si no, play/pausa).
            if (!selectOverlayAt(project, e, e.currentTarget.parentElement!)) player().toggle();
          }}
          data-testid="preview-canvas"
        />
        {!imageEdit && <OverlayEditor project={project} />}
        {eyedropper && <EyedropperLayer id={eyedropper} />}
        {cropping && <CropEditor clip={editClip} media={editMedia} />}
        {imageEdit?.mode === "zoom" && editClip && <ZoomEditor clip={editClip} keyId={imageEdit.keyId} />}

        {glFailed && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="t-body text-white/70">Este equipo no pudo iniciar la aceleración gráfica para la vista previa. La exportación funciona igual.</p>
          </div>
        )}

        <AnimatePresence>
          {empty && (
            <motion.div key="empty" className="absolute inset-0 flex flex-col items-center justify-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="t-subtitle text-white">El proyecto está vacío</p>
              <p className="t-caption text-white/60">Arrastrá videos a la ventana o agregalos con el botón.</p>
              <Button variant="accent" icon={<VideoAdd20Regular />} onClick={() => void addVideosWithDialog()}>
                Agregar videos
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isMissing && media && (
            <motion.div key="missing" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 p-6 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="missing-media">
              <Warning20Regular className="text-[28px] text-[var(--caution)]" />
              <p className="t-body-strong text-white">No encontramos «{basename(media.path)}»</p>
              <p className="t-caption max-w-[360px] text-white/60">Puede que se haya movido o borrado. Buscalo para seguir editando; el resto del proyecto está intacto.</p>
              <Button onClick={() => void relinkMedia(media.id)} data-testid="relink">
                Buscar archivo
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {proxy?.status === "pending" && (
            <motion.div key="proxy" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--video-well)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="proxy-progress">
              <ProgressRing size={36} stroke={3} />
              <div className="text-center">
                <p className="t-body-strong text-white">Preparando la vista previa… {Math.round(proxy.percent)}%</p>
                <p className="t-caption mt-1 max-w-[340px] text-white/60">
                  Este equipo no puede mostrar este video directo (probablemente HEVC). Generamos una copia liviana solo para mirar; la exportación usa el original.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Avisos discretos arriba a la izquierda */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
          <AnimatePresence>
            {preparing && clip && (
              <motion.span
                key="prep"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="proxy-chip t-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                data-testid="preparing-chip"
              >
                <ProgressRing size={12} stroke={1.5} className="!text-white" />
                Preparando vista previa · {heavyReason(clip)} {Math.round(h!.status === "pending" ? h!.percent : 0)}%
              </motion.span>
            )}
            {mix?.status === "pending" && !preparing && (
              <motion.span
                key="mix"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="proxy-chip t-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                data-testid="mix-chip"
              >
                <ProgressRing size={12} stroke={1.5} className="!text-white" />
                {need!.transfer ? "Convirtiendo HDR" : "Mezclando pistas de audio"} {Math.round(mix.percent)}%
              </motion.span>
            )}
            {(proxy?.status === "ready" || mix?.status === "ready") && (
              <motion.span key="proxy-chip" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-auto">
                <Tooltip
                  content={
                    mix?.status === "ready"
                      ? "Mostramos una copia 720p con las pistas de audio mezcladas (y el HDR convertido) tal como va a salir. La exportación usa el archivo original, con su calidad completa."
                      : "Tu equipo no reproduce este códec en la app, así que mostramos una copia 720p. La exportación siempre usa el archivo original, con su calidad completa."
                  }
                  placement="bottom"
                >
                  <span className="proxy-chip t-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" data-testid="proxy-chip" tabIndex={0}>
                    <Info16Regular /> Vista previa optimizada
                  </span>
                </Tooltip>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {!playing && !empty && !isMissing && !imageEdit && !overlaySelected && (
          <motion.button
            type="button"
            aria-label="Reproducir"
            onClick={(e) => {
              if (!selectOverlayAt(project, e, e.currentTarget.parentElement!)) player().toggle();
            }}
            className="big-play absolute left-1/2 top-1/2 -ml-8 -mt-8 flex h-16 w-16 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            data-testid="big-play"
          >
            <Play24Filled className="ml-0.5 text-[28px]" />
          </motion.button>
        )}
      </div>
    </div>
  );
}
