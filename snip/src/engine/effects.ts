// Efectos de imagen del preview: interpolación de keyframes de zoom y los
// uniforms de color. Las mismas fórmulas usa Rust para armar los filtros.

import type { ClipVideo, Easing, ZoomKey } from "../project/model";
import type { ColorUniforms } from "./renderer";

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

/** Zoom y centro en el tiempo local u (interpolado entre keyframes). */
export function zoomAt(keys: ZoomKey[], u: number): { zoom: number; cx: number; cy: number } {
  if (!keys.length) return { zoom: 1, cx: 0.5, cy: 0.5 };
  if (u <= keys[0].t) return { zoom: keys[0].zoom, cx: keys[0].cx, cy: keys[0].cy };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (u >= a.t && u <= b.t) {
      const k = ease(a.easing, (u - a.t) / Math.max(1e-6, b.t - a.t));
      return { zoom: a.zoom + (b.zoom - a.zoom) * k, cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k };
    }
  }
  const z = keys[keys.length - 1];
  return { zoom: z.zoom, cx: z.cx, cy: z.cy };
}

/** Uniforms de color del clip, o null si no hay ningún ajuste. */
export function clipColorUniforms(v: ClipVideo): ColorUniforms | null {
  const c = v.color;
  const noColor = !c.brightness && !c.contrast && !c.saturation && !c.temperature && !c.exposure;
  if (noColor && !v.look && !v.sharpen) return null;
  return {
    brightness: c.brightness * 0.3,
    contrast: 1 + c.contrast * (c.contrast > 0 ? 1 : 0.6),
    saturation: 1 + c.saturation,
    temperature: c.temperature,
    exposure: c.exposure * 2,
    gamma: 1,
    look: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    lookMix: 0,
    sharpen: v.sharpen,
  };
}
