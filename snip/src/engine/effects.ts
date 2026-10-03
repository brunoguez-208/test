// Efectos de imagen del preview: geometría (rotar, voltear, recortar), zoom y
// paneo con keyframes. Espejo de snip-core/src/filters.rs: mismos redondeos y
// la misma interpolación, para que el preview coincida con la exportación.

import type { Easing, ZoomKey } from "../project/model";

export function ease(e: Easing, x: number): number {
  const t = Math.min(1, Math.max(0, x));
  switch (e) {
    case "linear":
      return t;
    case "easeIn":
      return t * t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t) * (1 - t);
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

/** Keyframes válidos y ordenados (zoom 1..8, centro 0..1). */
export function sortedKeys(keys: ZoomKey[]): ZoomKey[] {
  return keys
    .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.zoom) && Number.isFinite(k.cx) && Number.isFinite(k.cy))
    .map((k) => ({ ...k, zoom: Math.min(8, Math.max(1, k.zoom)), cx: Math.min(1, Math.max(0, k.cx)), cy: Math.min(1, Math.max(0, k.cy)), t: Math.max(0, k.t) }))
    .sort((a, b) => a.t - b.t);
}

function keyed(keys: ZoomKey[], get: (k: ZoomKey) => number, u: number): number {
  if (u < keys[0].t) return get(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, b] = [keys[i], keys[i + 1]];
    if (u < b.t) {
      const va = get(a);
      const vb = get(b);
      if (Math.abs(vb - va) < 1e-9) return va;
      return va + (vb - va) * ease(a.easing, (u - a.t) / Math.max(1e-6, b.t - a.t));
    }
  }
  return get(keys[keys.length - 1]);
}

/**
 * Zoom y centro de la ventana visible en el tiempo local u (segundos desde el
 * inicio del clip). El centro se acota para que la ventana no salga del cuadro.
 */
export function zoomAt(keysIn: ZoomKey[], u: number): { zoom: number; cx: number; cy: number } {
  const keys = sortedKeys(keysIn);
  if (!keys.length) return { zoom: 1, cx: 0.5, cy: 0.5 };
  const zoom = keyed(keys, (k) => k.zoom, u);
  const h = 0.5 / zoom;
  const cx = Math.min(1 - h, Math.max(h, keyed(keys, (k) => k.cx, u)));
  const cy = Math.min(1 - h, Math.max(h, keyed(keys, (k) => k.cy, u)));
  return { zoom, cx, cy };
}

export { clipGeometry, cropPixels, rotatedSize } from "../project/geometry";
