// Estado global de Snip (Zustand). Las acciones puras viven acá; las que hablan
// con Rust están en ./controller.ts.

import { create } from "zustand";
import type {
  AppError,
  EncoderInfo,
  ExportOutcome,
  ExportRequest,
  FpsChoice,
  MediaInfo,
  ProgressReport,
  ResolutionChoice,
} from "../lib/types";
import { frameToSeconds, secondsToFrame } from "../lib/timecode";
import { FPS_VALUE, isFpsIncrease, planScale } from "../lib/scale";

export type Phase = "welcome" | "editor";
export type Severity = "info" | "success" | "caution" | "critical";
export type DragHint = "none" | "valid" | "invalid";

export interface Toast {
  id: number;
  severity: Severity;
  title: string;
  message?: string;
}

export interface ExportSettings {
  mode: "fast" | "precise";
  resolution: ResolutionChoice;
  fps: FpsChoice;
  frameExact: boolean;
  allowUpscale: boolean;
  allowFpsIncrease: boolean;
  /** Elegida con "Guardar como…". null = junto al original. */
  outputPath: string | null;
}

export type ExportState =
  | { status: "idle" }
  | { status: "running"; progress: ProgressReport; startedAt: number; cancelling: boolean }
  | { status: "success"; outcome: ExportOutcome }
  | { status: "error"; error: AppError };

export type ProxyState = { status: "none" } | { status: "creating"; percent: number } | { status: "ready" } | { status: "error"; error: AppError };

export const DEFAULT_SETTINGS: ExportSettings = {
  mode: "fast",
  resolution: { kind: "original" },
  fps: "original",
  frameExact: false,
  allowUpscale: false,
  allowFpsIncrease: false,
  outputPath: null,
};

export const THUMB_COUNT = 20;

/** Pedido de confirmación pendiente (upscale o subir fps). */
export type Confirmation =
  | { kind: "upscale"; resolution: ResolutionChoice; from: string; to: string }
  | { kind: "fps"; fps: FpsChoice; from: string; to: string };

export interface SnipState {
  phase: Phase;
  opening: boolean;
  session: number;
  media: MediaInfo | null;
  videoSrc: string | null;
  usingProxy: boolean;
  proxy: ProxyState;
  videoReady: boolean;
  thumbs: (string | null)[];
  keyframes: number[] | null;
  defaultOutput: string | null;

  start: number;
  end: number;
  current: number;
  playing: boolean;
  loop: boolean;
  volume: number;
  muted: boolean;

  panelOpen: boolean;
  settings: ExportSettings;
  encoder: EncoderInfo | null;
  exportState: ExportState;
  confirmation: Confirmation | null;

  drag: DragHint;
  toasts: Toast[];
  focused: boolean;

  // --- acciones puras ---
  setMediaLoaded: (media: MediaInfo, src: string, session: number) => void;
  setRange: (start: number, end: number) => void;
  setStart: (t: number) => void;
  setEnd: (t: number) => void;
  markIn: () => void;
  markOut: () => void;
  setCurrent: (t: number) => void;
  setPlaying: (p: boolean) => void;
  toggleLoop: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  togglePanel: (open?: boolean) => void;
  setMode: (mode: "fast" | "precise") => void;
  requestResolution: (r: ResolutionChoice) => void;
  requestFps: (f: FpsChoice) => void;
  resolveConfirmation: (accept: boolean) => void;
  setFrameExact: (v: boolean) => void;
  setOutputPath: (p: string | null) => void;
  pushToast: (t: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;
  reset: () => void;
}

let toastId = 1;

function loadVolume(): { volume: number; muted: boolean } {
  try {
    const raw = localStorage.getItem("snip.volume");
    if (raw) {
      const v = JSON.parse(raw);
      return { volume: Math.min(1, Math.max(0, Number(v.volume) || 0)), muted: !!v.muted };
    }
  } catch {
    /* sin storage */
  }
  return { volume: 0.8, muted: false };
}

function saveVolume(volume: number, muted: boolean) {
  try {
    localStorage.setItem("snip.volume", JSON.stringify({ volume, muted }));
  } catch {
    /* sin storage */
  }
}

/** ¿Hace falta recodificar con esta configuración? */
export function needsPrecise(s: ExportSettings): boolean {
  return s.mode === "precise" || s.frameExact || s.resolution.kind !== "original" || s.fps !== "original";
}

export function effectiveMode(s: ExportSettings): "fast" | "precise" {
  return needsPrecise(s) ? "precise" : "fast";
}

/** Duración mínima: un cuadro. */
function minLen(media: MediaInfo | null): number {
  return media ? 1 / media.fps : 0.001;
}

function quantize(t: number, media: MediaInfo | null): number {
  if (!media) return t;
  const f = secondsToFrame(t + 1e-6, media.fps);
  return Math.min(media.duration, frameToSeconds(f, media.fps));
}

const initial = {
  phase: "welcome" as Phase,
  opening: false,
  session: 0,
  media: null,
  videoSrc: null,
  usingProxy: false,
  proxy: { status: "none" } as ProxyState,
  videoReady: false,
  thumbs: [] as (string | null)[],
  keyframes: null,
  defaultOutput: null,
  start: 0,
  end: 0,
  current: 0,
  playing: false,
  loop: false,
  panelOpen: true,
  settings: DEFAULT_SETTINGS,
  encoder: null,
  exportState: { status: "idle" } as ExportState,
  confirmation: null,
  drag: "none" as DragHint,
  toasts: [] as Toast[],
  focused: true,
};

export const useSnip = create<SnipState>()((set, get) => ({
  ...initial,
  ...loadVolume(),

  setMediaLoaded: (media, src, session) =>
    set({
      phase: "editor",
      opening: false,
      session,
      media,
      videoSrc: src,
      usingProxy: false,
      proxy: { status: "none" },
      videoReady: false,
      thumbs: Array.from({ length: THUMB_COUNT }, () => null),
      keyframes: null,
      defaultOutput: null,
      start: 0,
      end: media.duration,
      current: 0,
      playing: false,
      settings: { ...get().settings, outputPath: null, allowUpscale: false, allowFpsIncrease: false, resolution: { kind: "original" }, fps: "original" },
      exportState: { status: "idle" },
      confirmation: null,
    }),

  setRange: (start, end) => {
    const { media } = get();
    const dur = media?.duration ?? Math.max(start, end);
    let s = quantize(Math.max(0, Math.min(start, dur)), media);
    let e = end >= dur - 1e-6 ? dur : quantize(Math.max(0, Math.min(end, dur)), media);
    if (e - s < minLen(media) - 1e-9) {
      // Mantener al menos un cuadro de largo.
      if (s + minLen(media) <= dur) e = Math.min(dur, s + minLen(media));
      else s = Math.max(0, e - minLen(media));
    }
    set({ start: s, end: e });
  },

  setStart: (t) => {
    const { end, media } = get();
    const s = Math.min(quantize(Math.max(0, t), media), end - minLen(media));
    set({ start: Math.max(0, s) });
  },

  setEnd: (t) => {
    const { start, media } = get();
    const dur = media?.duration ?? t;
    const q = t >= dur - 1e-6 ? dur : quantize(t, media);
    set({ end: Math.min(dur, Math.max(q, start + minLen(media))) });
  },

  // I: el inicio es el cuadro que se ve ahora.
  markIn: () => {
    const { current } = get();
    get().setStart(current);
  },

  // O: el fin incluye el cuadro que se ve ahora.
  markOut: () => {
    const { current, media } = get();
    if (!media) return;
    const f = secondsToFrame(current, media.fps);
    get().setEnd(frameToSeconds(f + 1, media.fps));
  },

  setCurrent: (t) => {
    if (Math.abs(get().current - t) > 1e-7) set({ current: t });
  },
  setPlaying: (p) => set({ playing: p }),
  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  setVolume: (v) => {
    const volume = Math.min(1, Math.max(0, v));
    const muted = volume === 0 ? true : false;
    set({ volume, muted });
    saveVolume(volume, muted);
  },
  toggleMute: () => {
    const { muted, volume } = get();
    const next = !muted;
    const vol = !next && volume === 0 ? 0.5 : volume;
    set({ muted: next, volume: vol });
    saveVolume(vol, next);
  },
  togglePanel: (open) => set((s) => ({ panelOpen: open ?? !s.panelOpen })),

  // "Rápido" vuelve todo a original (no se puede cambiar nada sin recodificar).
  setMode: (mode) =>
    set((s) => ({
      settings:
        mode === "fast"
          ? { ...s.settings, mode, frameExact: false, resolution: { kind: "original" }, fps: "original" }
          : { ...s.settings, mode },
      exportState: s.exportState.status === "running" ? s.exportState : { status: "idle" },
    })),

  requestResolution: (r) => {
    const { media, settings } = get();
    if (!media) return;
    const plan = planScale({ width: media.width, height: media.height }, r);
    const apply = (allow: boolean) =>
      set({
        settings: {
          ...settings,
          resolution: r,
          allowUpscale: allow,
          mode: r.kind === "original" && settings.fps === "original" && !settings.frameExact ? settings.mode : "precise",
        },
      });
    if (r.kind !== "original" && plan.upscale) {
      set({
        confirmation: {
          kind: "upscale",
          resolution: r,
          from: `${media.width}×${media.height}`,
          to: `${plan.width}×${plan.height}`,
        },
      });
      return;
    }
    apply(false);
  },

  requestFps: (f) => {
    const { media, settings } = get();
    if (!media) return;
    const target = FPS_VALUE[f];
    const precise = f !== "original" || settings.resolution.kind !== "original" || settings.frameExact;
    if (target !== null && isFpsIncrease(target, media.fps)) {
      set({ confirmation: { kind: "fps", fps: f, from: `${Math.round(media.fps * 100) / 100} fps`, to: `${target} fps` } });
      return;
    }
    set({ settings: { ...settings, fps: f, allowFpsIncrease: false, mode: precise ? "precise" : settings.mode } });
  },

  resolveConfirmation: (accept) => {
    const { confirmation, settings } = get();
    if (!confirmation) return;
    if (!accept) {
      set({ confirmation: null });
      return;
    }
    if (confirmation.kind === "upscale") {
      set({ confirmation: null, settings: { ...settings, resolution: confirmation.resolution, allowUpscale: true, mode: "precise" } });
    } else {
      set({ confirmation: null, settings: { ...settings, fps: confirmation.fps, allowFpsIncrease: true, mode: "precise" } });
    }
  },

  setFrameExact: (v) =>
    set((s) => ({ settings: { ...s.settings, frameExact: v, mode: v ? "precise" : s.settings.mode } })),

  setOutputPath: (p) => set((s) => ({ settings: { ...s.settings, outputPath: p } })),

  pushToast: (t) => {
    const id = toastId++;
    // Sin duplicados: si ya hay uno igual, se reemplaza.
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.title !== t.title), { ...t, id }].slice(-3) }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  reset: () => set({ ...initial, ...loadVolume() }),
}));

/** Arma el pedido tipado que se manda a Rust. */
export function buildExportRequest(s: Pick<SnipState, "media" | "start" | "end" | "settings">): ExportRequest | null {
  if (!s.media) return null;
  const st = s.settings;
  return {
    input: s.media.path,
    output: st.outputPath,
    start: s.start,
    end: s.end,
    mode: effectiveMode(st),
    resolution: st.resolution,
    fps: st.fps,
    frameExact: st.frameExact,
    allowUpscale: st.allowUpscale,
    allowFpsIncrease: st.allowFpsIncrease,
  };
}
