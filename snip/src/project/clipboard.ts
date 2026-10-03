// Copiar, cortar, pegar, duplicar, pegar efectos y agrupar: operaciones puras
// sobre el proyecto (cualquier elemento del timeline: clips de la pista
// principal, capas, audio y subtítulos). Todo pasa por `edit()`, así que se
// deshace con Ctrl+Z como cualquier otra edición.

import type { Clip, Cue, MediaRef, MusicClip, Overlay, Project, RampAudio, SpeedKey } from "./model";
import { EditError, makeId, mediaById, splitAt } from "./ops";
import { EPS, layout, totalDuration } from "./timeline";
import { freeLane } from "./overlayOps";

/** Lo que guarda el portapapeles interno (también viaja como texto JSON). */
export interface ClipboardData {
  kind: "snip-clipboard";
  v: 1;
  /** Clips de la pista principal, en orden. */
  clips: Clip[];
  /** Capas, audio y subtítulos con `start` relativo al ancla. */
  overlays: Overlay[];
  music: MusicClip[];
  cues: Cue[];
  /** Medios que usan (para pegar en otro proyecto o pestaña). */
  media: MediaRef[];
  /** Grupos entre los elementos copiados. */
  groups: string[][];
  /** Largo total de lo copiado (para duplicar "a continuación"). */
  span: number;
  /** Distancia del ancla al primer clip de la pista principal. */
  clipOffset: number;
}

export const CLIPBOARD_MARK = "snip-clipboard";

function cueRel(c: Cue, dt: number): Cue {
  return { ...c, start: c.start - dt, end: c.end - dt, words: c.words.map((w) => ({ ...w, start: w.start - dt, end: w.end - dt })) };
}

/** Grupo al que pertenece un id (o null). */
export function groupOf(p: Project, id: string): string[] | null {
  return (p.groups ?? []).find((g) => g.includes(id)) ?? null;
}

/** La selección con los grupos completos (elegir uno selecciona todo el grupo). */
export function expandGroups(p: Project, ids: string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) for (const x of groupOf(p, id) ?? []) out.add(x);
  return [...out];
}

/** Inicio y fin en el timeline de los elementos elegidos. */
export function selectionBounds(p: Project, ids: string[]): [number, number] | null {
  const set = new Set(ids);
  const spans = layout(p.clips);
  let a = Infinity;
  let b = -Infinity;
  p.clips.forEach((c, i) => {
    if (set.has(c.id)) [a, b] = [Math.min(a, spans[i].start), Math.max(b, spans[i].end)];
  });
  for (const o of p.overlays) if (set.has(o.id)) [a, b] = [Math.min(a, o.start), Math.max(b, o.start + o.duration)];
  for (const m of p.music) if (set.has(m.id)) [a, b] = [Math.min(a, m.start), Math.max(b, m.start + (m.outPoint - m.inPoint))];
  for (const c of p.subtitles.cues) if (set.has(c.id)) [a, b] = [Math.min(a, c.start), Math.max(b, c.end)];
  return a <= b ? [a, b] : null;
}

/** Copia los elementos elegidos (con sus efectos, keyframes y estilos). */
export function copySelection(p: Project, ids: string[]): ClipboardData | null {
  const all = expandGroups(p, ids);
  const set = new Set(all);
  const bounds = selectionBounds(p, all);
  if (!bounds) return null;
  const [a, b] = bounds;
  const spans = layout(p.clips);
  const firstIdx = p.clips.findIndex((c) => set.has(c.id));
  const clips = p.clips.filter((c) => set.has(c.id));
  const overlays = p.overlays.filter((o) => set.has(o.id)).map((o) => ({ ...o, start: o.start - a }));
  const music = p.music.filter((m) => set.has(m.id)).map((m) => ({ ...m, start: m.start - a }));
  const cues = p.subtitles.cues.filter((c) => set.has(c.id)).map((c) => cueRel(c, a));
  const mediaIds = new Set<string>([...clips.map((c) => c.mediaId), ...music.map((m) => m.mediaId)]);
  for (const o of overlays) if (o.type === "image" || o.type === "video") mediaIds.add(o.mediaId);
  const media = p.media.filter((m) => mediaIds.has(m.id));
  const groups = (p.groups ?? []).filter((g) => g.some((x) => set.has(x))).map((g) => g.filter((x) => set.has(x)));
  // Los clips copiados se pegan juntos (sin las transiciones con los vecinos que no vinieron).
  const firstClip = clips[0];
  const cleanClips = clips.map((c) => (c === firstClip ? { ...c, transition: null } : c));
  return { kind: CLIPBOARD_MARK, v: 1, clips: cleanClips, overlays, music, cues, media, groups, span: b - a, clipOffset: firstIdx >= 0 ? spans[firstIdx].start - a : 0 };
}

/** Lee un portapapeles serializado (texto del sistema); null si no es de Snip. */
export function parseClipboard(text: string | null | undefined): ClipboardData | null {
  if (!text || !text.includes(CLIPBOARD_MARK)) return null;
  try {
    const d = JSON.parse(text) as ClipboardData;
    return d && d.kind === CLIPBOARD_MARK && Array.isArray(d.clips) ? d : null;
  } catch {
    return null;
  }
}

/** Primera pista de audio libre en [start, end) (prefiere `prefer`). */
export function freeMusicTrack(p: Project, start: number, end: number, prefer = 0, exceptId?: string): number {
  const busy = (track: number) =>
    p.music.some((m) => m.id !== exceptId && (m.track ?? 0) === track && m.start < end - 1e-6 && m.start + (m.outPoint - m.inPoint) > start + 1e-6);
  if (!busy(prefer)) return prefer;
  for (let t = 0; t < 32; t++) if (!busy(t)) return t;
  return prefer;
}

/** Índice de la pista principal donde se inserta en `t` (divide el clip si cae en el medio). */
function insertionPoint(p: Project, t: number): [Project, number, number] {
  const spans = layout(p.clips);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (t > s.start + EPS && t < s.end - EPS) {
      try {
        const q = splitAt(p, t);
        return [q, i + 1, layout(q.clips)[i + 1].start];
      } catch {
        // Muy cerca de un borde (o un loop): va al borde más cercano.
        return t - s.start < s.end - t ? [p, i, s.start] : [p, i + 1, s.end];
      }
    }
    if (t <= s.start + EPS) return [p, i, s.start];
  }
  return [p, p.clips.length, totalDuration(p)];
}

/**
 * Pega en el tiempo `t`. Los clips de la pista principal se insertan ahí (si
 * el playhead cae dentro de un clip, se divide); las capas, el audio y los
 * subtítulos conservan su distancia entre sí y su fila si está libre.
 * Devuelve el proyecto y los ids nuevos (para dejarlos seleccionados).
 */
export function pasteAt(p0: Project, data: ClipboardData, t: number): [Project, string[]] {
  let p = p0;
  // Medios que no están en este proyecto (pegar desde otra pestaña).
  const mediaMap = new Map<string, string>();
  for (const m of data.media) {
    const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
    const same = p.media.find((x) => x.id === m.id && norm(x.path) === norm(m.path)) ?? p.media.find((x) => norm(x.path) === norm(m.path));
    if (same) mediaMap.set(m.id, same.id);
    else {
      const id = p.media.some((x) => x.id === m.id) ? makeId("m") : m.id;
      p = { ...p, media: [...p.media, { ...m, id }] };
      mediaMap.set(m.id, id);
    }
  }
  const mid = (id: string) => mediaMap.get(id) ?? id;
  const idMap = new Map<string, string>();
  const fresh = (old: string, prefix: string) => {
    const n = makeId(prefix);
    idMap.set(old, n);
    return n;
  };

  let at = Math.max(0, t);
  if (data.clips.length) {
    const [q, index, start] = insertionPoint(p, at);
    const clips = data.clips.map((c) => ({ ...c, id: fresh(c.id, "c"), mediaId: mid(c.mediaId), video: { ...c.video, zoom: c.video.zoom.map((k) => ({ ...k })) } }));
    const list = [...q.clips];
    list.splice(index, 0, ...clips);
    p = { ...q, clips: list };
    at = Math.max(0, start - (data.clipOffset ?? 0));
  }
  const total = totalDuration(p);
  const overlays: Overlay[] = [];
  for (const o of data.overlays) {
    const start = at + o.start;
    if (start >= total - 1e-3) continue;
    const duration = Math.min(o.duration, total - start);
    const base = { ...o, id: fresh(o.id, "o"), start, duration } as Overlay;
    const withMedia = base.type === "image" || base.type === "video" ? ({ ...base, mediaId: mid(base.mediaId) } as Overlay) : base;
    const copy = withMedia.type === "blur" ? ({ ...withMedia, keys: withMedia.keys.map((k) => ({ ...k, rect: { ...k.rect } })) } as Overlay) : withMedia;
    const probe = { ...p, overlays: [...p.overlays, ...overlays] };
    const laneBusy = probe.overlays.some((x) => x.lane === o.lane && x.start < start + duration - 1e-6 && x.start + x.duration > start + 1e-6);
    overlays.push({ ...copy, lane: laneBusy ? freeLane(probe, start, start + duration) : o.lane });
  }
  const music: MusicClip[] = [];
  for (const m of data.music) {
    const start = at + m.start;
    const len = m.outPoint - m.inPoint;
    const probe = { ...p, music: [...p.music, ...music] };
    music.push({ ...m, id: fresh(m.id, "mu"), mediaId: mid(m.mediaId), start, track: freeMusicTrack(probe, start, start + len, m.track ?? 0) });
  }
  const cues = data.cues.map((c) => ({ ...cueRel(c, -at), id: fresh(c.id, "cue") }));
  p = {
    ...p,
    overlays: [...p.overlays, ...overlays],
    music: [...p.music, ...music],
    subtitles: cues.length ? { ...p.subtitles, cues: [...p.subtitles.cues, ...cues].sort((a, b) => a.start - b.start) } : p.subtitles,
  };
  const groups = data.groups.map((g) => g.map((x) => idMap.get(x)).filter((x): x is string => !!x)).filter((g) => g.length > 1);
  if (groups.length) p = { ...p, groups: [...(p.groups ?? []), ...groups] };
  const ids = [...idMap.values()].filter((id) => p.clips.some((c) => c.id === id) || overlays.some((o) => o.id === id) || music.some((m) => m.id === id) || cues.some((c) => c.id === id));
  if (!ids.length) throw new EditError("No hay lugar para pegar ahí.");
  return [p, ids];
}

/** Ctrl+D: duplica la selección inmediatamente después de sí misma. */
export function duplicate(p: Project, ids: string[]): [Project, string[]] {
  const data = copySelection(p, ids);
  if (!data) throw new EditError("Elegí algo para duplicar.");
  const all = expandGroups(p, ids);
  const [, end] = selectionBounds(p, all)!;
  if (data.clips.length) {
    // Los clips van después del último clip elegido; lo demás, con el mismo corrimiento.
    const set = new Set(all);
    const spans = layout(p.clips);
    const last = Math.max(...p.clips.map((c, i) => (set.has(c.id) ? i : -1)));
    return pasteAt(p, data, spans[last].end);
  }
  return pasteAt(p, data, end);
}

/** Corta: copia y borra. */
export function cutSelection(p: Project, ids: string[], remove: (p: Project, ids: string[]) => Project): [Project, ClipboardData] {
  const data = copySelection(p, ids);
  if (!data) throw new EditError("Elegí algo para cortar.");
  return [remove(p, expandGroups(p, ids)), data];
}

// ------------------------------- Pegar efectos -------------------------------

/** Qué se copia con "Pegar efectos" (Ctrl+Alt+V). */
export interface Effects {
  video: Pick<Clip["video"], "color" | "look" | "sharpen" | "denoise" | "stabilize">;
  speed: number;
  smoothSlowmo: boolean;
  volume: number;
  speedKeys?: SpeedKey[];
  /** Largo (en el original) del clip de donde salió la rampa. */
  rampLen?: number;
  rampAudio?: RampAudio;
}

function scaleKeys(keys: SpeedKey[], from: number, to: number): SpeedKey[] {
  const f = from > 1e-6 ? to / from : 1;
  return keys.map((k) => ({ ...k, t: k.t * f }));
}

export function effectsOf(c: Clip): Effects {
  const v = c.video;
  return {
    video: { color: { ...v.color }, look: v.look ? { ...v.look } : null, sharpen: v.sharpen, denoise: v.denoise, stabilize: v.stabilize ? { ...v.stabilize } : null },
    speed: c.speed,
    smoothSlowmo: c.smoothSlowmo,
    volume: c.audio.volume,
    speedKeys: c.speedKeys?.length ? c.speedKeys.map((k) => ({ ...k })) : undefined,
    rampLen: c.outPoint - c.inPoint,
    rampAudio: c.rampAudio,
  };
}

/** Aplica color, filtros, velocidad y volumen a los clips elegidos (sin tocar cortes ni encuadre). */
export function pasteEffects(p: Project, fx: Effects, ids: string[]): Project {
  const set = new Set(ids);
  let n = 0;
  const clips = p.clips.map((c) => {
    if (!set.has(c.id)) return c;
    n++;
    const freeze = c.kind === "freeze";
    return {
      ...c,
      video: { ...c.video, ...fx.video, color: { ...fx.video.color } },
      speed: freeze ? c.speed : fx.speed,
      smoothSlowmo: freeze ? c.smoothSlowmo : fx.smoothSlowmo,
      // La rampa se escala al largo del clip destino.
      speedKeys: freeze || !fx.speedKeys?.length ? (freeze ? c.speedKeys : undefined) : scaleKeys(fx.speedKeys, fx.rampLen ?? c.outPoint - c.inPoint, c.outPoint - c.inPoint),
      rampAudio: freeze ? c.rampAudio : fx.rampAudio,
      audio: { ...c.audio, volume: fx.volume },
    };
  });
  const music = p.music.map((m) => {
    if (!set.has(m.id)) return m;
    n++;
    return { ...m, volume: Math.min(2, fx.volume) };
  });
  if (!n) throw new EditError("Elegí los clips donde pegar los efectos.");
  return { ...p, clips, music };
}

// ---------------------------------- Grupos ----------------------------------

/** Ctrl+G: agrupa (si alguno ya estaba en un grupo, se funden). */
export function groupItems(p: Project, ids: string[]): Project {
  const all = expandGroups(p, ids).filter((id) => itemExists(p, id));
  if (all.length < 2) throw new EditError("Elegí al menos dos elementos para agrupar.");
  const set = new Set(all);
  const rest = (p.groups ?? []).filter((g) => !g.some((x) => set.has(x)));
  return { ...p, groups: [...rest, all] };
}

/** Ctrl+Shift+G: desagrupa. */
export function ungroupItems(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  const groups = p.groups ?? [];
  const next = groups.filter((g) => !g.some((x) => set.has(x)));
  if (next.length === groups.length) throw new EditError("Eso no está agrupado.");
  return { ...p, groups: next };
}

/** Saca de los grupos los ids que ya no existen (y los grupos de un solo elemento). */
export function pruneGroups(p: Project): Project {
  if (!p.groups?.length) return p;
  const groups = p.groups.map((g) => g.filter((id) => itemExists(p, id))).filter((g) => g.length > 1);
  return groups.length === p.groups.length && groups.every((g, i) => g.length === p.groups![i].length) ? p : { ...p, groups };
}

export function itemExists(p: Project, id: string): boolean {
  return p.clips.some((c) => c.id === id) || p.overlays.some((o) => o.id === id) || p.music.some((m) => m.id === id) || p.subtitles.cues.some((c) => c.id === id);
}

/**
 * Corre en el tiempo los miembros de un grupo que no son de la pista principal
 * (capas, audio, subtítulos) cuando se arrastra uno de ellos.
 */
export function shiftGroup(p: Project, ids: string[], dt: number): Project {
  const set = new Set(ids);
  const minStart = Math.min(
    ...p.overlays.filter((o) => set.has(o.id)).map((o) => o.start),
    ...p.music.filter((m) => set.has(m.id)).map((m) => m.start),
    ...p.subtitles.cues.filter((c) => set.has(c.id)).map((c) => c.start),
    Infinity,
  );
  const d = Math.max(dt, -minStart);
  if (!Number.isFinite(minStart) || Math.abs(d) < 1e-9) return p;
  return {
    ...p,
    overlays: p.overlays.map((o) => (set.has(o.id) ? { ...o, start: o.start + d } : o)),
    music: p.music.map((m) => (set.has(m.id) ? { ...m, start: m.start + d } : m)),
    subtitles: { ...p.subtitles, cues: p.subtitles.cues.map((c) => (set.has(c.id) ? cueRel(c, -d) : c)) },
  };
}

export { mediaById };
