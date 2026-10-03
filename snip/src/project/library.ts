// Biblioteca de medios: uso de cada archivo, búsqueda y orden, y ubicar un
// medio en cualquier pista (desde la biblioteca, el Explorador o el visor).

import type { MediaKind, MediaRef, Project } from "./model";
import { EditError, addMedia, addMusic, insertMedia } from "./ops";
import { layout, totalDuration } from "./timeline";
import { addImageAt, addPip } from "./overlayOps";
import { freeMusicTrack } from "./clipboard";
import type { DropTarget } from "../store/editor";

export type LibrarySort = "added" | "name" | "duration" | "type";

/** Cuántas veces se usa cada medio en el timeline (clips, audio, capas). */
export function mediaUsage(p: Project): Map<string, number> {
  const n = new Map<string, number>();
  const inc = (id: string) => n.set(id, (n.get(id) ?? 0) + 1);
  for (const c of p.clips) inc(c.mediaId);
  for (const m of p.music) inc(m.mediaId);
  for (const o of p.overlays) if (o.type === "image" || o.type === "video") inc(o.mediaId);
  return n;
}

const KIND_ORDER: Record<MediaKind, number> = { video: 0, audio: 1, image: 2 };

function nameOf(m: MediaRef): string {
  return (m.path.split(/[\\/]/).pop() ?? m.path).toLowerCase();
}

/** Filtra por texto (nombre del archivo) y ordena. "added" = orden en que se agregaron. */
export function libraryItems(p: Project, query: string, sort: LibrarySort, kind: MediaKind | "all" = "all"): MediaRef[] {
  const q = query.trim().toLowerCase();
  const list = p.media.filter((m) => (kind === "all" || m.kind === kind) && (!q || nameOf(m).includes(q)));
  const idx = new Map(p.media.map((m, i) => [m.id, i]));
  const cmp: Record<LibrarySort, (a: MediaRef, b: MediaRef) => number> = {
    added: (a, b) => idx.get(b.id)! - idx.get(a.id)!,
    name: (a, b) => nameOf(a).localeCompare(nameOf(b), "es", { numeric: true }),
    duration: (a, b) => b.duration - a.duration,
    type: (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || nameOf(a).localeCompare(nameOf(b), "es", { numeric: true }),
  };
  return [...list].sort(cmp[sort]);
}

/** Suma archivos a la biblioteca sin ponerlos en el timeline. */
export function addToLibrary(p: Project, media: MediaRef[]): Project {
  let q = p;
  for (const m of media) [q] = addMedia(q, m);
  return q;
}

/** Index de la pista principal en t (en el borde más cercano). */
export function mainIndexAt(p: Project, t: number): number {
  const spans = layout(p.clips);
  const i = spans.findIndex((s) => t < (s.start + s.end) / 2);
  return i < 0 ? p.clips.length : i;
}

/**
 * Ubica medios en el tiempo t: videos a la pista principal, audio a una pista de
 * audio libre, imágenes como capa. Con `target` (soltados sobre una pista) van a
 * esa fila: un video sobre las capas es un PiP y sobre el audio suma su sonido.
 * `range` toma solo un tramo del original (visor de origen).
 */
export function placeMedia(p0: Project, media: MediaRef[], t: number, target?: DropTarget | null, range?: [number, number] | null): [Project, string[]] {
  let p = p0;
  const ids: string[] = [];
  const asAudio = (m: MediaRef) => m.kind === "audio" || (m.kind === "video" && target?.kind === "audio" && m.hasAudio);
  const asPip = (m: MediaRef) => m.kind === "video" && target?.kind === "overlay" && p.clips.length > 0;
  const videos = media.filter((m) => m.kind === "video" && !asAudio(m) && !asPip(m));
  if (videos.length) {
    const before = new Set(p.clips.map((c) => c.id));
    p = insertMedia(p, videos, mainIndexAt(p, t));
    const added = p.clips.filter((c) => !before.has(c.id)).map((c) => c.id);
    if (range) p = { ...p, clips: p.clips.map((c) => (added.includes(c.id) ? { ...c, inPoint: range[0], outPoint: range[1] } : c)) };
    ids.push(...added);
  }
  if (!p.clips.length) throw new EditError("Agregá un video antes de sumar audio o imágenes.");
  let at = Math.min(t, Math.max(0, totalDuration(p) - 0.2));
  for (const m of media.filter(asAudio)) {
    const before = new Set(p.music.map((x) => x.id));
    p = addMusic(p, m, at);
    const mu = p.music.find((x) => !before.has(x.id))!;
    const [a, b] = range ?? [mu.inPoint, mu.outPoint];
    const prefer = target?.kind === "audio" && target.row >= 0 ? target.row : 0;
    const track = freeMusicTrack(p, mu.start, mu.start + (b - a), prefer, mu.id);
    p = { ...p, music: p.music.map((x) => (x.id === mu.id ? { ...x, inPoint: a, outPoint: b, track, volume: 1, fadeOut: 0 } : x)) };
    ids.push(mu.id);
  }
  const inLane = (q: Project, id: string) => {
    if (target?.kind !== "overlay" || target.row < 0) return q;
    const o = q.overlays.find((x) => x.id === id)!;
    const busy = q.overlays.some((x) => x.id !== id && x.lane === target.row && x.start < o.start + o.duration - 1e-6 && x.start + x.duration > o.start + 1e-6);
    return busy ? q : { ...q, overlays: q.overlays.map((x) => (x.id === id ? { ...x, lane: target.row } : x)) };
  };
  for (const m of media.filter(asPip)) {
    let [r, id] = addPip(p, m, at);
    if (range) r = { ...r, overlays: r.overlays.map((o) => (o.id === id && o.type === "video" ? { ...o, inPoint: range[0], duration: Math.min(o.duration, range[1] - range[0]) } : o)) };
    p = inLane(r, id);
    ids.push(id);
  }
  for (const m of media.filter((x) => x.kind === "image")) {
    const [r, id] = addImageAt(p, m, at);
    p = inLane(r, id);
    ids.push(id);
    at = Math.min(at + 0.5, Math.max(0, totalDuration(p) - 0.5));
  }
  return [p, ids];
}
