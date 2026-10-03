// Q / W: recortar el inicio o el final del clip hasta el playhead.

import type { Project } from "./model";
import { EditError, clipIndexAtTime, setFreezeDuration, trimClip, trimMusic } from "./ops";
import { layout, sourceTime } from "./timeline";
import { trimOverlay, updateCue } from "./overlayOps";
import { isLocked } from "./tracks";

export type TrimEdge = "start" | "end";

/**
 * Recorta hasta el playhead. Si hay audio, capas o subtítulos elegidos bajo el
 * playhead, se recortan esos (sin mover nada más); si no, el clip de la pista
 * principal bajo el playhead (lo que sigue se corre, como al arrastrar el borde).
 * Devuelve el proyecto y adónde conviene dejar el playhead.
 */
export function trimToPlayhead(p: Project, t: number, edge: TrimEdge, selection: string[]): [Project, number] {
  const sel = new Set(selection.filter((id) => !isLocked(p, id)));
  const inside = (a: number, b: number) => t > a + 0.05 && t < b - 0.05;
  let q = p;
  let hit = false;
  for (const m of p.music) {
    if (!sel.has(m.id) || !inside(m.start, m.start + (m.outPoint - m.inPoint))) continue;
    q = trimMusic(q, m.id, edge === "start" ? "in" : "out", t);
    hit = true;
  }
  for (const o of p.overlays) {
    if (!sel.has(o.id) || !inside(o.start, o.start + o.duration)) continue;
    q = trimOverlay(q, o.id, edge === "start" ? "in" : "out", t);
    hit = true;
  }
  for (const c of p.subtitles.cues) {
    if (!sel.has(c.id) || !inside(c.start, c.end)) continue;
    q = updateCue(q, c.id, edge === "start" ? { start: t } : { end: t });
    hit = true;
  }
  if (hit) return [q, t];

  if (p.tracks?.video?.locked) throw new EditError("La pista de video está bloqueada (candado en la cabecera de la pista).");
  const i = clipIndexAtTime(p, t);
  if (i < 0) throw new EditError("No hay ningún clip en el playhead.");
  const spans = layout(p.clips);
  const c = p.clips[i];
  const u = t - spans[i].start;
  if (u < 0.02 || spans[i].duration - u < 0.02) throw new EditError("El playhead está en el borde del clip.");
  if (c.kind === "freeze") {
    const d = edge === "start" ? spans[i].duration - u : u;
    return [setFreezeDuration(p, c.id, d), edge === "start" ? spans[i].start : t];
  }
  if (c.loopMode !== "none") throw new EditError("Para recortar un clip con repeticiones, primero quitá el loop.");
  // Tiempo del original en el playhead (con velocidad y reversa).
  const src = sourceTime(c, u);
  const r = trimClip(p, c.id, edge === "start" ? "in" : "out", src);
  // Al sacar el principio, el contenido que estaba en el playhead queda donde empezaba el clip.
  return [r, edge === "start" ? spans[i].start : t];
}
