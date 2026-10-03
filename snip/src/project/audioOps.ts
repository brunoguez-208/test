// Edición de audio: separar/unir el audio de un clip, dividir clips de audio,
// curvas de volumen, estado de las pistas y "Mejorar voz". Operaciones puras.

import type { MusicClip, Project, TrackState, Tracks, VoiceEnhance, VolumeKey } from "./model";
import { EditError, makeId, mediaById, updateMusic } from "./ops";
import { layout } from "./timeline";
import { freeMusicTrack } from "./clipboard";

export const MIN_AUDIO = 0.1;
export const MAX_KEY_GAIN = 2;

const len = (m: MusicClip) => m.outPoint - m.inPoint;

/** ¿Se puede separar el audio de este clip? (sin velocidad, reversa ni loops). */
export function canSeparate(p: Project, id: string): boolean {
  const c = p.clips.find((x) => x.id === id);
  const m = c ? mediaById(p, c.mediaId) : undefined;
  return !!c && !!m?.hasAudio && c.kind === "video" && !c.audio.removed && !c.audio.detached && Math.abs(c.speed - 1) < 1e-9 && !c.speedKeys?.length && !c.reverse && c.loopMode === "none";
}

/**
 * "Separar audio": el sonido del clip pasa a su propia pista (mismo tramo, en el
 * mismo lugar del timeline) y el clip queda mudo. Devuelve los ids nuevos.
 */
export function separateAudio(p0: Project, ids: string[]): [Project, string[]] {
  let p = p0;
  const spans = layout(p.clips);
  const out: string[] = [];
  const tried = ids.filter((id) => p.clips.some((c) => c.id === id));
  for (const id of tried) {
    if (!canSeparate(p, id)) continue;
    const i = p.clips.findIndex((c) => c.id === id);
    const c = p.clips[i];
    const start = spans[i].start;
    const mu: MusicClip = {
      id: makeId("mu"),
      mediaId: c.mediaId,
      start,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      volume: c.audio.volume,
      fadeIn: c.audio.fadeIn,
      fadeOut: c.audio.fadeOut,
      ducking: false,
      track: freeMusicTrack(p, start, start + (c.outPoint - c.inPoint), 0),
      enhance: c.audio.enhance ?? null,
      linkedClip: c.id,
      sourceTrack: c.audio.track ?? null,
    };
    p = {
      ...p,
      music: [...p.music, mu],
      clips: p.clips.map((x) => (x.id === id ? { ...x, audio: { ...x.audio, detached: true } } : x)),
    };
    out.push(mu.id);
  }
  if (!out.length) {
    throw new EditError(tried.length ? "Ese clip no tiene audio para separar (o tiene velocidad, reversa o repeticiones)." : "Elegí un clip de video para separar su audio.");
  }
  return [p, out];
}

/** "Unir audio": vuelve a pegar el audio separado a su clip (se borra la pista). */
export function joinAudio(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  // Vale elegir el clip de audio o el clip de video.
  const linked = p.music.filter((m) => m.linkedClip && (set.has(m.id) || set.has(m.linkedClip)) && p.clips.some((c) => c.id === m.linkedClip));
  if (!linked.length) throw new EditError("Ese audio no está separado de un clip.");
  const back = new Map(linked.map((m) => [m.linkedClip!, m]));
  return {
    ...p,
    music: p.music.filter((m) => !linked.includes(m)),
    clips: p.clips.map((c) => {
      const m = back.get(c.id);
      return m ? { ...c, audio: { ...c.audio, detached: false, volume: m.volume, enhance: m.enhance ?? null } } : c;
    }),
  };
}

/** ¿Hay audio separado unible en la selección? */
export function canJoin(p: Project, ids: string[]): boolean {
  const set = new Set(ids);
  return p.music.some((m) => m.linkedClip && (set.has(m.id) || set.has(m.linkedClip)) && p.clips.some((c) => c.id === m.linkedClip));
}

/** Divide un clip de audio en el tiempo t del timeline (la curva de volumen se reparte). */
export function splitMusicAt(p: Project, id: string, t: number): Project {
  const m = p.music.find((x) => x.id === id);
  if (!m) return p;
  const u = t - m.start;
  if (u < MIN_AUDIO || len(m) - u < MIN_AUDIO) throw new EditError("Muy cerca del borde del audio para dividir.");
  const keys = m.volumeKeys ?? [];
  const a: MusicClip = { ...m, outPoint: m.inPoint + u, fadeOut: 0, volumeKeys: keys.filter((k) => k.t <= u) };
  const b: MusicClip = {
    ...m,
    id: makeId("mu"),
    start: t,
    inPoint: m.inPoint + u,
    fadeIn: 0,
    linkedClip: null,
    volumeKeys: keys.filter((k) => k.t >= u).map((k) => ({ ...k, t: k.t - u })),
  };
  return { ...p, music: p.music.flatMap((x) => (x.id === id ? [a, b] : [x])) };
}

/** Elementos que no son de la pista principal y están bajo el playhead. */
export function audioUnder(p: Project, ids: string[], t: number): string[] {
  const set = new Set(ids);
  return p.music.filter((m) => set.has(m.id) && t > m.start + MIN_AUDIO && t < m.start + len(m) - MIN_AUDIO).map((m) => m.id);
}

// ------------------------------ Curva de volumen ------------------------------

let keySeq = 1;

/** Agrega un punto en u (segundos desde el inicio del clip) con la ganancia actual de la curva. */
export function addVolumeKey(p: Project, id: string, u: number, v?: number): [Project, number] {
  const kid = Date.now() * 10 + (keySeq++ % 10);
  const q = updateMusic(p, id, (m) => {
    const keys = m.volumeKeys ?? [];
    const val = v ?? (keys.length ? valueAt(keys, u) : 1);
    const t = Math.min(len(m), Math.max(0, u));
    return { ...m, volumeKeys: [...keys.filter((k) => Math.abs(k.t - t) > 0.01), { id: kid, t, v: clampGain(val) }].sort((a, b) => a.t - b.t) };
  });
  return [q, kid];
}

function valueAt(keys: VolumeKey[], u: number): number {
  const k = [...keys].sort((a, b) => a.t - b.t);
  if (u <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    if (u <= k[i + 1].t) {
      const x = Math.min(1, Math.max(0, (u - k[i].t) / Math.max(1e-9, k[i + 1].t - k[i].t)));
      return k[i].v + (k[i + 1].v - k[i].v) * x * x * (3 - 2 * x);
    }
  }
  return k[k.length - 1].v;
}

const clampGain = (v: number) => Math.min(MAX_KEY_GAIN, Math.max(0, v));

export function moveVolumeKey(p: Project, id: string, keyId: number, t: number, v: number): Project {
  return updateMusic(p, id, (m) => ({
    ...m,
    volumeKeys: (m.volumeKeys ?? []).map((k) => (k.id === keyId ? { ...k, t: Math.min(len(m), Math.max(0, t)), v: clampGain(v) } : k)).sort((a, b) => a.t - b.t),
  }));
}

export function removeVolumeKey(p: Project, id: string, keyId: number): Project {
  return updateMusic(p, id, (m) => ({ ...m, volumeKeys: (m.volumeKeys ?? []).filter((k) => k.id !== keyId) }));
}

// --------------------------------- Pistas ---------------------------------

export type TrackRef = { kind: "video" | "videoAudio" | "subtitles" } | { kind: "overlay" | "audio"; index: number };

export function trackState(p: Project, r: TrackRef): TrackState {
  const t = p.tracks ?? {};
  if (r.kind === "overlay") return t.overlays?.[r.index] ?? {};
  if (r.kind === "audio") return t.audio?.[r.index] ?? {};
  return t[r.kind] ?? {};
}

/** Cambia el estado de una pista (volumen, silenciar, solo, ocultar, bloquear, nombre). */
export function setTrackState(p: Project, r: TrackRef, patch: Partial<TrackState>): Project {
  const t: Tracks = { ...(p.tracks ?? {}) };
  if (r.kind === "overlay" || r.kind === "audio") {
    const key = r.kind === "overlay" ? "overlays" : "audio";
    const list = [...(t[key] ?? [])];
    while (list.length <= r.index) list.push({});
    list[r.index] = { ...list[r.index], ...patch };
    t[key] = list;
  } else t[r.kind] = { ...(t[r.kind] ?? {}), ...patch };
  return { ...p, tracks: t };
}

export const DEFAULT_TRACK_NAMES = ["Música", "Efectos", "Voz"];

export function audioTrackName(p: Project, i: number): string {
  return p.tracks?.audio?.[i]?.name || DEFAULT_TRACK_NAMES[i] || `Audio ${i + 1}`;
}

// ------------------------------- Mejorar voz -------------------------------

/** Activa / ajusta / saca "Mejorar voz" en clips de video o de audio. */
export function setEnhance(p: Project, ids: string[], e: VoiceEnhance | null): Project {
  const set = new Set(ids);
  return {
    ...p,
    clips: p.clips.map((c) => (set.has(c.id) ? { ...c, audio: { ...c.audio, enhance: e } } : c)),
    music: p.music.map((m) => (set.has(m.id) ? { ...m, enhance: e } : m)),
  };
}
