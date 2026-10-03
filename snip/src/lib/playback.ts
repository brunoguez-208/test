// Control del <video>: reproducción, seek con precisión de cuadro, respeto del
// rango de recorte y J/K/L. El tiempo "fino" vive en un MotionValue para que el
// playhead se mueva a 60 fps sin re-renderizar React en cada cuadro.

import { motionValue } from "motion/react";
import { useSnip } from "../store/snip";
import { frameToSeconds, secondsToFrame } from "./timecode";
import { nextShuttleRate } from "./shortcuts";

export const playheadTime = motionValue(0);

let video: HTMLVideoElement | null = null;
let rvfcHandle = 0;
let reverseRaf = 0;
let shuttleRate = 0;
let lastReverseTs = 0;

function fps(): number {
  return useSnip.getState().media?.fps ?? 30;
}

/** Pequeño margen para que el seek caiga dentro del cuadro y no en el borde. */
function seekTimeForFrame(frame: number): number {
  const f = fps();
  return frameToSeconds(frame, f) + Math.min(0.001, 0.25 / f);
}

function publish(t: number) {
  playheadTime.set(t);
  const st = useSnip.getState();
  const f = fps();
  const quant = frameToSeconds(secondsToFrame(t, f), f);
  st.setCurrent(quant);
}

function onFrame(_now: number, meta: VideoFrameCallbackMetadata) {
  if (!video) return;
  publish(meta.mediaTime);
  enforceRange(meta.mediaTime);
  rvfcHandle = video.requestVideoFrameCallback(onFrame);
}

/** Si la reproducción pasa el final del rango: loop o pausa en el último cuadro. */
function enforceRange(t: number) {
  if (!video || video.paused) return;
  const { start, end, loop } = useSnip.getState();
  const half = 0.5 / fps();
  if (t >= end - half) {
    if (loop) {
      video.currentTime = seekTimeForFrame(secondsToFrame(start, fps()));
    } else {
      video.pause();
      const last = Math.max(secondsToFrame(start, fps()), secondsToFrame(end, fps()) - 1);
      video.currentTime = seekTimeForFrame(last);
    }
  }
}

export function attachVideo(el: HTMLVideoElement | null) {
  if (video && rvfcHandle) video.cancelVideoFrameCallback(rvfcHandle);
  video = el;
  shuttleRate = 0;
  if (!el) return;
  if ("requestVideoFrameCallback" in el) {
    rvfcHandle = el.requestVideoFrameCallback(onFrame);
  }
  el.addEventListener("timeupdate", () => {
    // Respaldo por si rVFC no dispara (pestaña oculta, etc.).
    if (el.paused) publish(el.currentTime);
    enforceRange(el.currentTime);
  });
  el.addEventListener("seeked", () => publish(el.currentTime));
  el.addEventListener("play", () => useSnip.getState().setPlaying(true));
  el.addEventListener("pause", () => {
    if (!reverseRaf) useSnip.getState().setPlaying(false);
  });
}

export function getVideo() {
  return video;
}

export function seekToFrame(frame: number) {
  if (!video) return;
  const st = useSnip.getState();
  const total = st.media ? Math.max(0, Math.round(st.media.duration * st.media.fps) - 1) : frame;
  const f = Math.max(0, Math.min(total, frame));
  video.currentTime = seekTimeForFrame(f);
  publish(frameToSeconds(f, fps()));
}

export function seekToTime(t: number) {
  seekToFrame(secondsToFrame(t, fps()));
}

export function stepFrames(n: number) {
  stopShuttle();
  video?.pause();
  const cur = secondsToFrame(useSnip.getState().current, fps());
  seekToFrame(cur + n);
}

export function stepSeconds(s: number) {
  stopShuttle();
  video?.pause();
  seekToTime(useSnip.getState().current + s);
}

export async function play() {
  if (!video) return;
  stopReverse();
  const { start, end, current } = useSnip.getState();
  const half = 0.5 / fps();
  // Si estamos fuera del rango o en el final, arrancamos desde el inicio del recorte.
  if (current < start - half || current >= end - 1 / fps() - half) {
    seekToTime(start);
  }
  try {
    await video.play();
  } catch {
    /* el usuario pausó antes de que arranque */
  }
}

export function pause() {
  stopShuttle();
  video?.pause();
}

export function togglePlay() {
  const playing = useSnip.getState().playing;
  if (playing) pause();
  else {
    shuttleRate = 1;
    if (video) video.playbackRate = 1;
    void play();
  }
}

function stopReverse() {
  if (reverseRaf) cancelAnimationFrame(reverseRaf);
  reverseRaf = 0;
}

function stopShuttle() {
  stopReverse();
  shuttleRate = 0;
  if (video) video.playbackRate = 1;
}

/** Retroceso simulado (Chromium no soporta playbackRate negativo). */
function reverseLoop(ts: number) {
  if (!video) return;
  const dt = lastReverseTs ? (ts - lastReverseTs) / 1000 : 0;
  lastReverseTs = ts;
  const { start } = useSnip.getState();
  const next = video.currentTime + dt * shuttleRate; // shuttleRate < 0
  if (next <= start) {
    video.currentTime = start;
    publish(start);
    stopShuttle();
    useSnip.getState().setPlaying(false);
    return;
  }
  if (!video.seeking) {
    video.currentTime = next;
    publish(next);
  }
  reverseRaf = requestAnimationFrame(reverseLoop);
}

export function shuttle(key: "j" | "k" | "l") {
  if (!video) return;
  shuttleRate = nextShuttleRate(shuttleRate, key);
  if (shuttleRate === 0) {
    pause();
    return;
  }
  if (shuttleRate > 0) {
    stopReverse();
    video.playbackRate = shuttleRate;
    void play();
  } else {
    video.pause();
    video.playbackRate = 1;
    useSnip.getState().setPlaying(true);
    if (!reverseRaf) {
      lastReverseTs = 0;
      reverseRaf = requestAnimationFrame(reverseLoop);
    }
  }
}

export function applyVolume(volume: number, muted: boolean) {
  if (!video) return;
  video.volume = volume;
  video.muted = muted;
}
