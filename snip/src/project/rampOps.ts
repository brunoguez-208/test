// Ediciones de la rampa de velocidad de un clip (puntos en segundos del
// original desde el inicio de la pasada, velocidad 0,1×–10×).

import type { Clip, Project, RampAudio } from "./model";
import { MAX_SPEED, MIN_SPEED, rampPreset, speedAt, type RampPreset } from "./ramp";
import { updateClip } from "./ops";

const clampV = (v: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number.isFinite(v) ? v : 1));
const len = (c: Clip) => Math.max(0, c.outPoint - c.inPoint);
const nextId = (c: Clip) => Math.max(0, ...(c.speedKeys ?? []).map((k) => k.id)) + 1;

export function setRampPreset(p: Project, id: string, preset: RampPreset): Project {
  return updateClip(p, id, (c) => (c.kind === "freeze" ? c : { ...c, speedKeys: rampPreset(preset, len(c)), smoothSlowmo: false }));
}

export function clearRamp(p: Project, id: string): Project {
  return updateClip(p, id, (c) => ({ ...c, speedKeys: undefined }));
}

/** Agrega un punto en t (con la velocidad que ya tiene la curva ahí, si no se da). */
export function addSpeedKey(p: Project, id: string, t: number, v?: number): [Project, number] {
  let kid = 0;
  const q = updateClip(p, id, (c) => {
    if (c.kind === "freeze") return c;
    const keys = c.speedKeys?.length ? c.speedKeys : [{ id: 1, t: 0, v: c.speed }];
    kid = Math.max(nextId(c), ...keys.map((k) => k.id + 1));
    const tt = Math.min(len(c), Math.max(0, t));
    return {
      ...c,
      speedKeys: [...keys, { id: kid, t: tt, v: clampV(v ?? speedAt(keys, tt)) }].sort((a, b) => a.t - b.t),
      smoothSlowmo: false,
    };
  });
  return [q, kid];
}

export function moveSpeedKey(p: Project, id: string, key: number, t: number, v: number): Project {
  return updateClip(p, id, (c) => ({
    ...c,
    speedKeys: (c.speedKeys ?? []).map((k) => (k.id === key ? { ...k, t: Math.min(len(c), Math.max(0, t)), v: clampV(v) } : k)).sort((a, b) => a.t - b.t),
  }));
}

/** Borra un punto; si queda uno solo, la rampa pasa a ser una velocidad constante. */
export function removeSpeedKey(p: Project, id: string, key: number): Project {
  return updateClip(p, id, (c) => {
    const keys = (c.speedKeys ?? []).filter((k) => k.id !== key);
    if (keys.length > 1) return { ...c, speedKeys: keys };
    return {
      ...c,
      speedKeys: undefined,
      speed: Math.min(4, Math.max(0.25, keys[0]?.v ?? c.speed)),
    };
  });
}

export function setRampAudio(p: Project, id: string, a: RampAudio): Project {
  return updateClip(p, id, (c) => ({ ...c, rampAudio: a }));
}
