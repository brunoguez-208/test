// Espejo del cálculo de escalado de Rust (snip_core::scale), solo para mostrar
// en la UI el tamaño resultante. La fuente de verdad es Rust.
import type { ResolutionChoice, FpsChoice } from "./types";

export interface Dims {
  width: number;
  height: number;
}

export function roundEven(x: number): number {
  // Igual que f64::round de Rust (aleja de cero en .5).
  const half = x / 2;
  const r = Math.sign(half) * Math.round(Math.abs(half));
  const v = r * 2;
  return Number.isFinite(v) && v >= 2 ? v : 2;
}

export function floorEven(x: number): number {
  return Math.max(2, x - (x % 2));
}

const SHORT_SIDE: Record<string, number> = { p2160: 2160, p1440: 1440, p1080: 1080, p720: 720 };

export interface ScalePlan extends Dims {
  needsScale: boolean;
  upscale: boolean;
}

export function planScale(src: Dims, choice: ResolutionChoice): ScalePlan {
  const w = Math.max(2, src.width);
  const h = Math.max(2, src.height);
  let tw: number;
  let th: number;
  if (choice.kind === "original") {
    tw = floorEven(src.width);
    th = floorEven(src.height);
  } else if (choice.kind === "custom") {
    tw = roundEven(Math.min(16384, Math.max(2, choice.width)));
    th = roundEven((h * tw) / w);
  } else {
    const target = SHORT_SIDE[choice.kind];
    if (w >= h) {
      tw = roundEven((w * target) / h);
      th = target;
    } else {
      tw = target;
      th = roundEven((h * target) / w);
    }
  }
  return {
    width: tw,
    height: th,
    needsScale: tw !== src.width || th !== src.height,
    upscale: tw > src.width || th > src.height,
  };
}

export const FPS_VALUE: Record<FpsChoice, number | null> = {
  original: null,
  fps120: 120,
  fps60: 60,
  fps30: 30,
  fps24: 24,
};

/** Igual que Rust: tolerancia del 1% (29,97 → 30 no cuenta como subir). */
export function isFpsIncrease(target: number, source: number): boolean {
  return target > source * 1.01;
}
