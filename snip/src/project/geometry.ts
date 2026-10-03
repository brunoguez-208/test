// Geometría del clip: rotación extra y recorte (en píxeles pares), espejo de
// clip_display_size / crop_pixels de snip-core/src/filters.rs.

import type { ClipVideo, CropRect, MediaRef } from "./model";

/** Tamaño del cuadro después de la rotación extra. */
export function rotatedSize(v: Pick<ClipVideo, "rotate">, w: number, h: number): [number, number] {
  return v.rotate % 180 === 90 ? [h, w] : [w, h];
}

const evenDown = (v: number) => Math.max(0, Math.floor(v / 2) * 2);

/** Recorte en píxeles pares dentro del cuadro (igual que crop_pixels de Rust). */
export function cropPixels(c: CropRect, w: number, h: number): [number, number, number, number] {
  const x = Math.min(1, Math.max(0, c.x));
  const y = Math.min(1, Math.max(0, c.y));
  const cw = Math.min(w - (w % 2), Math.max(2, evenDown(Math.round(Math.min(1 - x, Math.max(0, c.w)) * w))));
  const ch = Math.min(h - (h % 2), Math.max(2, evenDown(Math.round(Math.min(1 - y, Math.max(0, c.h)) * h))));
  const cx = Math.min(evenDown(Math.max(0, w - cw)), evenDown(Math.round(x * w)));
  const cy = Math.min(evenDown(Math.max(0, h - ch)), evenDown(Math.round(y * h)));
  return [cx, cy, cw, ch];
}

/** Recorte normalizado (ya redondeado como en la exportación) y tamaño visible del clip. */
export function clipGeometry(
  v: ClipVideo,
  media: Pick<MediaRef, "width" | "height">,
): { crop: CropRect; width: number; height: number; fullWidth: number; fullHeight: number } {
  const [w, h] = rotatedSize(v, Math.max(2, media.width), Math.max(2, media.height));
  if (!v.crop) return { crop: { x: 0, y: 0, w: 1, h: 1 }, width: w, height: h, fullWidth: w, fullHeight: h };
  const [cx, cy, cw, ch] = cropPixels(v.crop, w, h);
  return { crop: { x: cx / w, y: cy / h, w: cw / w, h: ch / h }, width: cw, height: ch, fullWidth: w, fullHeight: h };
}
