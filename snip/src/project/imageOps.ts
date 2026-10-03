// Operaciones de imagen por clip: recorte con proporciones, rotar, voltear,
// keyframes de zoom/paneo. Puras, como el resto de ops.ts.

import type { Clip, CropRect, Easing, MediaRef, Project, ZoomKey } from "./model";
import { clipDuration } from "./timeline";
import { rotatedSize } from "./geometry";
import { nextKeyId, sortedKeys, zoomAt } from "./zoom";
import { updateClip } from "./ops";

export const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: "free", label: "Libre", ratio: null },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
];

export const MIN_CROP = 0.05;
export const MAX_ZOOM = 4;

export function aspectRatio(id: string | null | undefined): number | null {
  return ASPECTS.find((a) => a.id === id)?.ratio ?? null;
}

/** Tamaño del cuadro (ya rotado) en píxeles. */
export function frameSize(c: Clip, m: Pick<MediaRef, "width" | "height">): [number, number] {
  return rotatedSize(c.video, Math.max(2, m.width), Math.max(2, m.height));
}

/** Rectángulo más grande con esa proporción (en píxeles), centrado en (cx, cy) y dentro del cuadro. */
export function cropForAspect(ratio: number, W: number, H: number, cx = 0.5, cy = 0.5): CropRect {
  let w = 1;
  let h = 1;
  if (W / H > ratio) w = (ratio * H) / W;
  else h = W / (ratio * H);
  const x = Math.min(1 - w, Math.max(0, cx - w / 2));
  const y = Math.min(1 - h, Math.max(0, cy - h / 2));
  return { x, y, w, h };
}

/** Mantiene el recorte dentro del cuadro y con un tamaño mínimo. */
export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  return { ...c, w, h, x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)) };
}

function isFull(c: CropRect): boolean {
  return c.x <= 1e-4 && c.y <= 1e-4 && c.w >= 1 - 1e-4 && c.h >= 1 - 1e-4;
}

/** Elige una proporción: "original" quita el recorte, "free" lo deja libre. */
export function setCropAspect(p: Project, clipId: string, aspect: string): Project {
  const c = p.clips.find((x) => x.id === clipId);
  const m = c && p.media.find((x) => x.id === c.mediaId);
  if (!c || !m) return p;
  if (aspect === "original") return updateClip(p, clipId, (k) => ({ ...k, video: { ...k.video, crop: null } }));
  const cur = c.video.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const ratio = aspectRatio(aspect);
  if (ratio === null) return updateClip(p, clipId, (k) => ({ ...k, video: { ...k.video, crop: { ...cur, aspect: "free" } } }));
  const [W, H] = frameSize(c, m);
  const r = cropForAspect(ratio, W, H, cur.x + cur.w / 2, cur.y + cur.h / 2);
  return updateClip(p, clipId, (k) => ({ ...k, video: { ...k.video, crop: { ...r, aspect } } }));
}

export function setCrop(p: Project, clipId: string, crop: CropRect | null): Project {
  return updateClip(p, clipId, (k) => ({ ...k, video: { ...k.video, crop: crop && !(isFull(crop) && !crop.aspect) ? clampCrop(crop) : null } }));
}

/** Rota 90° (1 = horario, -1 = antihorario); el recorte gira con la imagen. */
export function rotateClip(p: Project, clipId: string, dir: 1 | -1): Project {
  return updateClip(p, clipId, (k) => {
    const rotate = (((k.video.rotate + 90 * dir) % 360) + 360) % 360;
    const c = k.video.crop;
    const crop = c
      ? dir === 1
        ? { ...c, x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w }
        : { ...c, x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w }
      : null;
    const flip = crop?.aspect ? flipAspect(crop.aspect) : undefined;
    return { ...k, video: { ...k.video, rotate, crop: crop ? { ...crop, aspect: flip ?? crop.aspect } : null } };
  });
}

function flipAspect(a: string): string {
  const m = /^(\d+):(\d+)$/.exec(a);
  return m ? `${m[2]}:${m[1]}` : a;
}

/** Voltea (espejo); el recorte se refleja para mostrar la misma zona. */
export function flipClip(p: Project, clipId: string, axis: "h" | "v"): Project {
  return updateClip(p, clipId, (k) => {
    const c = k.video.crop;
    const crop = c ? (axis === "h" ? { ...c, x: 1 - c.x - c.w } : { ...c, y: 1 - c.y - c.h }) : null;
    return { ...k, video: { ...k.video, crop, flipH: axis === "h" ? !k.video.flipH : k.video.flipH, flipV: axis === "v" ? !k.video.flipV : k.video.flipV } };
  });
}

// ------------------------------- Zoom / paneo -------------------------------


/**
 * Agrega un keyframe en el tiempo local u (segundos desde el inicio del clip)
 * con el zoom actual en ese punto (o 1×, sin zoom, si es el primero).
 * Devuelve el proyecto y el id del keyframe (el existente si ya había uno ahí).
 */
export function addZoomKey(p: Project, clipId: string, u: number, frame = 1 / 30): [Project, number] {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return [p, -1];
  const t = Math.min(clipDuration(c), Math.max(0, u));
  const near = c.video.zoom.find((k) => Math.abs(k.t - t) < frame / 2);
  if (near) return [p, near.id];
  const cur = zoomAt(c.video.zoom, t);
  const id = nextKeyId(c.video.zoom);
  const key: ZoomKey = { id, t, zoom: cur.zoom, cx: cur.cx, cy: cur.cy, easing: "easeInOut" };
  return [updateClip(p, clipId, (k) => ({ ...k, video: { ...k.video, zoom: sortedKeys([...k.video.zoom, key]) } })), id];
}

export function updateZoomKey(p: Project, clipId: string, keyId: number, patch: Partial<Pick<ZoomKey, "t" | "zoom" | "cx" | "cy" | "easing">>): Project {
  return updateClip(p, clipId, (k) => {
    const dur = clipDuration(k);
    const zoom = k.video.zoom.map((z) => {
      if (z.id !== keyId) return z;
      const n = { ...z, ...patch };
      return { ...n, t: Math.min(dur, Math.max(0, n.t)), zoom: Math.min(MAX_ZOOM, Math.max(1, n.zoom)), cx: Math.min(1, Math.max(0, n.cx)), cy: Math.min(1, Math.max(0, n.cy)) };
    });
    return { ...k, video: { ...k.video, zoom: sortedKeys(zoom) } };
  });
}

export function removeZoomKey(p: Project, clipId: string, keyId: number): Project {
  return updateClip(p, clipId, (k) => ({ ...k, video: { ...k.video, zoom: k.video.zoom.filter((z) => z.id !== keyId) } }));
}

/** "Acercamiento lento": de 1× al inicio a 1,3× al final del clip. */
export function kenBurns(p: Project, clipId: string, easing: Easing = "easeInOut"): Project {
  return updateClip(p, clipId, (k) => {
    const d = clipDuration(k);
    return {
      ...k,
      video: {
        ...k.video,
        zoom: [
          { id: 1, t: 0, zoom: 1, cx: 0.5, cy: 0.5, easing },
          { id: 2, t: d, zoom: 1.3, cx: 0.5, cy: 0.5, easing },
        ],
      },
    };
  });
}
