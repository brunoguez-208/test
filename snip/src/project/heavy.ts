// Qué clips necesitan la etapa pesada (espejo de heavy::needs_heavy en Rust)
// y la firma de los parámetros que la afectan (si cambia, hay que rehacerla).

import type { Clip, Project } from "./model";
import { canvasFpsExpr } from "./model";

export function needsHeavy(c: Clip): boolean {
  if (c.kind === "freeze") return false;
  return (
    !!c.speedKeys?.length ||
    c.reverse ||
    c.loopMode === "boomerang" ||
    (c.smoothSlowmo && c.speed < 1 - 1e-6) ||
    c.video.stabilize !== null ||
    c.video.denoise > 1e-6 ||
    c.audio.denoise
  );
}

export function heavySignature(c: Clip, p: Project): string {
  return JSON.stringify([
    c.mediaId,
    c.inPoint,
    c.outPoint,
    c.speed,
    c.smoothSlowmo,
    c.reverse,
    c.loopMode,
    c.loopCount,
    c.video.stabilize?.strength ?? null,
    c.video.denoise,
    c.audio.denoise,
    c.speedKeys?.length ? c.speedKeys : null,
    c.speedKeys?.length ? (c.rampAudio ?? "mute") : null,
    canvasFpsExpr(p.canvas),
  ]);
}

/** Por qué un clip se procesa aparte (para el aviso "preparando vista previa"). */
export function heavyReason(c: Clip): string {
  if (c.video.stabilize) return "Estabilizando";
  if (c.speedKeys?.length) return "Aplicando la rampa";
  if (c.smoothSlowmo && c.speed < 1) return "Interpolando cuadros";
  if (c.reverse || c.loopMode === "boomerang") return "Invirtiendo";
  return "Reduciendo ruido";
}
