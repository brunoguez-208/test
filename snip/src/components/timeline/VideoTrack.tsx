import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowRepeatAll16Regular,
  ArrowSync16Regular,
  ArrowUndo16Regular,
  Image16Regular,
  SpeakerMute16Regular,
  Sparkle16Regular,
} from "@fluentui/react-icons";
import type { Clip, MediaRef, Project } from "../../project/model";
import { layout, passes, type Span } from "../../project/timeline";
import { moveClip, snap, snapPoints, trimClip } from "../../project/ops";
import { needsHeavy } from "../../project/heavy";
import { basename } from "../../lib/files";
import { edit, gestureEnd, gestureStart, setSelection, useEditor, activeTab } from "../../store/editor";
import { player, quantizeThumbTime, requestThumbs, thumbKey } from "../../store/controller";
import { PAD_X, VIDEO_H, tToX, useDrag, type Geo } from "./geometry";
import { ProgressRing } from "../ui/Progress";

const THUMB_H = 48;

/** Paso de las miniaturas (en segundos del original) según el zoom: valores "redondos" para cachear. */
function thumbStep(secondsPerTile: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300];
  return steps.find((s) => s >= secondsPerTile * 0.75) ?? 300;
}

interface ClipViewProps {
  clip: Clip;
  /** Cambia solo cuando cambia el orden de los clips: ahí (y solo ahí) se anima el reacomodo. */
  order: string;
  media: MediaRef | undefined;
  span: Span;
  geo: Geo;
  selected: boolean;
  dragging: boolean;
  dragX: number;
  missing: boolean;
  onBodyDown: (e: React.PointerEvent) => void;
  onTrimDown: (edge: "in" | "out") => (e: React.PointerEvent) => void;
}

const ClipView = memo(function ClipView({ clip, order, media, span, geo, selected, dragging, dragX, missing, onBodyDown, onTrimDown }: ClipViewProps) {
  const reduce = useReducedMotion();
  const heavy = useEditor((s) => s.heavy[clip.id]);
  const x = tToX(geo, span.start);
  const w = Math.max(6, span.duration * geo.pps);
  const aspect = media && media.height ? media.width / media.height : 16 / 9;
  const tileW = Math.max(40, Math.round(THUMB_H * aspect));
  // Solo las miniaturas visibles (virtualizado).
  const visStart = Math.max(0, -x);
  const visEnd = Math.min(w, geo.width - x);
  const firstTile = Math.floor(visStart / tileW);
  const lastTile = Math.ceil(visEnd / tileW);
  const secPerTile = (tileW / geo.pps) * clip.speed;
  const step = thumbStep(secPerTile);
  const tiles: { i: number; key: string; time: number }[] = [];
  if (media && media.kind === "video") {
    for (let i = firstTile; i < lastTile; i++) {
      const u = Math.min(span.duration, (i + 0.5) * (tileW / geo.pps));
      const src = sourceTimeOf(clip, u);
      const time = clip.kind === "freeze" ? quantizeThumbTime(clip.inPoint, 0.1) : quantizeThumbTime(src, step);
      tiles.push({ i, key: thumbKey(media.path, time, 96), time });
    }
  }
  const tileKeys = tiles.map((t) => t.key).join(",");
  // Solo las miniaturas de este clip (no re-renderiza cuando llegan las de otros).
  const thumbs = useEditor(useShallow((s) => tiles.map((t) => s.thumbs[t.key] ?? null)));
  useEffect(() => {
    if (!media || missing) return;
    requestThumbs(tiles.map((t) => ({ path: media.path, time: t.time })), 96);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileKeys, media?.path, missing]);

  const badges: React.ReactNode[] = [];
  if (clip.kind === "freeze") badges.push(<Image16Regular key="fz" aria-label="Cuadro congelado" />);
  if (clip.speed !== 1) badges.push(<span key="sp" className="tabular">{fmtSpeed(clip.speed)}</span>);
  if (clip.smoothSlowmo && clip.speed < 1) badges.push(<Sparkle16Regular key="sm" aria-label="Cámara lenta suave" />);
  if (clip.reverse) badges.push(<ArrowUndo16Regular key="rv" aria-label="Invertido" />);
  if (clip.loopMode === "loop") badges.push(<span key="lp" className="flex items-center gap-0.5"><ArrowRepeatAll16Regular />×{clip.loopCount}</span>);
  if (clip.loopMode === "boomerang") badges.push(<span key="bm" className="flex items-center gap-0.5"><ArrowSync16Regular />×{clip.loopCount}</span>);
  if (clip.audio.muted || clip.audio.removed) badges.push(<SpeakerMute16Regular key="mu" aria-label="Sin sonido" />);

  return (
    <motion.div
      layout={!dragging && !reduce ? "position" : false}
      layoutDependency={order}
      transition={{ type: "spring", stiffness: 520, damping: 42 }}
      className={`tl-clip absolute top-0 ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""} ${missing ? "is-missing" : ""}`}
      style={{ left: x + (dragging ? dragX : 0), width: w, height: VIDEO_H, zIndex: dragging ? 20 : selected ? 5 : 1 }}
      onPointerDown={onBodyDown}
      data-testid="clip"
      data-clip-id={clip.id}
      data-selected={selected}
      role="button"
      aria-label={`${media ? basename(media.path) : "Clip"}${selected ? " (seleccionado)" : ""}`}
    >
      <div className="tl-clip-thumbs absolute inset-0 overflow-hidden rounded-[6px]">
        {tiles.map((t, ti) => (
          <div key={t.i} className="absolute top-0 h-full" style={{ left: t.i * tileW, width: tileW }}>
            {thumbs[ti] ? (
              <img src={thumbs[ti]!} alt="" draggable={false} className="tl-thumb h-full w-full object-cover" data-testid="thumb" />
            ) : (
              <div className="skeleton h-full w-full" data-testid="thumb-skeleton" />
            )}
          </div>
        ))}
        <div className="tl-clip-shade pointer-events-none absolute inset-0" />
      </div>
      <div className="pointer-events-none absolute inset-x-1.5 top-1 flex items-center gap-1.5 overflow-hidden">
        {w > 70 && <span className="tl-clip-name t-caption truncate">{media ? basename(media.path) : "Archivo faltante"}</span>}
        {badges.length > 0 && w > 36 && <span className="tl-badges t-caption flex shrink-0 items-center gap-1 rounded-[4px] px-1">{badges}</span>}
      </div>
      <AnimatePresence>
        {needsHeavy(clip) && heavy?.status === "pending" && (
          <motion.span
            key="heavy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="tl-heavy t-caption absolute bottom-1 left-1.5 flex items-center gap-1 rounded-full px-1.5"
            data-testid="clip-preparing"
          >
            <ProgressRing size={10} stroke={1.5} /> {Math.round(heavy.percent)}%
          </motion.span>
        )}
      </AnimatePresence>
      <div className="tl-clip-outline pointer-events-none absolute inset-0 rounded-[6px]" />
      {clip.kind === "video" && (
        <>
          <div className="tl-trim tl-trim-in absolute inset-y-0 left-0 w-2 cursor-ew-resize" onPointerDown={onTrimDown("in")} data-testid="trim-in" />
          <div className="tl-trim tl-trim-out absolute inset-y-0 right-0 w-2 cursor-ew-resize" onPointerDown={onTrimDown("out")} data-testid="trim-out" />
        </>
      )}
    </motion.div>
  );
});

function fmtSpeed(s: number): string {
  const r = Math.round(s * 100) / 100;
  return `${String(r).replace(".", ",")}×`;
}

function sourceTimeOf(c: Clip, u: number): number {
  if (c.kind === "freeze") return c.inPoint;
  const seg = Math.max(1e-3, (c.outPoint - c.inPoint) / c.speed);
  const pass = Math.floor(u / seg);
  let fwd = c.loopMode === "boomerang" ? pass % 2 === 0 : true;
  if (c.reverse) fwd = !fwd;
  const off = (u - pass * seg) * c.speed;
  return fwd ? Math.min(c.outPoint, c.inPoint + off) : Math.max(c.inPoint, c.outPoint - off);
}

interface DragState {
  kind: "move" | "trim";
  id: string;
  edge?: "in" | "out";
  grab: number;
  startIndex: number;
  origin: Project;
  moved?: boolean;
}

/** Pista principal de video: clips magnéticos con miniaturas. */
export function VideoTrack({ project, geo, snapOn }: { project: Project; geo: Geo; snapOn: boolean }) {
  const tab = useEditor((s) => activeTab(s));
  const selection = tab?.selection ?? [];
  const missing = tab?.missing ?? [];
  const spans = useMemo(() => layout(project.clips), [project.clips]);
  const order = project.clips.map((c) => c.id).join(",");
  // Arrastre de un clip: dx del puntero y dónde empezaba (para que siga al puntero aunque se reordene).
  const [drag, setDrag] = useState<{ id: string; dx: number; s0: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const select = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
    if (multi) setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
    else setSelection([id]);
  };

  const bodyDown = useDrag<DragState>({
    start: (e) => {
      const el = (e.target as HTMLElement).closest("[data-clip-id]") as HTMLElement | null;
      if (!el) return null;
      const id = el.dataset.clipId!;
      return { kind: "move", id, grab: 0, startIndex: project.clips.findIndex((c) => c.id === id), origin: project };
    },
    move: (st, dx) => {
      if (!st.moved) {
        st.moved = true;
        gestureStart();
        player().pause();
      }
      setDrag({ id: st.id, dx, s0: layout(st.origin.clips)[st.startIndex].start });
      // Reordenar en vivo: el clip cae donde está el puntero; los demás se corren con spring.
      const p = st.origin;
      const sp = layout(p.clips);
      const i = st.startIndex;
      const center = sp[i].start + sp[i].duration / 2 + dx / geo.pps;
      let target = 0;
      for (let k = 0; k < p.clips.length; k++) {
        if (k === i) continue;
        const mid = sp[k].start + sp[k].duration / 2;
        if (center > mid) target++;
      }
      edit(() => moveClip(p, st.id, target));
    },
    end: (st, moved, e) => {
      setDrag(null);
      if (moved) gestureEnd();
      else select(st.id, e);
    },
  });

  const trimDown = (edge: "in" | "out") => makeTrimHandler(edge, project, geo, snapOn);

  return (
    <div ref={trackRef} className="tl-track relative" style={{ height: VIDEO_H }} data-testid="video-track">
      {project.clips.map((c, i) => {
        const m = project.media.find((x) => x.id === c.mediaId);
        const dragging = drag?.id === c.id;
        return (
          <ClipView
            key={c.id}
            clip={c}
            order={order}
            media={m}
            span={spans[i]}
            geo={geo}
            selected={selection.includes(c.id)}
            dragging={dragging}
            dragX={dragging ? drag!.dx + (drag!.s0 - spans[i].start) * geo.pps : 0}
            missing={!!m && missing.includes(m.id)}
            onBodyDown={bodyDown}
            onTrimDown={trimDown}
          />
        );
      })}
      {/* Transiciones: un botón en cada unión */}
      {project.clips.map((c, i) => {
        if (i === 0) return null;
        const x = tToX(geo, spans[i].start + spans[i].transitionIn / 2);
        if (x < -20 || x > geo.width + 20) return null;
        const has = !!c.transition && spans[i].transitionIn > 0;
        return (
          <motion.button
            key={`tr-${c.id}`}
            type="button"
            className={`tl-junction absolute z-10 flex items-center justify-center rounded-full ${has ? "has-transition" : ""}`}
            style={{ left: x - 9, top: VIDEO_H / 2 - 9, width: 18, height: 18 }}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            aria-label={has ? "Editar transición" : "Agregar transición"}
            title={has ? "Transición" : "Agregar transición"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setSelection([c.id]);
              useEditor.setState({ inspectorOpen: true, inspectorTab: "clip" });
              window.dispatchEvent(new CustomEvent("snip:focus-transition"));
            }}
            data-testid="junction"
          >
            <span className="tl-junction-dot" />
          </motion.button>
        );
      })}
      {project.clips.length === 0 && (
        <div className="t-caption absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)]" style={{ left: PAD_X }}>
          Arrastrá videos acá para empezar
        </div>
      )}
    </div>
  );
}

/** Recortar un borde del clip (ripple: lo que sigue se corre). */
function makeTrimHandler(edge: "in" | "out", project: Project, geo: Geo, snapOn: boolean) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = (e.target as HTMLElement).closest("[data-clip-id]") as HTMLElement | null;
    if (!el) return;
    const id = el.dataset.clipId!;
    const origin = project;
    const i = origin.clips.findIndex((c) => c.id === id);
    const c = origin.clips[i];
    const sp = layout(origin.clips)[i];
    const x0 = e.clientX;
    let started = false;
    player().pause();
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!started) {
        if (Math.abs(dx) < 2) return;
        started = true;
        gestureStart();
      }
      let edgeT = (edge === "in" ? sp.start : sp.end) + dx / geo.pps;
      if (snapOn) {
        const pts = snapPoints(origin, useEditor.getState().time, [id]);
        edgeT = snap(edgeT, pts, 8 / geo.pps).time;
      }
      const delta = edgeT - (edge === "in" ? sp.start : sp.end);
      // Borde izquierdo: corre el inicio del contenido; derecho: el final.
      const srcDelta = (delta * c.speed) / passes(c);
      const field = edge === "in" ? (c.reverse ? c.outPoint - srcDelta : c.inPoint + srcDelta) : c.reverse ? c.inPoint - srcDelta : c.outPoint + srcDelta;
      edit(() => trimClip(origin, id, edge, field));
      // El preview muestra el cuadro del borde.
      const now = layout((useEditor.getState().tabs.find((t) => t.id === useEditor.getState().active)?.history.present ?? origin).clips)[i];
      if (now) player().seek(edge === "in" ? now.start : Math.max(now.start, now.end - player().frameDur()));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (started) gestureEnd();
      else setSelection([id]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
}
