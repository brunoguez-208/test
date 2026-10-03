// Audio de las pistas en el preview: espejo exacto de snip-core/src/audio_fx.rs
// ("Mejorar voz", curvas de volumen, crossfade automático, volumen/silenciar/solo
// por pista). Los parámetros salen del mismo config/voice.json.

import voiceFile from "../../src-tauri/core/config/voice.json" with { type: "json" };
import type { MusicClip, Project, TrackState, Tracks, VoiceEnhance, VolumeKey } from "../project/model";

interface VoiceConfig {
  highpass: { base: number; range: number; q: number };
  mud: { freq: number; q: number; gainRange: number };
  presence: { freq: number; q: number; gainRange: number };
  air: { freq: number; gainRange: number };
  compressor: { thresholdBase: number; thresholdRange: number; ratioBase: number; ratioRange: number; attackMs: number; releaseMs: number; kneeDb: number };
  denoise: { base: number; range: number };
  level: { targetLufs: number; minDb: number; maxDb: number };
  crossfade: number;
}

const C = voiceFile as unknown as VoiceConfig;

export const AUTO_CROSSFADE = C.crossfade;
export const DEFAULT_VOICE_AMOUNT = 0.6;

export interface VoiceParams {
  highpassHz: number;
  highpassQ: number;
  mudHz: number;
  mudQ: number;
  mudDb: number;
  presenceHz: number;
  presenceQ: number;
  presenceDb: number;
  airHz: number;
  airDb: number;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  denoiseNr: number;
  makeupDb: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function voiceParams(e: VoiceEnhance): VoiceParams {
  const a = clamp(e.amount, 0, 1);
  const makeupDb = e.loudness ? clamp(C.level.targetLufs - e.loudness.inputI, C.level.minDb, C.level.maxDb) : 0;
  return {
    highpassHz: C.highpass.base + C.highpass.range * a,
    highpassQ: C.highpass.q,
    mudHz: C.mud.freq,
    mudQ: C.mud.q,
    mudDb: C.mud.gainRange * a,
    presenceHz: C.presence.freq,
    presenceQ: C.presence.q,
    presenceDb: C.presence.gainRange * a,
    airHz: C.air.freq,
    airDb: C.air.gainRange * a,
    thresholdDb: C.compressor.thresholdBase + C.compressor.thresholdRange * a,
    ratio: C.compressor.ratioBase + C.compressor.ratioRange * a,
    attackMs: C.compressor.attackMs,
    releaseMs: C.compressor.releaseMs,
    kneeDb: C.compressor.kneeDb,
    denoiseNr: C.denoise.base + C.denoise.range * a,
    makeupDb,
  };
}

export function smooth(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Ganancia de la curva de volumen en u (segundos desde el inicio del clip). */
export function keyGain(keys: VolumeKey[] | undefined, u: number): number {
  if (!keys || !keys.length) return 1;
  const k = [...keys].sort((a, b) => a.t - b.t);
  if (k.length === 1 || u <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    if (u <= k[i + 1].t) {
      const span = Math.max(1e-9, k[i + 1].t - k[i].t);
      return k[i].v + (k[i + 1].v - k[i].v) * smooth((u - k[i].t) / span);
    }
  }
  return k[k.length - 1].v;
}

const len = (m: MusicClip) => Math.max(0, m.outPoint - m.inPoint);

/** Fades efectivos: los del clip o el crossfade corto si toca a otro de la misma pista. */
export function effectiveFades(p: Project, m: MusicClip): [number, number] {
  const tr = m.track ?? 0;
  const end = m.start + len(m);
  let fi = m.fadeIn;
  let fo = m.fadeOut;
  if (p.music.some((o) => o.id !== m.id && (o.track ?? 0) === tr && Math.abs(o.start + len(o) - m.start) < 0.02)) fi = Math.max(fi, AUTO_CROSSFADE);
  if (p.music.some((o) => o.id !== m.id && (o.track ?? 0) === tr && Math.abs(o.start - end) < 0.02)) fo = Math.max(fo, AUTO_CROSSFADE);
  return [Math.min(fi, len(m) / 2), Math.min(fo, len(m) / 2)];
}

export function audioTrack(t: Tracks | undefined, i: number): TrackState {
  return t?.audio?.[i] ?? {};
}

export function anySolo(t: Tracks | undefined): boolean {
  return !!t?.videoAudio?.solo || !!t?.audio?.some((x) => x?.solo);
}

/** Ganancia de una pista según silenciar / solo / volumen (igual que Tracks::gain_of). */
export function trackGain(t: Tracks | undefined, s: TrackState | undefined): number {
  if (s?.muted || (anySolo(t) && !s?.solo)) return 0;
  return Math.max(0, s?.volume ?? 1);
}
