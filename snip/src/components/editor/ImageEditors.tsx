// Edición directa sobre el preview: recorte del clip y ventana de un keyframe
// de zoom. El preview muestra el cuadro completo (sin recorte ni zoom) y acá se
// dibuja el recuadro editable encima.

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Clip, CropRect, MediaRef } from "../../project/model";
import { aspectRatio, clampCrop, frameSize, MAX_ZOOM, MIN_CROP, setCrop, updateZoomKey } from "../../project/imageOps";
import { edit, gestureEnd, gestureStart } from "../../store/editor";
import { setImageEdit } from "../../store/controller";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Nuevo recorte al arrastrar una manija (dx, dy normalizados), con proporción fija opcional (w/h normalizado). */
export function dragCrop(start: CropRect, h: Handle, dx: number, dy: number, nr: number | null): CropRect {
  if (h === "move") return clampCrop({ ...start, x: start.x + dx, y: start.y + dy });
  const west = h.includes("w");
  const east = h.includes("e");
  const north = h.includes("n");
  const south = h.includes("s");
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  if (west) x0 = Math.min(x1 - MIN_CROP, Math.max(0, x0 + dx));
  if (east) x1 = Math.max(x0 + MIN_CROP, Math.min(1, x1 + dx));
  if (north) y0 = Math.min(y1 - MIN_CROP, Math.max(0, y0 + dy));
  if (south) y1 = Math.max(y0 + MIN_CROP, Math.min(1, y1 + dy));
  if (!nr) return { ...start, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // Proporción fija: la esquina opuesta (o el centro del lado opuesto) queda quieta.
  const ax = west ? start.x + start.w : east ? start.x : start.x + start.w / 2;
  const ay = north ? start.y + start.h : south ? start.y : start.y + start.h / 2;
  let w = x1 - x0;
  let hh = y1 - y0;
  if (h === "n" || h === "s") w = hh * nr;
  else if (h === "e" || h === "w") hh = w / nr;
  else if (w / hh > nr) hh = w / nr;
  else w = hh * nr;
  // Espacio disponible desde el ancla.
  const maxW = west ? ax : east ? 1 - ax : 2 * Math.min(ax, 1 - ax);
  const maxH = north ? ay : south ? 1 - ay : 2 * Math.min(ay, 1 - ay);
  const k = Math.min(1, maxW / w, maxH / hh);
  w = Math.max(MIN_CROP, w * k);
  hh = w / nr;
  const x = west ? ax - w : east ? ax : ax - w / 2;
  const y = north ? ay - hh : south ? ay : ay - hh / 2;
  return clampCrop({ ...start, x, y, w, h: hh });
}

function pointerDrag(onMove: (dx: number, dy: number) => void, box: React.RefObject<HTMLElement | null>, onEnd?: () => void) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => onMove((ev.clientX - x0) / r.width, (ev.clientY - y0) / r.height);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

/** Recorte: recuadro con manijas sobre el cuadro completo del clip. */
export function CropEditor({ clip, media }: { clip: Clip; media: MediaRef }) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Handle | null>(null);
  const crop: CropRect = clip.video.crop ?? { x: 0, y: 0, w: 1, h: 1, aspect: "free" };
  const ratio = aspectRatio(crop.aspect);
  const [W, H] = frameSize(clip, media);
  const nr = ratio ? (ratio * H) / W : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        setImageEdit(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const start = (h: Handle) => (e: React.PointerEvent) => {
    const from = crop;
    setActive(h);
    pointerDrag(
      (dx, dy) => edit((p) => setCrop(p, clip.id, { ...dragCrop(from, h, dx, dy, nr), aspect: crop.aspect ?? "free" })),
      box,
      () => setActive(null),
    )(e);
  };

  const pct = (v: number) => `${v * 100}%`;
  return (
    <div ref={box} className="absolute inset-0" data-testid="crop-editor">
      <div
        className={`crop-rect absolute ${active === "move" ? "is-active" : ""}`}
        style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
        onPointerDown={start("move")}
        data-testid="crop-rect"
      >
        <span className="crop-grid absolute inset-0" />
        {HANDLES.map((h) => (
          <span
            key={h}
            className={`crop-handle crop-handle-${h} ${active === h ? "is-active" : ""}`}
            onPointerDown={start(h)}
            data-testid={`crop-handle-${h}`}
          />
        ))}
      </div>
      <span className="crop-size t-caption tabular pointer-events-none absolute bottom-2 right-2 rounded-full px-2 py-0.5">
        {Math.round(crop.w * W / 2) * 2}×{Math.round(crop.h * H / 2) * 2}
      </span>
    </div>
  );
}

/** Ventana visible de un keyframe de zoom: arrastrar mueve el centro, la rueda cambia el zoom. */
export function ZoomEditor({ clip, keyId }: { clip: Clip; keyId: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const key = clip.video.zoom.find((k) => k.id === keyId);
  const wheelEnd = useRef(0);
  if (!key) return null;
  const half = 0.5 / key.zoom;
  const cx = Math.min(1 - half, Math.max(half, key.cx));
  const cy = Math.min(1 - half, Math.max(half, key.cy));
  const onDown = (e: React.PointerEvent) => {
    const from = { cx, cy };
    gestureStart();
    setDragging(true);
    pointerDrag(
      (dx, dy) => edit((p) => updateZoomKey(p, clip.id, keyId, { cx: Math.min(1 - half, Math.max(half, from.cx + dx)), cy: Math.min(1 - half, Math.max(half, from.cy + dy)) })),
      box,
      () => {
        gestureEnd();
        setDragging(false);
      },
    )(e);
  };
  const onWheel = (e: React.WheelEvent) => {
    // Toda una ráfaga de rueda es un solo paso de deshacer.
    if (!wheelEnd.current) gestureStart();
    window.clearTimeout(wheelEnd.current);
    wheelEnd.current = window.setTimeout(() => {
      wheelEnd.current = 0;
      gestureEnd();
    }, 350);
    const z = Math.min(MAX_ZOOM, Math.max(1, key.zoom * Math.exp(-e.deltaY * 0.0015)));
    edit((p) => updateZoomKey(p, clip.id, keyId, { zoom: z }));
  };
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div ref={box} className="absolute inset-0" onWheel={onWheel} data-testid="zoom-editor">
      <motion.div
        className={`crop-rect zoom-window absolute ${dragging ? "is-active" : ""}`}
        style={{ left: pct(cx - half), top: pct(cy - half), width: pct(2 * half), height: pct(2 * half) }}
        onPointerDown={onDown}
        data-testid="zoom-window"
      >
        <span className="crop-grid absolute inset-0" />
      </motion.div>
      <span className="crop-size t-caption tabular pointer-events-none absolute bottom-2 right-2 rounded-full px-2 py-0.5">
        {key.zoom.toFixed(2).replace(".", ",")}× · rueda para acercar
      </span>
    </div>
  );
}
