// Modelo de proyecto (espejo exacto de snip-core/src/project.rs, en camelCase).
// Edición no destructiva: el video original nunca se toca.

import type { FpsChoice, ResolutionChoice } from "../lib/types";

export const PROJECT_VERSION = 1;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const MAX_LOOP_COUNT = 20;
export const MAX_CLIP_VOLUME = 2;

export const LOUDNORM_I = -14;

export type MediaKind = "video" | "audio" | "image";

export interface MediaRef {
  id: string;
  path: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  fps: number;
  fpsNum: number;
  fpsDen: number;
  hasAudio: boolean;
  videoCodec?: string | null;
  audioCodec?: string | null;
  rotation: number;
  sizeBytes?: number | null;
  /** Pistas de audio del archivo (ShadowPlay graba 2: juego y micrófono). */
  audioTracks?: number;
  /** Transferencia HDR ("smpte2084" = PQ, "arib-std-b67" = HLG). */
  transfer?: string | null;
}

export type ClipKind = "video" | "freeze";
export type LoopMode = "none" | "loop" | "boomerang";

export interface Loudness {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

export interface ClipAudio {
  volume: number;
  muted: boolean;
  removed: boolean;
  fadeIn: number;
  fadeOut: number;
  normalize: Loudness | null;
  denoise: boolean;
  /** Pista del archivo a usar (0 = la primera); null/undefined = mezclar todas. */
  track?: number | null;
  /** "Mejorar voz" (EQ, compresor, ruido y nivel de micrófono). */
  enhance?: VoiceEnhance | null;
  /** El audio se separó a una pista propia: acá no suena. */
  detached?: boolean;
}

export interface VoiceEnhance {
  /** Intensidad 0..1. */
  amount: number;
  /** Nivel medido del original (para llevar la voz a −16 LUFS). */
  loudness?: Loudness | null;
}

/** Punto de la curva de volumen (t relativo al inicio del clip de audio). */
export interface VolumeKey {
  id: number;
  t: number;
  v: number;
}

/** Estado de una pista: ojo, silenciar, solo, candado y volumen. */
export interface TrackState {
  name?: string | null;
  hidden?: boolean;
  muted?: boolean;
  solo?: boolean;
  locked?: boolean;
  volume?: number;
}

export interface Tracks {
  video?: TrackState;
  /** Audio de los clips de la pista principal. */
  videoAudio?: TrackState;
  overlays?: TrackState[];
  subtitles?: TrackState;
  audio?: TrackState[];
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
  aspect?: string | null;
}

export interface ColorAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  exposure: number;
}

export interface Look {
  id: string;
  intensity: number;
}

export type Easing = "linear" | "easeInOut" | "easeIn" | "easeOut";

export interface ZoomKey {
  id: number;
  t: number;
  zoom: number;
  cx: number;
  cy: number;
  easing: Easing;
}

export interface ClipVideo {
  crop: CropRect | null;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  color: ColorAdjust;
  look: Look | null;
  stabilize: { strength: number } | null;
  sharpen: number;
  denoise: number;
  zoom: ZoomKey[];
}

export type TransitionKind =
  | "fade"
  | "fadeBlack"
  | "fadeWhite"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "wipeLeft"
  | "wipeRight"
  | "circleOpen"
  | "zoomIn";

export interface Transition {
  kind: TransitionKind;
  duration: number;
}

/** Punto de una rampa de velocidad: t en segundos del original desde la entrada. */
export interface SpeedKey {
  id: number;
  t: number;
  v: number;
}
export type RampAudio = "mute" | "pitch";

export interface Clip {
  id: string;
  mediaId: string;
  kind: ClipKind;
  inPoint: number;
  outPoint: number;
  speed: number;
  smoothSlowmo: boolean;
  reverse: boolean;
  loopMode: LoopMode;
  loopCount: number;
  freezeDuration: number;
  audio: ClipAudio;
  video: ClipVideo;
  transition: Transition | null;
  /** Rampa de velocidad: si hay puntos, mandan sobre `speed`. */
  speedKeys?: SpeedKey[];
  /** Audio durante la rampa: mudo (lo normal) o con el tono preservado. */
  rampAudio?: RampAudio;
}

// --------------------------- Superposiciones (tanda 2) ---------------------------

export type TextAlign = "left" | "center" | "right";
export interface Stroke {
  color: string;
  width: number;
}
export interface Shadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}
export interface TextBackground {
  color: string;
  opacity: number;
  padding: number;
  radius: number;
}
export interface TextStyle {
  fontFamily: string;
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  align: TextAlign;
  stroke: Stroke | null;
  shadow: Shadow | null;
  background: TextBackground | null;
}
export type TextAnimKind = "fade" | "slide" | "pop" | "typewriter";
export interface TextAnim {
  kind: TextAnimKind;
  duration: number;
}
export interface TextLayer {
  type: "text";
  text: string;
  template?: string | null;
  style: TextStyle;
  x: number;
  y: number;
  animIn: TextAnim | null;
  animOut: TextAnim | null;
}
export interface ImageLayer {
  type: "image";
  mediaId: string;
  x: number;
  y: number;
  width: number;
  opacity: number;
  radius: number;
  shadow: boolean;
  /** Rotación en grados (sentido horario). */
  rotation?: number;
  animIn?: TextAnim | null;
  animOut?: TextAnim | null;
  /** Marca de agua: dura todo el video (se ajusta sola si cambia el largo). */
  watermark?: boolean;
}
/** Chroma key: quita un color de fondo (como `chromakey` + `despill` de FFmpeg). */
export interface ChromaKey {
  color: string;
  similarity: number;
  smoothness: number;
  despill: number;
}
export const DEFAULT_CHROMA: ChromaKey = { color: "#00b140", similarity: 0.15, smoothness: 0.08, despill: 0.5 };

export interface PipLayer {
  type: "video";
  mediaId: string;
  inPoint: number;
  x: number;
  y: number;
  width: number;
  radius: number;
  shadow: boolean;
  volume: number;
  chroma?: ChromaKey | null;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RectKey {
  id: number;
  t: number;
  rect: Rect;
}
export interface BlurLayer {
  type: "blur";
  mode: "blur" | "pixelate";
  strength: number;
  rect: Rect;
  keys: RectKey[];
}
export type EffectKind = "shake" | "zoomPunch" | "flash" | "glitch" | "vignette";
/** Efecto de un clic sobre todo el cuadro, como bloque en la pista de capas. */
export interface EffectLayer {
  type: "effect";
  kind: EffectKind;
  /** 0..1 */
  intensity: number;
}
export type OverlayContent = TextLayer | ImageLayer | PipLayer | BlurLayer | EffectLayer;
export type Overlay = { id: string; start: number; duration: number; lane: number } & OverlayContent;

// ---------------------------------- Música ----------------------------------

export interface MusicClip {
  id: string;
  mediaId: string;
  start: number;
  inPoint: number;
  outPoint: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  ducking: boolean;
  /** Pista de audio (fila) donde está; 0 = la primera. */
  track?: number;
  volumeKeys?: VolumeKey[];
  enhance?: VoiceEnhance | null;
  /** Audio separado de un clip de la pista principal (su id). */
  linkedClip?: string | null;
  /** Pista del archivo (null = mezclar todas). */
  sourceTrack?: number | null;
  muted?: boolean;
}

export interface Marker {
  id: string;
  time: number;
  name: string;
}

export interface TimeRange {
  id: string;
  start: number;
  end: number;
  name: string;
}

export interface Word {
  start: number;
  end: number;
  text: string;
}
export interface Cue {
  id: string;
  start: number;
  end: number;
  text: string;
  words: Word[];
}
export interface SubtitleStyle {
  fontFamily: string;
  size: number;
  weight: number;
  color: string;
  highlight: string;
  stroke: Stroke | null;
  background: TextBackground | null;
  y: number;
  uppercase: boolean;
}
export interface Subtitles {
  cues: Cue[];
  style: SubtitleStyle;
  wordByWord: boolean;
  language: string | null;
}

export interface Fades {
  fadeIn: number;
  fadeOut: number;
}

export interface Canvas {
  width: number;
  height: number;
  fpsNum: number;
  fpsDen: number;
  auto: boolean;
}

export interface ViewState {
  playhead: number;
  zoom: number;
  scroll: number;
}

export type OutputFormat = "mp4" | "mov" | "mkv" | "webm" | "gif" | "mp3";

export interface SizeTarget {
  preset: string;
  megabytes: number;
}

export interface GifSettings {
  fps: number;
  width: number;
}

export interface ExportSettings {
  format: OutputFormat;
  mode: "auto" | "precise";
  resolution: ResolutionChoice;
  fps: FpsChoice;
  allowUpscale: boolean;
  allowFpsIncrease: boolean;
  sizeTarget: SizeTarget | null;
  gif: GifSettings;
}

export interface Project {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  exportedAt: number | null;
  media: MediaRef[];
  clips: Clip[];
  overlays: Overlay[];
  music: MusicClip[];
  markers: Marker[];
  ranges: TimeRange[];
  subtitles: Subtitles;
  fades: Fades;
  canvas: Canvas;
  view: ViewState;
  export: ExportSettings;
  /** Grupos (Ctrl+G): ids que se seleccionan, mueven, copian y borran juntos. */
  groups?: string[][];
  tracks?: Tracks;
}

// --------------------------------- Defaults ---------------------------------

export const DEFAULT_AUDIO: ClipAudio = {
  volume: 1,
  muted: false,
  removed: false,
  fadeIn: 0,
  fadeOut: 0,
  normalize: null,
  denoise: false,
};

export const DEFAULT_COLOR: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, exposure: 0 };

export const DEFAULT_VIDEO: ClipVideo = {
  crop: null,
  rotate: 0,
  flipH: false,
  flipV: false,
  color: DEFAULT_COLOR,
  look: null,
  stabilize: null,
  sharpen: 0,
  denoise: 0,
  zoom: [],
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Segoe UI Variable Display",
  size: 0.055,
  weight: 700,
  color: "#FFFFFF",
  highlight: "#FFD60A",
  stroke: { color: "#000000", width: 0.12 },
  background: null,
  y: 0.86,
  uppercase: false,
};

export const DEFAULT_EXPORT: ExportSettings = {
  format: "mp4",
  mode: "auto",
  resolution: { kind: "original" },
  fps: "original",
  allowUpscale: false,
  allowFpsIncrease: false,
  sizeTarget: null,
  gif: { fps: 15, width: 480 },
};

export const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: "fade", label: "Fundido" },
  { kind: "fadeBlack", label: "Fundido a negro" },
  { kind: "fadeWhite", label: "Fundido a blanco" },
  { kind: "slideLeft", label: "Deslizar ←" },
  { kind: "slideRight", label: "Deslizar →" },
  { kind: "slideUp", label: "Deslizar ↑" },
  { kind: "slideDown", label: "Deslizar ↓" },
  { kind: "wipeLeft", label: "Barrido ←" },
  { kind: "wipeRight", label: "Barrido →" },
  { kind: "circleOpen", label: "Círculo" },
  { kind: "zoomIn", label: "Zoom" },
];

export const FORMATS: { id: OutputFormat; label: string; hint: string }[] = [
  { id: "mp4", label: "MP4", hint: "H.264" },
  { id: "mov", label: "MOV", hint: "H.264" },
  { id: "mkv", label: "MKV", hint: "H.264" },
  { id: "webm", label: "WebM", hint: "VP9" },
  { id: "gif", label: "GIF", hint: "animado" },
  { id: "mp3", label: "MP3", hint: "solo audio" },
];

/** Frecuencias habituales (espejo de STANDARD_FPS en snip-core/src/probe.rs). */
const STANDARD_FPS: [number, number][] = [
  [24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48, 1], [50, 1], [60000, 1001], [60, 1],
  [72, 1], [90, 1], [100, 1], [120000, 1001], [120, 1], [144, 1], [165, 1], [200, 1], [240, 1],
];
export const MAX_FPS = 240;

/**
 * fps "razonables": la frecuencia estándar más cercana (±1,5 %), si no un
 * entero (tope 240). Igual que `standard_fps` de Rust: un proyecto con
 * 90000/1 o 1300000/21667 se ve y se exporta igual.
 */
export function standardFps(num: number, den: number): [number, number] {
  if (!(num > 0) || !(den > 0)) return [30, 1];
  const f = num / den;
  if (!Number.isFinite(f) || f < 1) return [30, 1];
  if (f > MAX_FPS * 1.015) return [MAX_FPS, 1];
  let best = STANDARD_FPS[0];
  let err = Infinity;
  for (const r of STANDARD_FPS) {
    const e = Math.abs(r[0] / r[1] - f) / f;
    if (e < err) [best, err] = [r, e];
  }
  if (err <= 0.015) return best;
  if (den === 1 && num <= MAX_FPS) return [num, 1];
  return [Math.min(MAX_FPS, Math.max(1, Math.round(f))), 1];
}

export function canvasFps(c: Canvas): number {
  const [n, d] = standardFps(c.fpsNum, c.fpsDen);
  return n / d;
}

/** fps como fracción para FFmpeg ("30000/1001"). */
export function canvasFpsExpr(c: Canvas): string {
  const [n, d] = standardFps(c.fpsNum, c.fpsDen);
  return d <= 1 ? String(n) : `${n}/${d}`;
}
