// Color del preview: espejo exacto de snip-core/src/color.rs. Ajustes y looks se
// reducen a dos transformaciones afines (con recorte a 0..1 después de cada una)
// y una curva por canal (tabla de 256 valores, igual que lutrgb de FFmpeg).

import looksFile from "../../src-tauri/core/config/looks.json" with { type: "json" };
import type { ColorAdjust, Look } from "../project/model";

export const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** out = clamp(m · rgb + o); m por filas. */
export interface Affine {
  m: number[];
  o: number[];
}

export const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };

export interface LookDef {
  id: string;
  label: string;
  matrix: number[];
  offset: number[];
  curves: Partial<Record<"r" | "g" | "b" | "all", [number, number][]>>;
}

export const LOOKS: LookDef[] = (looksFile as unknown as { looks: LookDef[] }).looks;

export function lookDef(id: string): LookDef | undefined {
  return LOOKS.find((l) => l.id === id);
}

export function isIdentity(a: Affine): boolean {
  return a.m.every((v, i) => Math.abs(v - IDENTITY.m[i]) < 1e-6) && a.o.every((v) => Math.abs(v) < 1e-6);
}

/** `a` después de `first`. */
export function after(a: Affine, first: Affine): Affine {
  const m = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[r * 3 + c] += a.m[r * 3 + k] * first.m[k * 3 + c];
  const o = [0, 1, 2].map((r) => a.m[r * 3] * first.o[0] + a.m[r * 3 + 1] * first.o[1] + a.m[r * 3 + 2] * first.o[2] + a.o[r]);
  return { m, o };
}

export function apply(a: Affine, c: number[]): number[] {
  return [0, 1, 2].map((r) => Math.min(1, Math.max(0, a.m[r * 3] * c[0] + a.m[r * 3 + 1] * c[1] + a.m[r * 3 + 2] * c[2] + a.o[r])));
}

const diag = (r: number, g: number, b: number): Affine => ({ m: [r, 0, 0, 0, g, 0, 0, 0, b], o: [0, 0, 0] });

export function saturation(s: number): Affine {
  const m = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = (1 - s) * LUMA[c] + (r === c ? s : 0);
  return { m, o: [0, 0, 0] };
}

const cl = (v: number) => Math.min(1, Math.max(-1, v || 0));

/** exposición → contraste y brillo → saturación → temperatura. */
export function adjustAffine(c: ColorAdjust): Affine {
  const gain = Math.pow(2, 1.5 * cl(c.exposure));
  const exposure = diag(gain, gain, gain);
  const k = c.contrast >= 0 ? 1 + cl(c.contrast) : 1 + 0.7 * cl(c.contrast);
  const off = 0.5 - 0.5 * k + 0.25 * cl(c.brightness);
  const contrast: Affine = { m: [k, 0, 0, 0, k, 0, 0, 0, k], o: [off, off, off] };
  const sat = saturation(1 + cl(c.saturation));
  const t = cl(c.temperature);
  const temp = diag(1 + 0.15 * t, 1 + 0.02 * t, 1 - 0.15 * t);
  return after(temp, after(sat, after(contrast, exposure)));
}

export function lookAffine(def: LookDef, k: number): Affine {
  const kk = Math.min(1, Math.max(0, k));
  return {
    m: def.matrix.map((v, i) => IDENTITY.m[i] + kk * (v - IDENTITY.m[i])),
    o: def.offset.map((v) => kk * v),
  };
}

export function lookCurve(def: LookDef, ch: "r" | "g" | "b"): [number, number][] | null {
  const p = def.curves[ch] ?? def.curves.all;
  return p && p.length >= 2 ? p : null;
}

/** Tramos de la curva mezclada (dominio 0..255): desde `from` vale slope·val + offset. */
export function curveSegments(points: [number, number][], k: number): [number, number, number][] {
  const kk = Math.min(1, Math.max(0, k));
  const n = points.length;
  const out: [number, number, number][] = [[-Infinity, 1 - kk, kk * points[0][1] * 255]];
  for (let i = 0; i < n - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const slope = (b[1] - a[1]) / Math.max(1e-9, b[0] - a[0]);
    out.push([a[0] * 255, 1 - kk + kk * slope, kk * (a[1] - slope * a[0]) * 255]);
  }
  out.push([points[n - 1][0] * 255, 1 - kk, kk * points[n - 1][1] * 255]);
  return out;
}

export function curveTable(points: [number, number][] | null, k: number): Uint8Array {
  const t = new Uint8Array(256);
  if (!points) {
    for (let i = 0; i < 256; i++) t[i] = i;
    return t;
  }
  const segs = curveSegments(points, k);
  for (let i = 0; i < 256; i++) {
    let seg = segs[0];
    for (const s of segs) if (i >= s[0]) seg = s;
    t[i] = Math.min(255, Math.max(0, Math.floor(seg[1] * i + seg[2] + 0.5)));
  }
  return t;
}

/** Peso de la nitidez (en 1/64), igual que sharpen_weight de Rust. */
export function sharpenWeight(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v || 0)) * 0.6 * 64);
}

export interface ColorPipeline {
  adjust: Affine;
  look: Affine;
  /** Tabla RGBA de 256×1 (curvas r, g, b). */
  curves: Uint8Array;
  hasCurves: boolean;
  /** Clave para no volver a subir la tabla si no cambió. */
  key: string;
}

const cache = new Map<string, ColorPipeline>();

export function colorPipeline(adjust: ColorAdjust, look: Look | null): ColorPipeline | null {
  const def = look ? lookDef(look.id) : undefined;
  const k = look && def ? Math.min(1, Math.max(0, look.intensity)) : 0;
  const adj = adjustAffine(adjust);
  if (isIdentity(adj) && (!def || k < 1e-6)) return null;
  const key = JSON.stringify([adjust, def?.id ?? null, k]);
  const hit = cache.get(key);
  if (hit) return hit;
  const la = def && k > 1e-6 ? lookAffine(def, k) : IDENTITY;
  const curves = new Uint8Array(256 * 4);
  const chans = (["r", "g", "b"] as const).map((ch) => (def && k > 1e-6 ? lookCurve(def, ch) : null));
  const tables = chans.map((p) => curveTable(p, k));
  for (let i = 0; i < 256; i++) {
    curves[i * 4] = tables[0][i];
    curves[i * 4 + 1] = tables[1][i];
    curves[i * 4 + 2] = tables[2][i];
    curves[i * 4 + 3] = 255;
  }
  const p: ColorPipeline = { adjust: adj, look: la, curves, hasCurves: chans.some(Boolean), key };
  if (cache.size > 64) cache.clear();
  cache.set(key, p);
  return p;
}
