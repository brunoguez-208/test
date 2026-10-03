// Efectos de un clic sobre todo el cuadro (espejo de snip-core/src/fx.rs):
// temblor, zoom punch, flash, glitch y viñeta. τ se cuenta desde el primer
// cuadro del lienzo dentro del bloque, igual que en la exportación.

import type { EffectKind, EffectLayer, Overlay, Project } from "../project/model";
import { canvasFps } from "../project/model";

export const SHAKE_AMP = 0.03;
export const SHAKE_RAMP = 0.1;
export const PUNCH_ZOOM = 0.35;
export const PUNCH_ATTACK = 0.2;
export const FLASH_ATTACK = 0.08;
export const VIGNETTE_FADE = 0.25;
export const VIGNETTE_MAX = 0.9;
export const GLITCH_RATE = 15;
export const GLITCH_BANDS = 18;

export { EFFECTS, effectLabel } from "../project/effects";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Primer cuadro (tiempo del lienzo) en o después de t. */
export function firstFrame(t: number, fps: number): number {
  return Math.ceil(t * fps - 1e-6) / fps;
}

/** Ventana visible (centro y zoom) del temblor y el zoom punch. */
export function effectWindow(kind: EffectKind, tau: number, d: number, i: number): { cx: number; cy: number; z: number } | null {
  if (kind === "shake") {
    const env = clamp(Math.min(tau / SHAKE_RAMP, (d - tau) / SHAKE_RAMP), 0, 1);
    const amp = i * SHAKE_AMP * env;
    const z = 1 + 2.5 * amp;
    const dx = amp * (0.6 * Math.sin(2 * Math.PI * 7.3 * tau) + 0.4 * Math.sin(2 * Math.PI * 13.1 * tau + 1.3));
    const dy = amp * (0.6 * Math.sin(2 * Math.PI * 8.7 * tau + 0.7) + 0.4 * Math.sin(2 * Math.PI * 11.9 * tau + 2.1));
    return { cx: clamp(0.5 + dx, 0.5 / z, 1 - 0.5 / z), cy: clamp(0.5 + dy, 0.5 / z, 1 - 0.5 / z), z };
  }
  if (kind === "zoomPunch") {
    const u = clamp(tau / d, 0, 1);
    const a = PUNCH_ATTACK;
    const v = (u - a) / (1 - a);
    const io = v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2;
    const p = u < a ? 1 - (1 - u / a) ** 3 : 1 - io;
    return { cx: 0.5, cy: 0.5, z: 1 + PUNCH_ZOOM * i * p };
  }
  return null;
}

/** Alfa del flash (uniforme) en τ. */
export function flashAlpha(tau: number, d: number, i: number): number {
  const a = Math.min(FLASH_ATTACK, 0.25 * d);
  const rest = Math.max(1e-3, d - a);
  const env = tau < a ? tau / a : Math.max(0, 1 - (tau - a) / rest);
  return i * clamp(env, 0, 1);
}

/** Envolvente de la viñeta (sube y baja en los bordes del bloque) × intensidad × máximo. */
export function vignetteLevel(tau: number, d: number, i: number): number {
  const f = Math.min(VIGNETTE_FADE, d / 2);
  return i * VIGNETTE_MAX * clamp(Math.min(tau / f, (d - tau) / f), 0, 1);
}

/** Alfa de la viñeta en (x, y) normalizados (centro del píxel). */
export function vignetteAt(nx: number, ny: number, level: number): number {
  const dist = Math.hypot(2 * nx - 1, 2 * ny - 1) / Math.SQRT2;
  const s = clamp((dist - 0.3) / 0.7, 0, 1);
  return level * s * s * (3 - 2 * s);
}

/** Paso del glitch en τ (cambia 15 veces por segundo). */
export function glitchStep(tau: number): number {
  return Math.floor(tau * GLITCH_RATE + 1e-6);
}

/** Corrimiento horizontal (px del lienzo) de la fila y y la separación RGB. */
export function glitchShift(y: number, H: number, W: number, k: number, i: number): { shift: number; split: number } {
  const b = Math.floor((y * GLITCH_BANDS) / H);
  const h = ((b * 37 + k * 101 + 7) % 23) / 23;
  const shift = h > 0.62 ? Math.round((i * W * 0.06 * (h - 0.62)) / 0.38) * (2 * ((b + k) % 2) - 1) : 0;
  return { shift, split: Math.round(i * W * 0.006 * (1 + ((k * 7) % 3))) };
}

export type EffectDraw =
  | { mode: "window"; cx: number; cy: number; z: number }
  | { mode: "glitch"; k: number; i: number }
  | { mode: "tint"; color: [number, number, number]; alpha: number; vignette: boolean };

/** Efectos activos en el tiempo t, en el orden de la exportación (fila, inicio). */
export function effectDraws(p: Project, t: number): EffectDraw[] {
  const fps = canvasFps(p.canvas);
  const out: EffectDraw[] = [];
  const list = p.overlays
    .filter((o): o is Overlay & EffectLayer => o.type === "effect" && !p.tracks?.overlays?.[o.lane]?.hidden && t >= o.start - 1e-9 && t < o.start + o.duration - 1e-4)
    .sort((a, b) => a.lane - b.lane || a.start - b.start);
  for (const o of list) {
    const tau = t - firstFrame(o.start, fps);
    const i = clamp(o.intensity, 0, 1);
    const d = Math.max(1e-3, o.duration);
    const w = effectWindow(o.kind, tau, d, i);
    if (w) out.push({ mode: "window", ...w });
    else if (o.kind === "glitch") out.push({ mode: "glitch", k: glitchStep(tau), i });
    else if (o.kind === "flash") out.push({ mode: "tint", color: [1, 1, 1], alpha: flashAlpha(tau, d, i), vignette: false });
    else if (o.kind === "vignette") out.push({ mode: "tint", color: [0, 0, 0], alpha: vignetteLevel(tau, d, i), vignette: true });
  }
  return out;
}
