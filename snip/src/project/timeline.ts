// Matemática de tiempos del timeline (espejo exacto de snip-core/src/timeline.rs).
// La pista principal es magnética: cada clip empieza donde termina el anterior,
// salvo que tenga transición de entrada, que solapa los dos clips.

import type { Clip, Project } from "./model";
import { rampDuration, sourceOffset } from "./ramp";

export const EPS = 1 / 240;

/** Duración de una pasada del clip (sin repeticiones), con la velocidad aplicada. */
export function segmentDuration(c: Clip): number {
  if (c.kind === "freeze") return Math.max(0, c.freezeDuration);
  if (c.speedKeys?.length) return rampDuration(c.speedKeys, Math.max(0, c.outPoint - c.inPoint));
  return Math.max(0, c.outPoint - c.inPoint) / Math.min(100, Math.max(0.01, c.speed));
}

/** Cuántas pasadas tiene el clip (un boomerang cuenta ida y vuelta como 2). */
export function passes(c: Clip): number {
  if (c.kind === "freeze") return 1;
  const n = Math.max(1, c.loopCount);
  return c.loopMode === "loop" ? n : c.loopMode === "boomerang" ? 2 * n : 1;
}

export function clipDuration(c: Clip): number {
  return segmentDuration(c) * passes(c);
}

export interface Span {
  start: number;
  end: number;
  duration: number;
  transitionIn: number;
}

/** Transición efectiva que entra al clip i (nunca más de la mitad de cada clip). */
export function effectiveTransition(clips: Clip[], i: number): number {
  if (i <= 0 || i >= clips.length) return 0;
  const t = clips[i].transition;
  if (!t) return 0;
  const max = Math.min(clipDuration(clips[i - 1]) * 0.5, clipDuration(clips[i]) * 0.5);
  const d = Math.min(t.duration, max);
  return d < EPS * 2 ? 0 : d;
}

export function layout(clips: Clip[]): Span[] {
  const out: Span[] = [];
  let cursor = 0;
  clips.forEach((c, i) => {
    const d = clipDuration(c);
    const tr = effectiveTransition(clips, i);
    const start = Math.max(0, cursor - tr);
    out.push({ start, end: start + d, duration: d, transitionIn: tr });
    cursor = start + d;
  });
  return out;
}

export function totalDuration(p: Pick<Project, "clips">): number {
  const l = layout(p.clips);
  return l.length ? l[l.length - 1].end : 0;
}

/** Segundo del original que se ve en el tiempo local u del clip. */
export function sourceTime(c: Clip, u: number): number {
  if (c.kind === "freeze") return c.inPoint;
  const seg = Math.max(EPS, segmentDuration(c));
  const total = clipDuration(c);
  const uu = Math.min(Math.max(0, u), Math.max(0, total - 1e-9));
  const pass = Math.floor(uu / seg);
  const p = uu - pass * seg;
  let forward = c.loopMode === "boomerang" ? pass % 2 === 0 : true;
  if (c.reverse) forward = !forward;
  const off = c.speedKeys?.length ? sourceOffset(c.speedKeys, c.outPoint - c.inPoint, p) : p * c.speed;
  return forward ? Math.min(c.outPoint, c.inPoint + off) : Math.max(c.inPoint, c.outPoint - off);
}

/** Qué hay que mostrar en el tiempo t: un clip, o dos durante una transición. */
export interface ActiveFrame {
  /** Clip principal (el que sale, durante una transición). */
  a: number;
  /** Clip que entra durante una transición. */
  b: number | null;
  /** Progreso de xfade: 1 al empezar la transición → 0 al terminar. */
  progress: number;
}

export function activeAt(spans: Span[], t: number): ActiveFrame | null {
  if (!spans.length) return null;
  const total = spans[spans.length - 1].end;
  const tt = Math.min(Math.max(0, t), Math.max(0, total - 1e-6));
  for (let i = 0; i < spans.length; i++) {
    const next = spans[i + 1];
    if (next && next.transitionIn > 0 && tt >= next.start && tt < next.start + next.transitionIn) {
      return { a: i, b: i + 1, progress: 1 - (tt - next.start) / next.transitionIn };
    }
    if (tt >= spans[i].start && tt < spans[i].end) {
      // Durante la transición de entrada de i, se resuelve arriba (i-1 con b=i).
      return { a: i, b: null, progress: 0 };
    }
  }
  return { a: spans.length - 1, b: null, progress: 0 };
}
