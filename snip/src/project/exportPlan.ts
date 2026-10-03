// Para la UI de exportación: ¿va en modo rápido? ¿cuánto bitrate deja un
// tamaño objetivo? Espejo de fast.rs y sizing.rs (Rust tiene la última palabra).

import type { ExportSettings, MediaRef, Project } from "./model";
import { canvasFps, DEFAULT_AUDIO } from "./model";
import { totalDuration } from "./timeline";
import { planScale } from "../lib/scale";
import type { ResolutionChoice } from "../lib/types";

const COPYABLE_AUDIO = ["aac", "mp3", "ac3", "eac3", "alac", "opus", "flac"];

function copyCompatible(format: ExportSettings["format"], m: MediaRef): boolean {
  const v = m.videoCodec ?? "";
  const videoOk =
    format === "mkv" ? true : format === "mp4" ? ["h264", "hevc", "av1", "vp9", "mpeg4"].includes(v) : format === "mov" ? ["h264", "hevc", "prores", "mpeg4"].includes(v) : false;
  const audioOk = !m.audioCodec || format === "mkv" || COPYABLE_AUDIO.includes(m.audioCodec);
  return videoOk && audioOk;
}

/** ¿La exportación va a ser "rápida · sin pérdida"? (espejo de fast::plan). */
export function isFastEligible(p: Project, st: ExportSettings = p.export): boolean {
  if (st.mode !== "auto" || !["mp4", "mov", "mkv"].includes(st.format) || st.sizeTarget) return false;
  if (st.resolution.kind !== "original" || st.fps !== "original") return false;
  if (!p.clips.length || p.overlays.length || p.music.length || p.subtitles.cues.length || p.fades.fadeIn > 0 || p.fades.fadeOut > 0) return false;
  const m = p.media.find((x) => x.id === p.clips[0].mediaId);
  if (!m || m.kind !== "video") return false;
  if (p.canvas.width !== m.width - (m.width % 2) || p.canvas.height !== m.height - (m.height % 2)) return false;
  if (Math.abs(canvasFps(p.canvas) - m.fps) > 0.01 || !copyCompatible(st.format, m)) return false;
  // Varias pistas de audio (ShadowPlay): se mezclan, no se copian.
  if ((m.audioTracks ?? 1) > 1) return false;
  let lastOut = -1;
  for (const c of p.clips) {
    const plain =
      c.kind === "video" &&
      c.speed === 1 &&
      !c.reverse &&
      !c.smoothSlowmo &&
      c.loopMode === "none" &&
      !c.transition &&
      JSON.stringify(c.audio) === JSON.stringify(DEFAULT_AUDIO) &&
      !c.video.crop &&
      !c.video.rotate &&
      !c.video.flipH &&
      !c.video.flipV &&
      !c.video.look &&
      !c.video.stabilize &&
      !c.video.sharpen &&
      !c.video.denoise &&
      !c.video.zoom.length &&
      Object.values(c.video.color).every((v) => v === 0);
    if (c.mediaId !== m.id || !plain || c.inPoint < lastOut - 1e-3) return false;
    lastOut = c.outPoint;
  }
  return true;
}

export interface SizeEstimate {
  videoKbps: number;
  audioKbps: number;
  lowQuality: boolean;
  suggestion: ResolutionChoice | null;
  tooLong: boolean;
}

/** Igual que sizing::plan_bitrate (para avisar antes de exportar). */
export function estimateBitrate(p: Project, st: ExportSettings, megabytes: number, ratio = 0.95, duration = totalDuration(p)): SizeEstimate {
  const hasAudio = p.clips.some((c) => !c.audio.removed && p.media.find((m) => m.id === c.mediaId)?.hasAudio) || p.music.length > 0;
  const total = (megabytes * 1e6 * ratio * 8 * 0.98) / Math.max(0.1, duration) / 1000;
  if (st.format === "mp3") {
    const a = Math.min(320, Math.floor(total));
    return { videoKbps: 0, audioKbps: a, lowQuality: a < 96, suggestion: null, tooLong: a < 32 };
  }
  const audio = !hasAudio ? 0 : total >= 2500 ? 192 : total >= 1000 ? 160 : total >= 500 ? 128 : total >= 250 ? 96 : 64;
  const video = Math.floor(total - audio);
  const scale = planScale({ width: p.canvas.width, height: p.canvas.height }, st.resolution);
  const fps = st.fps === "original" ? canvasFps(p.canvas) : Number(st.fps.replace("fps", ""));
  const bpp = (video * 1000) / (scale.width * scale.height * fps);
  const lowQuality = bpp < 0.03;
  let suggestion: ResolutionChoice | null = null;
  if (lowQuality) {
    const short = Math.min(scale.width, scale.height);
    const aspect = Math.max(scale.width, scale.height) / short;
    for (const side of [1080, 720, 540, 480, 360]) {
      if (side >= short) continue;
      const long = Math.round((side * aspect) / 2) * 2;
      const [w, h] = scale.width >= scale.height ? [long, side] : [side, long];
      if ((video * 1000) / (w * h * fps) >= 0.08) {
        suggestion = side === 1080 ? { kind: "p1080" } : side === 720 ? { kind: "p720" } : { kind: "custom", width: w };
        break;
      }
    }
    if (!suggestion) suggestion = { kind: "custom", width: scale.width >= scale.height ? Math.round((360 * aspect) / 2) * 2 : 360 };
  }
  return { videoKbps: video, audioKbps: audio, lowQuality, suggestion, tooLong: video < 60 };
}
