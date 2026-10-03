// Chroma key del preview: mismos parámetros y fórmulas que `core/src/chroma.rs`
// (chromakey + despill de FFmpeg). El shader está en `shaders.ts` (PIP_FRAG).

import type { ChromaKey } from "../project/model";

export const MIN_SIMILARITY = 0.01;
export const MAX_SIMILARITY = 0.6;
export const MAX_SMOOTHNESS = 0.5;

export function parseColor(c: string): [number, number, number] | null {
  const h = c.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** 0 = reflejo verde, 1 = azul, -1 = ninguno (igual que chroma::spill_of). */
export function spillOf([r, g, b]: [number, number, number]): number {
  if (g > r && g > b) return 0;
  if (b > r && b > g) return 1;
  return -1;
}

/** U y V (BT.601 rango limitado, 0..255) como los calcula FFmpeg para el color. */
export function keyUV([r, g, b]: [number, number, number]): [number, number] {
  const u = ((-0.16874 * r - 0.33126 * g + 0.5 * b) * 224) / 255 + 128;
  const v = ((0.5 * r - 0.41869 * g - 0.08131 * b) * 224) / 255 + 128;
  return [u, v];
}

export interface ChromaUniforms {
  uv: [number, number];
  similarity: number;
  smoothness: number;
  despill: number;
  spill: number;
}

export function chromaUniforms(k: ChromaKey | null | undefined): ChromaUniforms | null {
  if (!k) return null;
  const rgb = parseColor(k.color);
  if (!rgb) return null;
  return {
    uv: keyUV(rgb),
    similarity: Math.min(MAX_SIMILARITY, Math.max(MIN_SIMILARITY, k.similarity)),
    smoothness: Math.min(MAX_SMOOTHNESS, Math.max(0, k.smoothness)),
    despill: k.despill > 1e-3 ? Math.min(1, k.despill) : 0,
    spill: spillOf(rgb),
  };
}
