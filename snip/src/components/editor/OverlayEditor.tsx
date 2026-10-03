// Textos y logos sobre el preview: click selecciona, arrastrar mueve (con guías
// e imán al centro) y la manija de la esquina cambia el tamaño.

import { useState } from "react";
import type { BlurLayer, ImageLayer, Overlay, Project, TextLayer } from "../../project/model";
import { canvasFps } from "../../project/model";
import { pipRect, rectAt, setBlurRectAt, updateOverlay } from "../../project/overlayOps";
import { dragCrop } from "./ImageEditors";
import { imageRect, isActive, measureText } from "../../engine/raster";
import { activeTab, edit, gestureEnd, gestureStart, setSelection, useEditor } from "../../store/editor";
import { requestTextFocus } from "../../store/controller";

type Box = { x: number; y: number; w: number; h: number };

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx2d(): CanvasRenderingContext2D | null {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

/** Caja de la capa en coordenadas normalizadas del lienzo (0..1). */
export function overlayBox(p: Project, o: Overlay): Box | null {
  const W = p.canvas.width;
  const H = p.canvas.height;
  if (o.type === "text") {
    const c = ctx2d();
    if (!c || !o.text.trim()) return null;
    const b = measureText(c, o.text, (o as TextLayer).style, o.x, o.y, W, H);
    const pad = (o as TextLayer).style.background ? (o as TextLayer).style.background!.padding * b.fontPx : b.fontPx * 0.1;
    return { x: (b.x - pad) / W, y: (b.y - pad * 0.6) / H, w: (b.w + pad * 2) / W, h: (b.h + pad * 1.2) / H };
  }
  if (o.type === "image") {
    const m = p.media.find((x) => x.id === (o as ImageLayer).mediaId);
    if (!m) return null;
    const r = imageRect(o as ImageLayer, m, W, H);
    return { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H };
  }
  if (o.type === "video") {
    const m = p.media.find((x) => x.id === o.mediaId);
    if (!m) return null;
    const r = pipRect(o, m, W, H);
    return { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H };
  }
  if (o.type === "blur") return rectAt(o, useEditor.getState().time - o.start);
  return null;
}

/** Capa visible bajo el punto (la de más arriba), o null. */
export function hitOverlay(p: Project, t: number, nx: number, ny: number): Overlay | null {
  // Lo de más arriba primero: textos/logos, después PiP, después zonas.
  const rank = (o: Overlay) => (o.type === "text" || o.type === "image" ? 2 : o.type === "video" ? 1 : 0);
  const vis = p.overlays.filter((o) => isActive(o, t)).sort((a, b) => rank(b) - rank(a) || b.lane - a.lane || b.start - a.start);
  for (const o of vis) {
    const b = overlayBox(p, o);
    if (b && nx >= b.x && nx <= b.x + b.w && ny >= b.y && ny <= b.y + b.h) return o;
  }
  return null;
}

const SNAP = 0.012;

/** Arrastra una capa: mueve el centro (o escala desde la esquina). */
export function dragOverlay(e: React.PointerEvent, p: Project, o: Overlay, box: HTMLElement, mode: "move" | "scale", onGuides: (g: { x: boolean; y: boolean }) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const r = box.getBoundingClientRect();
  const x0 = e.clientX;
  const y0 = e.clientY;
  const start = o as Overlay & { x: number; y: number };
  const b0 = overlayBox(p, o);
  let started = false;
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - x0) / r.width;
    const dy = (ev.clientY - y0) / r.height;
    if (!started) {
      if (Math.abs(ev.clientX - x0) < 2 && Math.abs(ev.clientY - y0) < 2) return;
      started = true;
      gestureStart();
    }
    if (mode === "move") {
      let x = start.x + dx;
      let y = start.y + dy;
      const gx = Math.abs(x - 0.5) < SNAP;
      const gy = Math.abs(y - 0.5) < SNAP;
      if (gx) x = 0.5;
      if (gy) y = 0.5;
      onGuides({ x: gx, y: gy });
      x = Math.min(1, Math.max(0, x));
      y = Math.min(1, Math.max(0, y));
      edit(() => updateOverlay(p, o.id, (z) => ({ ...z, x, y }) as Overlay));
    } else if (b0) {
      // Escala proporcional a cuánto se alejó la esquina del centro.
      const cx = b0.x + b0.w / 2;
      const cy = b0.y + b0.h / 2;
      const d0 = Math.hypot((b0.w / 2) * r.width, (b0.h / 2) * r.height);
      const d1 = Math.hypot((b0.x + b0.w + dx - cx) * r.width, (b0.y + b0.h + dy - cy) * r.height);
      const k = Math.max(0.1, d1 / Math.max(1, d0));
      edit(() =>
        updateOverlay(p, o.id, (z) => {
          if (z.type === "text") return { ...z, style: { ...z.style, size: Math.min(0.4, Math.max(0.015, (o as TextLayer).style.size * k)) } };
          if (z.type === "image") return { ...z, width: Math.min(1.5, Math.max(0.02, (o as ImageLayer).width * k)) };
          if (z.type === "video" && o.type === "video") return { ...z, width: Math.min(1, Math.max(0.08, o.width * k)) };
          return z;
        }),
      );
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onGuides({ x: false, y: false });
    if (started) gestureEnd();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Recuadro de la capa seleccionada (si se ve en el cuadro actual). */
export function OverlayEditor({ project }: { project: Project }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const time = useEditor((s) => s.time);
  const [guides, setGuides] = useState({ x: false, y: false });
  const o = project.overlays.find((x) => selection.includes(x.id) && isActive(x, time));
  if (o?.type === "blur") return <ZoneEditor project={project} o={o as Overlay & BlurLayer & { type: "blur" }} time={time} />;
  const box = o ? overlayBox(project, o) : null;
  if (!o || !box) return null;
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="overlay-editor">
      {guides.x && <span className="overlay-guide overlay-guide-v absolute inset-y-0 left-1/2" />}
      {guides.y && <span className="overlay-guide overlay-guide-h absolute inset-x-0 top-1/2" />}
      <div
        className="overlay-box pointer-events-auto absolute"
        style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
        onPointerDown={(e) => dragOverlay(e, project, o, e.currentTarget.parentElement!, "move", setGuides)}
        onDoubleClick={() => {
          if (o.type === "text") {
            useEditor.setState({ inspectorTab: "text", inspectorOpen: true });
            requestTextFocus();
          }
        }}
        data-testid="overlay-box"
      >
        <span
          className="crop-handle crop-handle-se pointer-events-auto"
          onPointerDown={(e) => dragOverlay(e, project, o, e.currentTarget.parentElement!.parentElement!, "scale", setGuides)}
          data-testid="overlay-scale"
        />
      </div>
    </div>
  );
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

/** Zona desenfocada: mover y redimensionar con manijas (con keyframes, edita el del cuadro actual). */
function ZoneEditor({ project, o, time }: { project: Project; o: Overlay & BlurLayer & { type: "blur" }; time: number }) {
  const [active, setActive] = useState<string | null>(null);
  const r = rectAt(o, time - o.start);
  const down = (h: (typeof HANDLES)[number] | "move") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).closest("[data-zone-box]") as HTMLElement;
    const rr = box.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const from = { ...r };
    const u = time - o.start;
    let started = false;
    setActive(h);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / rr.width;
      const dy = (ev.clientY - y0) / rr.height;
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 2 && Math.abs(ev.clientY - y0) < 2) return;
        started = true;
        gestureStart();
      }
      const n = dragCrop(from, h, dx, dy, null);
      edit(() => setBlurRectAt(project, o.id, u, { x: n.x, y: n.y, w: n.w, h: n.h }, 1 / canvasFps(project.canvas)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setActive(null);
      if (started) gestureEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div className="pointer-events-none absolute inset-0" data-zone-box data-testid="zone-editor">
      <div
        className={`zone-rect pointer-events-auto absolute ${active === "move" ? "is-active" : ""}`}
        style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
        onPointerDown={down("move")}
        data-testid="zone-rect"
      >
        {HANDLES.map((h) => (
          <span key={h} className={`crop-handle crop-handle-${h} ${active === h ? "is-active" : ""}`} onPointerDown={down(h)} data-testid={`zone-handle-${h}`} />
        ))}
      </div>
    </div>
  );
}

/** Click en el preview: si toca un texto o logo lo selecciona (y devuelve true). */
export function selectOverlayAt(project: Project, e: React.MouseEvent, box: HTMLElement): boolean {
  const r = box.getBoundingClientRect();
  const o = hitOverlay(project, useEditor.getState().time, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  if (!o) return false;
  setSelection([o.id]);
  useEditor.setState({ inspectorTab: o.type === "text" ? "text" : "video", inspectorOpen: true });
  return true;
}
