// Pistas de superposiciones (textos, logos…) y de subtítulos: cada capa se
// mueve en el tiempo y entre filas, y se recorta por los bordes.

import { openContextMenu } from "../ui/ContextMenu";
import { itemMenu } from "../../store/clipboard";
import { motion, useReducedMotion } from "motion/react";
import { Blur16Regular, Image16Regular, PictureInPicture16Regular, TextT16Regular } from "@fluentui/react-icons";
import type { Cue, Overlay, Project } from "../../project/model";
import { moveOverlay, trimOverlay, updateCue } from "../../project/overlayOps";
import { snap, snapPoints } from "../../project/ops";
import { basename } from "../../lib/files";
import { groupOf, shiftGroup } from "../../project/clipboard";
import { activeTab, edit, gestureEnd, gestureStart, setSelection, useEditor, type InspectorTab } from "../../store/editor";
import { player } from "../../store/controller";
import { OVERLAY_H, tToX, type Geo } from "./geometry";

/** Filas que ocupan las superposiciones (0 si no hay ninguna). */
export function overlayLanes(p: Project): number {
  return p.overlays.length ? Math.max(...p.overlays.map((o) => o.lane)) + 1 : 0;
}

type Mode = "move" | "in" | "out";

/**
 * Arrastre genérico: devuelve el desplazamiento en segundos (con imán al
 * borde más cercano) y en filas. Un click sin mover selecciona.
 */
function itemDrag(
  e: React.PointerEvent,
  geo: Geo,
  project: Project,
  ignore: string[],
  snapOn: boolean,
  edges: (dt: number) => number[],
  apply: (dt: number, dLane: number) => void,
  onClick: () => void,
) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let started = false;
  const pts = snapOn ? snapPoints(project, useEditor.getState().time, ignore) : [];
  const thr = 8 / geo.pps;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!started) {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      started = true;
      gestureStart();
    }
    let dt = dx / geo.pps;
    // Imán: el primer borde que caiga cerca de un punto de anclaje.
    for (const t of edges(dt)) {
      const s = snap(t, pts, thr);
      if (s.snapped) {
        dt += s.time - t;
        break;
      }
    }
    apply(dt, Math.round(dy / OVERLAY_H));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (started) gestureEnd();
    else onClick();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function select(id: string, tab: InspectorTab) {
  setSelection([id]);
  useEditor.setState({ inspectorTab: tab, inspectorOpen: true });
}

function overlayLabel(p: Project, o: Overlay): string {
  if (o.type === "text") return o.text.replace(/\s+/g, " ").trim() || "Texto";
  if (o.type === "image" || o.type === "video") {
    const m = p.media.find((x) => x.id === o.mediaId);
    return m ? basename(m.path) : "Imagen";
  }
  return o.mode === "pixelate" ? "Pixelado" : "Desenfoque";
}

function OverlayItem({ project, o, geo, selected, snapOn }: { project: Project; o: Overlay; geo: Geo; selected: boolean; snapOn: boolean }) {
  const reduce = useReducedMotion();
  const x = tToX(geo, o.start);
  const w = Math.max(8, o.duration * geo.pps);
  const lanes = overlayLanes(project);
  const down = (mode: Mode) => (e: React.PointerEvent) => {
    const origin = project;
    const o0 = o;
    const mates = (groupOf(origin, o0.id) ?? []).filter((id) => id !== o0.id);
    itemDrag(
      e,
      geo,
      origin,
      [o0.id],
      snapOn,
      (dt) => (mode === "move" ? [o0.start + dt, o0.start + o0.duration + dt] : mode === "in" ? [o0.start + dt] : [o0.start + o0.duration + dt]),
      (dt, dl) =>
        edit(() => {
          if (mode !== "move") return trimOverlay(origin, o0.id, mode, mode === "in" ? o0.start + dt : o0.start + o0.duration + dt);
          const moved = moveOverlay(origin, o0.id, o0.start + dt, Math.min(lanes, Math.max(0, o0.lane + dl)));
          // Los demás del grupo se corren lo mismo.
          const real = (moved.overlays.find((x) => x.id === o0.id)?.start ?? o0.start) - o0.start;
          return mates.length ? shiftGroup(moved, mates, real) : moved;
        }),
      () => select(o0.id, o0.type === "text" ? "text" : "video"),
    );
  };
  const Icon = o.type === "text" ? TextT16Regular : o.type === "video" ? PictureInPicture16Regular : o.type === "blur" ? Blur16Regular : Image16Regular;
  return (
    <motion.div
      layout={reduce ? false : "position"}
      transition={{ type: "spring", stiffness: 520, damping: 42 }}
      className={`tl-overlay tl-overlay-${o.type} absolute ${selected ? "is-selected" : ""}`}
      style={{ left: x, width: w, top: o.lane * OVERLAY_H + 2, height: OVERLAY_H - 4 }}
      onPointerDown={down("move")}
      onContextMenu={(e) => openContextMenu(e, itemMenu(o.id))}
      role="button"
      aria-label={`${o.type === "text" ? "Texto" : o.type === "video" ? "Picture-in-picture" : o.type === "blur" ? "Zona" : "Imagen"}: ${overlayLabel(project, o)}`}
      data-testid="overlay-item"
      data-overlay-id={o.id}
    >
      <span className="pointer-events-none flex h-full items-center gap-1 overflow-hidden px-1.5">
        {w > 26 && <Icon className="shrink-0" />}
        {w > 50 && <span className="t-caption truncate">{overlayLabel(project, o)}</span>}
      </span>
      <div className="tl-trim absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={down("in")} data-testid="overlay-trim-in" />
      <div className="tl-trim absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={down("out")} data-testid="overlay-trim-out" />
    </motion.div>
  );
}

/** Filas de superposiciones (una por "lane"). */
export function OverlayTrack({ project, geo, snapOn }: { project: Project; geo: Geo; snapOn: boolean }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const lanes = overlayLanes(project);
  return (
    <div className="tl-track tl-overlay-track relative" style={{ height: lanes * OVERLAY_H }} data-testid="overlay-track">
      {project.overlays.map((o) => (
        <OverlayItem key={o.id} project={project} o={o} geo={geo} selected={selection.includes(o.id)} snapOn={snapOn} />
      ))}
    </div>
  );
}

function CueItem({ project, c, geo, selected, snapOn }: { project: Project; c: Cue; geo: Geo; selected: boolean; snapOn: boolean }) {
  const x = tToX(geo, c.start);
  const w = Math.max(6, (c.end - c.start) * geo.pps);
  const down = (mode: Mode) => (e: React.PointerEvent) => {
    const origin = project;
    const c0 = c;
    itemDrag(
      e,
      geo,
      origin,
      [c0.id],
      snapOn,
      (dt) => (mode === "move" ? [c0.start + dt, c0.end + dt] : mode === "in" ? [c0.start + dt] : [c0.end + dt]),
      (dt) => {
        const d = mode === "move" ? Math.max(-c0.start, dt) : dt;
        edit(() =>
          updateCue(origin, c0.id, mode === "move" ? { start: c0.start + d, end: c0.end + d } : mode === "in" ? { start: Math.min(c0.end - 0.2, c0.start + d) } : { end: c0.end + d }),
        );
      },
      () => {
        select(c0.id, "text");
        player().pause();
        player().seek(c0.start);
      },
    );
  };
  return (
    <div
      className={`tl-overlay tl-cue absolute ${selected ? "is-selected" : ""}`}
      style={{ left: x, width: w, top: 2, height: OVERLAY_H - 4 }}
      onPointerDown={down("move")}
      onContextMenu={(e) => openContextMenu(e, itemMenu(c.id))}
      role="button"
      aria-label={`Subtítulo: ${c.text}`}
      data-testid="cue-item"
    >
      <span className="t-caption pointer-events-none block truncate px-1.5 leading-[22px]">{w > 30 ? c.text.replace(/\n/g, " ") : ""}</span>
      <div className="tl-trim absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={down("in")} />
      <div className="tl-trim absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={down("out")} />
    </div>
  );
}

/** Fila de subtítulos. */
export function SubtitleTrack({ project, geo, snapOn }: { project: Project; geo: Geo; snapOn: boolean }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const visible = project.subtitles.cues.filter((c) => tToX(geo, c.end) > 0 && tToX(geo, c.start) < geo.width);
  return (
    <div className="tl-track relative" style={{ height: OVERLAY_H }} data-testid="subtitle-track">
      {visible.map((c) => (
        <CueItem key={c.id} project={project} c={c} geo={geo} selected={selection.includes(c.id)} snapOn={snapOn} />
      ))}
    </div>
  );
}
