// Ojo y candado por pista: qué pista tiene cada elemento y si se puede editar.

import type { Project } from "./model";
import { EditError } from "./ops";

/** ¿La pista donde está este elemento está bloqueada? */
export function isLocked(p: Project, id: string): boolean {
  const t = p.tracks;
  if (!t) return false;
  if (p.clips.some((c) => c.id === id)) return !!t.video?.locked;
  const o = p.overlays.find((x) => x.id === id);
  if (o) return !!t.overlays?.[o.lane]?.locked;
  const m = p.music.find((x) => x.id === id);
  if (m) return !!t.audio?.[m.track ?? 0]?.locked;
  if (p.subtitles.cues.some((c) => c.id === id)) return !!t.subtitles?.locked;
  return false;
}

/** Saca los elementos bloqueados; si eran todos, avisa. */
export function unlockedOnly(p: Project, ids: string[]): string[] {
  const free = ids.filter((id) => !isLocked(p, id));
  if (ids.length && !free.length) throw new EditError("Esa pista está bloqueada (candado en la cabecera de la pista).");
  return free;
}

/** ¿Se puede cortar la pista principal? */
export function assertMainUnlocked(p: Project) {
  if (p.tracks?.video?.locked) throw new EditError("La pista de video está bloqueada (candado en la cabecera de la pista).");
}
