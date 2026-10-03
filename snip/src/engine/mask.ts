// Máscaras de forma del PiP: alfa por píxel con distancia con signo, igual en
// el shader del preview (PIP_FRAG) y en las PNG que se exportan.

import type { LayerMask, MaskShape, Rect } from "../project/model";
import { rectAt } from "../project/overlayOps";

export const SHAPE_INDEX: Record<MaskShape, number> = { rect: 0, rounded: 1, circle: 2 };
export const MAX_FEATHER = 0.25;

/** Rectángulo de la máscara en el tiempo local u (con keyframes). */
export function maskRectAt(m: LayerMask, u: number): Rect {
  return rectAt(m, u);
}

/** Alfa de las esquinas redondeadas del PiP (lx, ly = centro del píxel local). */
export function cornerAlpha(lx: number, ly: number, w: number, h: number, radius: number): number {
  const qx = Math.abs(lx - w / 2) - (w / 2 - radius);
  const qy = Math.abs(ly - h / 2) - (h / 2 - radius);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return Math.min(1, Math.max(0, 0.5 - d));
}

export interface MaskPx {
  shape: number;
  /** x, y, w, h en píxeles locales del PiP. */
  rect: [number, number, number, number];
  radius: number;
  feather: number;
  invert: boolean;
}

/** Máscara en píxeles para un PiP de w×h en el tiempo local u. */
export function maskPx(m: LayerMask, w: number, h: number, u: number): MaskPx {
  const r = maskRectAt(m, u);
  const rw = r.w * w;
  const rh = r.h * h;
  return {
    shape: SHAPE_INDEX[m.shape],
    rect: [r.x * w, r.y * h, rw, rh],
    radius: Math.min(0.5, Math.max(0, m.radius)) * Math.min(rw, rh),
    feather: Math.max(1, Math.min(1, Math.max(0, m.feather)) * MAX_FEATHER * Math.min(rw, rh)),
    invert: m.invert,
  };
}

/** Alfa de la forma (lx, ly = centro del píxel local). */
export function shapeAlpha(lx: number, ly: number, m: MaskPx): number {
  const [x, y, w, h] = m.rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hx = Math.max(1e-3, w / 2);
  const hy = Math.max(1e-3, h / 2);
  let d: number;
  if (m.shape === 2) {
    d = (Math.hypot((lx - cx) / hx, (ly - cy) / hy) - 1) * Math.min(hx, hy);
  } else {
    const r = m.shape === 1 ? Math.min(m.radius, hx, hy) : 0;
    const qx = Math.abs(lx - cx) - (hx - r);
    const qy = Math.abs(ly - cy) - (hy - r);
    d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }
  const a = Math.min(1, Math.max(0, 0.5 - d / m.feather));
  return m.invert ? 1 - a : a;
}

/** Máscara completa del PiP (esquinas × forma) como escala de grises 0..255. */
export function pipMaskPixels(w: number, h: number, cornerRadius: number, m: MaskPx | null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lx = x + 0.5;
      const ly = y + 0.5;
      let a = cornerAlpha(lx, ly, w, h, cornerRadius);
      if (m && a > 0) a *= shapeAlpha(lx, ly, m);
      const v = Math.round(a * 255);
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Máscara nueva: un círculo centrado (en píxeles, aunque el PiP sea 16:9). */
export function defaultMask(shape: MaskShape, pipW: number, pipH: number): LayerMask {
  const side = 0.9 * Math.min(pipW, pipH);
  const w = shape === "circle" ? side / pipW : 0.8;
  const h = shape === "circle" ? side / pipH : 0.8;
  return { shape, rect: { x: (1 - w) / 2, y: (1 - h) / 2, w, h }, radius: 0.2, feather: 0.1, invert: false, keys: [] };
}
