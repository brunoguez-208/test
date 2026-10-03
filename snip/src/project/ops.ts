// Operaciones de edición puras: reciben un proyecto y devuelven uno nuevo.
// Así son fáciles de testear y de deshacer (el historial guarda proyectos).

import {
  DEFAULT_AUDIO,
  DEFAULT_EXPORT,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_VIDEO,
  MAX_CLIP_VOLUME,
  MAX_LOOP_COUNT,
  MAX_SPEED,
  MIN_SPEED,
  PROJECT_VERSION,
  canvasFps,
  type Clip,
  type MediaRef,
  type MusicClip,
  type Project,
  type Transition,
} from "./model";
import { EPS, clipDuration, layout, segmentDuration, totalDuration } from "./timeline";

let seq = 0;
/** Id corto y único (sirve como nombre de archivo del autoguardado). */
export function makeId(prefix = "id"): string {
  seq = (seq + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${rnd}`.replace(/[^a-z0-9_-]/gi, "");
}

export class EditError extends Error {}

function basenameNoExt(path: string): string {
  const name = path.split(/[\\/]/).pop() || path;
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function newProject(now = Date.now()): Project {
  return {
    version: PROJECT_VERSION,
    id: makeId("p"),
    name: "",
    createdAt: now,
    updatedAt: now,
    exportedAt: null,
    media: [],
    clips: [],
    overlays: [],
    music: [],
    markers: [],
    ranges: [],
    subtitles: { cues: [], style: DEFAULT_SUBTITLE_STYLE, wordByWord: false, language: null },
    fades: { fadeIn: 0, fadeOut: 0 },
    canvas: { width: 1920, height: 1080, fpsNum: 30, fpsDen: 1, auto: true },
    view: { playhead: 0, zoom: 0, scroll: 0 },
    export: DEFAULT_EXPORT,
  };
}

export function newClip(media: MediaRef, inPoint = 0, outPoint = media.duration): Clip {
  return {
    id: makeId("c"),
    mediaId: media.id,
    kind: "video",
    inPoint,
    outPoint,
    speed: 1,
    smoothSlowmo: false,
    reverse: false,
    loopMode: "none",
    loopCount: 1,
    freezeDuration: 0,
    audio: DEFAULT_AUDIO,
    video: DEFAULT_VIDEO,
    transition: null,
  };
}

export function mediaById(p: Project, id: string): MediaRef | undefined {
  return p.media.find((m) => m.id === id);
}

/** Suma un archivo al proyecto (si ya estaba, devuelve el existente). */
export function addMedia(p: Project, m: MediaRef): [Project, MediaRef] {
  const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
  const existing = p.media.find((x) => norm(x.path) === norm(m.path));
  if (existing) return [p, existing];
  return [{ ...p, media: [...p.media, m] }, m];
}

/** Lienzo automático: tamaño (par) y fps del primer clip. */
export function fitCanvas(p: Project): Project {
  if (!p.canvas.auto || p.clips.length === 0) return p;
  const m = mediaById(p, p.clips[0].mediaId);
  if (!m || m.kind !== "video") return p;
  const width = Math.max(2, m.width - (m.width % 2));
  const height = Math.max(2, m.height - (m.height % 2));
  const fpsNum = m.fpsNum || Math.round(m.fps);
  const fpsDen = m.fpsDen || 1;
  const c = p.canvas;
  if (c.width === width && c.height === height && c.fpsNum === fpsNum && c.fpsDen === fpsDen) return p;
  return { ...p, canvas: { ...c, width, height, fpsNum, fpsDen } };
}

function withName(p: Project): Project {
  if (p.name || p.clips.length === 0) return p;
  const m = mediaById(p, p.clips[0].mediaId);
  return m ? { ...p, name: basenameNoExt(m.path) } : p;
}

/** Agrega clips (video entero) en la posición `at` (por defecto, al final). */
export function insertMedia(p: Project, media: MediaRef[], at = p.clips.length): Project {
  let next = p;
  const clips: Clip[] = [];
  for (const m of media) {
    if (m.kind !== "video") throw new EditError("Solo se pueden agregar videos a la pista principal.");
    const [p2, ref] = addMedia(next, m);
    next = p2;
    clips.push(newClip(ref));
  }
  const all = [...next.clips];
  all.splice(Math.max(0, Math.min(at, all.length)), 0, ...clips);
  return withName(fitCanvas({ ...next, clips: all }));
}

/** Redondea un tiempo del original al inicio del cuadro más cercano. */
export function snapSourceToFrame(t: number, fps: number): number {
  if (!(fps > 0)) return t;
  return Math.round(t * fps) / fps;
}

function clipIndexAtTime(p: Project, t: number): number {
  const spans = layout(p.clips);
  for (let i = 0; i < spans.length; i++) {
    if (t >= spans[i].start - 1e-9 && t < spans[i].end - 1e-9) {
      // En una transición, gana el clip que entra solo después de la mitad.
      const next = spans[i + 1];
      if (next && t >= next.start && t >= next.start + next.transitionIn / 2) return i + 1;
      return i;
    }
  }
  return -1;
}

/** Divide el clip que está en el tiempo t del timeline. */
export function splitAt(p: Project, t: number): Project {
  const i = clipIndexAtTime(p, t);
  if (i < 0) throw new EditError("No hay ningún clip en esa posición.");
  const spans = layout(p.clips);
  const c = p.clips[i];
  const u = t - spans[i].start;
  const dur = spans[i].duration;
  const fps = canvasFps(p.canvas);
  if (u < 1 / fps - 1e-6 || dur - u < 1 / fps - 1e-6) throw new EditError("Muy cerca del borde del clip para dividir.");
  let a: Clip;
  let b: Clip;
  if (c.kind === "freeze") {
    a = { ...c, freezeDuration: u };
    b = { ...c, id: makeId("c"), freezeDuration: dur - u, transition: null };
  } else {
    if (c.loopMode !== "none") throw new EditError("Para dividir un clip con repeticiones, primero quitá el loop.");
    const m = mediaById(p, c.mediaId);
    const sfps = m?.fps || fps;
    const s = snapSourceToFrame(c.reverse ? c.outPoint - u * c.speed : c.inPoint + u * c.speed, sfps);
    if (s <= c.inPoint + EPS || s >= c.outPoint - EPS) throw new EditError("Muy cerca del borde del clip para dividir.");
    if (!c.reverse) {
      a = { ...c, outPoint: s };
      b = { ...c, id: makeId("c"), inPoint: s, transition: null };
    } else {
      a = { ...c, inPoint: s };
      b = { ...c, id: makeId("c"), outPoint: s, transition: null };
    }
  }
  a = { ...a, audio: { ...a.audio, fadeOut: 0 }, video: { ...a.video, zoom: a.video.zoom.filter((k) => k.t <= u) } };
  b = {
    ...b,
    audio: { ...b.audio, fadeIn: 0 },
    video: { ...b.video, zoom: b.video.zoom.filter((k) => k.t >= u).map((k) => ({ ...k, t: k.t - u })) },
  };
  const clips = [...p.clips];
  clips.splice(i, 1, a, b);
  return { ...p, clips };
}

/** Borra clips, música, superposiciones, marcadores o rangos por id (los huecos se cierran solos). */
export function deleteClips(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  const clips = p.clips.filter((c) => !set.has(c.id));
  // Si el que queda primero tenía transición de entrada, ya no tiene a quién fundirse.
  if (clips.length && clips[0].transition) clips[0] = { ...clips[0], transition: null };
  return {
    ...p,
    clips,
    music: p.music.filter((m) => !set.has(m.id)),
    overlays: p.overlays.filter((o) => !set.has(o.id)),
    markers: p.markers.filter((m) => !set.has(m.id)),
    ranges: p.ranges.filter((r) => !set.has(r.id)),
  };
}

/** Borra un fragmento del timeline [a, b): divide en los bordes y saca lo del medio. */
export function deleteRange(p: Project, a: number, b: number): Project {
  const total = totalDuration(p);
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(total, Math.max(a, b));
  if (hi - lo < EPS) throw new EditError("El fragmento es demasiado corto.");
  let q = p;
  const trySplit = (t: number) => {
    try {
      q = splitAt(q, t);
    } catch {
      /* ya hay un corte ahí o es un borde */
    }
  };
  if (hi < total - EPS) trySplit(hi);
  if (lo > EPS) trySplit(lo);
  const spans = layout(q.clips);
  const remove = q.clips.filter((_, i) => spans[i].start >= lo - 1e-3 && spans[i].end <= hi + 1e-3).map((c) => c.id);
  if (!remove.length) throw new EditError("No hay nada para borrar en ese fragmento.");
  return deleteClips(q, remove);
}

export function moveClip(p: Project, id: string, to: number): Project {
  const from = p.clips.findIndex((c) => c.id === id);
  if (from < 0) return p;
  const clips = [...p.clips];
  const [c] = clips.splice(from, 1);
  const idx = Math.max(0, Math.min(to, clips.length));
  clips.splice(idx, 0, c);
  if (clips[0]?.transition) clips[0] = { ...clips[0], transition: null };
  return fitCanvas({ ...p, clips });
}

/** Recorta un borde del clip (en segundos del original), sin pasarse del archivo. */
export function trimClip(p: Project, id: string, edge: "in" | "out", sourceTime: number): Project {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i < 0) return p;
  const c = p.clips[i];
  if (c.kind === "freeze") return p;
  const m = mediaById(p, c.mediaId);
  const fps = m?.fps || canvasFps(p.canvas);
  const minLen = 1 / fps;
  const maxT = m?.duration ?? c.outPoint;
  const t = snapSourceToFrame(sourceTime, fps);
  // En un clip invertido, el borde izquierdo del timeline es el final del original.
  const field: "inPoint" | "outPoint" = (edge === "in") !== c.reverse ? "inPoint" : "outPoint";
  let next: Clip;
  if (field === "inPoint") next = { ...c, inPoint: Math.max(0, Math.min(t, c.outPoint - minLen)) };
  else next = { ...c, outPoint: Math.min(maxT, Math.max(t, c.inPoint + minLen)) };
  const clips = [...p.clips];
  clips[i] = next;
  return { ...p, clips };
}

/** Cambia la duración de un cuadro congelado. */
export function setFreezeDuration(p: Project, id: string, d: number): Project {
  return updateClip(p, id, (c) => (c.kind === "freeze" ? { ...c, freezeDuration: Math.max(0.1, Math.min(600, d)) } : c));
}

export function updateClip(p: Project, id: string, f: (c: Clip) => Clip): Project {
  let changed = false;
  const clips = p.clips.map((c) => {
    if (c.id !== id) return c;
    changed = true;
    return sanitizeClip(f(c));
  });
  return changed ? { ...p, clips } : p;
}

export function updateClips(p: Project, ids: string[], f: (c: Clip) => Clip): Project {
  const set = new Set(ids);
  return { ...p, clips: p.clips.map((c) => (set.has(c.id) ? sanitizeClip(f(c)) : c)) };
}

export function sanitizeClip(c: Clip): Clip {
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number.isFinite(c.speed) ? c.speed : 1));
  return {
    ...c,
    speed,
    smoothSlowmo: c.smoothSlowmo && speed < 1,
    loopCount: Math.round(Math.min(MAX_LOOP_COUNT, Math.max(1, c.loopCount))),
    audio: {
      ...c.audio,
      volume: Math.min(MAX_CLIP_VOLUME, Math.max(0, c.audio.volume)),
      fadeIn: Math.max(0, c.audio.fadeIn),
      fadeOut: Math.max(0, c.audio.fadeOut),
    },
  };
}

export function setTransition(p: Project, id: string, t: Transition | null): Project {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i <= 0) return p;
  return updateClip(p, id, (c) => ({ ...c, transition: t ? { ...t, duration: Math.min(5, Math.max(0.1, t.duration)) } : null }));
}

/** Congela el cuadro del tiempo t durante `duration` segundos (divide e inserta). */
export function freezeAt(p: Project, t: number, duration: number): Project {
  const i = clipIndexAtTime(p, t);
  if (i < 0) throw new EditError("No hay ningún clip en esa posición.");
  const spans = layout(p.clips);
  const c = p.clips[i];
  const m = mediaById(p, c.mediaId);
  const fps = m?.fps || canvasFps(p.canvas);
  const u = t - spans[i].start;
  // Cuadro que se ve en t (en el original), al inicio del cuadro.
  const s = c.kind === "freeze" ? c.inPoint : snapSourceToFrame(Math.floor((sourceAt(c, u) + 1e-6) * fps) / fps, fps);
  if (!m) throw new EditError("Falta el archivo de este clip.");
  const freeze: Clip = { ...newClip(m, s, s), kind: "freeze", freezeDuration: Math.max(0.1, duration), video: c.video };
  const pfps = canvasFps(p.canvas);
  let q = p;
  let insertAt: number;
  if (u <= 1 / pfps) insertAt = i;
  else if (spans[i].duration - u <= 1 / pfps) insertAt = i + 1;
  else {
    if (c.loopMode !== "none") throw new EditError("Para congelar en medio de un clip con repeticiones, primero quitá el loop.");
    q = splitAt(p, t);
    insertAt = i + 1;
  }
  const clips = [...q.clips];
  clips.splice(insertAt, 0, freeze);
  return { ...q, clips };
}

function sourceAt(c: Clip, u: number): number {
  const seg = Math.max(EPS, segmentDuration(c));
  const uu = Math.min(Math.max(0, u), Math.max(0, clipDuration(c) - 1e-9));
  const pass = Math.floor(uu / seg);
  let fwd = c.loopMode === "boomerang" ? pass % 2 === 0 : true;
  if (c.reverse) fwd = !fwd;
  const off = (uu - pass * seg) * c.speed;
  return fwd ? Math.min(c.outPoint, c.inPoint + off) : Math.max(c.inPoint, c.outPoint - off);
}

// --------------------------------- Marcadores ---------------------------------

export function addMarker(p: Project, time: number, name = ""): Project {
  const t = Math.max(0, Math.min(time, totalDuration(p)));
  if (p.markers.some((m) => Math.abs(m.time - t) < 1e-3)) return p;
  const markers = [...p.markers, { id: makeId("k"), time: t, name }].sort((a, b) => a.time - b.time);
  return { ...p, markers };
}

export function renameMarker(p: Project, id: string, name: string): Project {
  return { ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, name: name.slice(0, 80) } : m)) };
}

export function moveMarker(p: Project, id: string, time: number): Project {
  const t = Math.max(0, Math.min(time, totalDuration(p)));
  return { ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, time: t } : m)).sort((a, b) => a.time - b.time) };
}

export function removeMarker(p: Project, id: string): Project {
  return { ...p, markers: p.markers.filter((m) => m.id !== id) };
}

/** Marcador siguiente (dir=1) o anterior (dir=-1) respecto de t. */
export function adjacentMarker(p: Project, t: number, dir: 1 | -1): number | null {
  const times = p.markers.map((m) => m.time);
  if (dir > 0) return times.find((x) => x > t + 1e-3) ?? null;
  const prev = times.filter((x) => x < t - 1e-3);
  return prev.length ? prev[prev.length - 1] : null;
}

// ----------------------------------- Rangos -----------------------------------

export function addRange(p: Project, start: number, end: number, name = ""): Project {
  const total = totalDuration(p);
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(total, Math.max(start, end));
  if (b - a < EPS) throw new EditError("Marcá un rango con inicio (I) y fin (O).");
  if (p.ranges.some((r) => Math.abs(r.start - a) < 1e-3 && Math.abs(r.end - b) < 1e-3)) return p;
  const n = p.ranges.length + 1;
  const ranges = [...p.ranges, { id: makeId("r"), start: a, end: b, name: name || `Fragmento ${n}` }].sort((x, y) => x.start - y.start);
  return { ...p, ranges };
}

export function updateRange(p: Project, id: string, patch: Partial<{ start: number; end: number; name: string }>): Project {
  return { ...p, ranges: p.ranges.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function removeRange(p: Project, id: string): Project {
  return { ...p, ranges: p.ranges.filter((r) => r.id !== id) };
}

// ----------------------------------- Música -----------------------------------

export function addMusic(p: Project, m: MediaRef, start: number): Project {
  if (!m.hasAudio) throw new EditError("Ese archivo no tiene audio.");
  const [q, ref] = addMedia(p, m);
  const music: MusicClip = {
    id: makeId("mu"),
    mediaId: ref.id,
    start: Math.max(0, start),
    inPoint: 0,
    outPoint: ref.duration,
    volume: 0.6,
    fadeIn: 0,
    fadeOut: 1.5,
    ducking: false,
  };
  return { ...q, music: [...q.music, music] };
}

export function updateMusic(p: Project, id: string, f: (m: MusicClip) => MusicClip): Project {
  return {
    ...p,
    music: p.music.map((m) => {
      if (m.id !== id) return m;
      const n = f(m);
      return {
        ...n,
        start: Math.max(0, n.start),
        volume: Math.min(MAX_CLIP_VOLUME, Math.max(0, n.volume)),
        fadeIn: Math.max(0, n.fadeIn),
        fadeOut: Math.max(0, n.fadeOut),
      };
    }),
  };
}

/** Recorta un borde de un clip de música (el izquierdo mueve también el inicio). */
export function trimMusic(p: Project, id: string, edge: "in" | "out", timelineTime: number): Project {
  return updateMusic(p, id, (m) => {
    const media = mediaById(p, m.mediaId);
    const max = media?.duration ?? m.outPoint;
    if (edge === "out") {
      const out = Math.min(max, Math.max(m.inPoint + 0.1, m.inPoint + (timelineTime - m.start)));
      return { ...m, outPoint: out };
    }
    const delta = timelineTime - m.start;
    const inPoint = Math.min(m.outPoint - 0.1, Math.max(0, m.inPoint + delta));
    return { ...m, inPoint, start: m.start + (inPoint - m.inPoint) };
  });
}

// ------------------------------------ Snap ------------------------------------

/** Imanta t al candidato más cercano si está a menos de `threshold` segundos. */
export function snap(t: number, candidates: number[], threshold: number): { time: number; snapped: boolean } {
  let best = t;
  let dist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  return { time: best, snapped: best !== t };
}

/** Bordes de clips, playhead y marcadores: los puntos donde se imanta. */
export function snapPoints(p: Project, playhead: number, excludeIds: string[] = []): number[] {
  const ex = new Set(excludeIds);
  const spans = layout(p.clips);
  const pts = [0, playhead, ...p.markers.map((m) => m.time)];
  p.clips.forEach((c, i) => {
    if (!ex.has(c.id)) pts.push(spans[i].start, spans[i].end);
  });
  for (const m of p.music) if (!ex.has(m.id)) pts.push(m.start, m.start + (m.outPoint - m.inPoint));
  return pts;
}
