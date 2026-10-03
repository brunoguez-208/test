// Rampas de velocidad (espejo exacto de snip-core/src/ramp.rs): la velocidad
// cambia suave entre puntos y se aproxima con tramos cortos de velocidad
// constante, los mismos que usa la exportación.

import type { SpeedKey } from "./model";

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
export const STEP = 0.05;
export const MAX_SEGMENTS = 64;

const smooth = (x: number) => {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
};

/** Velocidad en t (segundos del original desde la entrada). */
export function speedAt(keys: SpeedKey[], t: number): number {
  const k = [...keys].sort((a, b) => a.t - b.t);
  let v: number;
  if (!k.length) v = 1;
  else if (k.length === 1 || t <= k[0].t) v = k[0].v;
  else {
    v = k[k.length - 1].v;
    for (let i = 0; i + 1 < k.length; i++) {
      if (t <= k[i + 1].t) {
        const span = Math.max(1e-9, k[i + 1].t - k[i].t);
        v = k[i].v + (k[i + 1].v - k[i].v) * smooth((t - k[i].t) / span);
        break;
      }
    }
  }
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, v));
}

/** Tramos [inicio, fin, velocidad] en segundos del original. */
export function segments(keys: SpeedKey[], len: number): [number, number, number][] {
  const l = Math.max(1e-3, len);
  const n = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(l / STEP)));
  const step = l / n;
  return Array.from({ length: n }, (_, i) => {
    const a = i * step;
    const b = i + 1 === n ? l : a + step;
    return [a, b, speedAt(keys, (a + b) / 2)];
  });
}

/** Duración en el timeline de `len` segundos del original con la rampa. */
export function rampDuration(keys: SpeedKey[], len: number): number {
  return segments(keys, len).reduce((s, [a, b, v]) => s + (b - a) / v, 0);
}

/** Segundos del original que corresponden a u segundos del timeline (una pasada). */
export function sourceOffset(keys: SpeedKey[], len: number, u: number): number {
  let acc = 0;
  for (const [a, b, v] of segments(keys, len)) {
    const d = (b - a) / v;
    if (u <= acc + d) return Math.min(len, a + Math.max(0, u - acc) * v);
    acc += d;
  }
  return Math.max(0, len);
}

/** Tiempo del timeline (dentro de la pasada) en que se ve el segundo `o` del original. */
export function timelineOffset(keys: SpeedKey[], len: number, o: number): number {
  let acc = 0;
  for (const [a, b, v] of segments(keys, len)) {
    if (o <= b) return acc + Math.max(0, o - a) / v;
    acc += (b - a) / v;
  }
  return acc;
}

/** Puntos de la parte [from, to] de la pasada, corridos para que empiecen en 0
 *  (al recortar o dividir). Agrega puntos en los bordes para no cambiar la curva. */
export function cutKeys(keys: SpeedKey[] | undefined, from: number, to: number): SpeedKey[] | undefined {
  if (!keys?.length) return keys;
  const inner = keys.filter((k) => k.t > from + 1e-6 && k.t < to - 1e-6).map((k) => k.t - from);
  const pts = [0, ...inner, Math.max(0, to - from)];
  return pts.map((t, i) => ({ id: i + 1, t, v: speedAt(keys, t + from) }));
}

export type RampPreset = "slowmo-middle" | "speed-up" | "slow-down";

export const RAMP_PRESETS: { id: RampPreset; label: string }[] = [
  { id: "slowmo-middle", label: "Cámara lenta en el medio" },
  { id: "speed-up", label: "Aceleración" },
  { id: "slow-down", label: "Frenada" },
];

/** Presets de un clic (mismos valores que ramp::preset). */
export function rampPreset(name: RampPreset, len: number): SpeedKey[] {
  const k = (id: number, t: number, v: number): SpeedKey => ({
    id,
    t: t * len,
    v,
  });
  switch (name) {
    case "slowmo-middle":
      return [k(1, 0, 1), k(2, 0.35, 0.25), k(3, 0.65, 0.25), k(4, 1, 1)];
    case "speed-up":
      return [k(1, 0, 1), k(2, 1, 4)];
    case "slow-down":
      return [k(1, 0, 3), k(2, 1, 0.3)];
  }
}
