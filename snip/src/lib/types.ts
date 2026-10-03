import type { ExportSettings, OutputFormat, Project } from "../project/model";

// Tipos compartidos con Rust (mismos nombres serde, camelCase).

export interface MediaInfo {
  path: string;
  duration: number;
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  rotation: number;
  fps: number;
  fpsNum: number;
  fpsDen: number;
  frameCount: number;
  videoCodec: string;
  pixFmt?: string | null;
  hasAudio: boolean;
  audioCodec?: string | null;
  sizeBytes?: number | null;
  bitRate?: number | null;
}

export type ExportMode = "fast" | "precise";

export type ResolutionChoice =
  | { kind: "original" }
  | { kind: "p2160" }
  | { kind: "p1440" }
  | { kind: "p1080" }
  | { kind: "p720" }
  | { kind: "custom"; width: number };

export type ResolutionKind = ResolutionChoice["kind"];

export type FpsChoice = "original" | "fps120" | "fps60" | "fps30" | "fps24";

export interface ExportRequest {
  input: string;
  output?: string | null;
  start: number;
  end: number;
  mode: ExportMode;
  resolution: ResolutionChoice;
  fps: FpsChoice;
  frameExact: boolean;
  allowUpscale: boolean;
  allowFpsIncrease: boolean;
}

export type EncoderId = "nvenc" | "qsv" | "amf" | "libx264";

export interface EncoderInfo {
  id: EncoderId;
  label: string;
  hardware: boolean;
}

export interface ExportOutcome {
  output: string;
  mode: ExportMode;
  encoder: EncoderId | null;
  fellBack: boolean;
  width: number;
  height: number;
  duration: number;
  sizeBytes: number;
  elapsedSecs: number;
}

export interface ProgressReport {
  percent: number;
  speed: number | null;
  etaSecs: number | null;
  outTime: number;
}

export type ErrorKind =
  | "unsupportedFormat"
  | "badProject"
  | "unsupported"
  | "noAudio"
  | "mediaMissing"
  | "network"
  | "notMp4"
  | "notFound"
  | "noVideo"
  | "corrupt"
  | "diskFull"
  | "permissionDenied"
  | "encoderFailed"
  | "cancelled"
  | "sameAsInput"
  | "invalidRange"
  | "upscaleNotConfirmed"
  | "fpsIncreaseNotConfirmed"
  | "ffmpegMissing"
  | "busy"
  | "unknown";

export interface AppError {
  kind: ErrorKind;
  message: string;
  detail?: string | null;
}

export interface Palette {
  dark: boolean;
  accent: string;
  light1: string;
  light2: string;
  light3: string;
  dark1: string;
  dark2: string;
  dark3: string;
}

export interface Appearance {
  material: "mica" | "acrylic" | "none";
  palette: Palette;
}

export interface ThumbEvent {
  generation: number;
  index: number;
  total: number;
  dataUrl: string;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/** Normaliza cualquier error a un AppError con mensaje en español. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const detail = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  return { kind: "unknown", message: "Algo salió mal al procesar el video.", detail };
}

// ------------------------------- Snip 2 -------------------------------


export interface ExportJob {
  project: Project;
  settings?: ExportSettings | null;
  window?: { start: number; end: number } | null;
  output?: string | null;
  label?: string | null;
  saveProject?: boolean;
  raster?: RasterSpec | null;
}

/** Capas rasterizadas ya escritas en disco (rutas a listas ffconcat). */
export interface RasterSpec {
  dir?: string | null;
  decor?: string | null;
  masks?: Record<string, string>;
  pips?: Record<string, { mask: string; shadow?: string | null; width: number; height: number; x: number; y: number; shadowX?: number; shadowY?: number }>;
}

export type Stage = "preparing" | "copying" | "encoding" | "firstPass" | "secondPass" | "retrying";

export interface JobProgress {
  percent: number;
  speed: number | null;
  etaSecs: number | null;
  stage: Stage;
}

export interface ProjectOutcome {
  output: string;
  projectFile: string | null;
  mode: "fast" | "precise";
  format: OutputFormat;
  encoder: EncoderId | null;
  fellBack: boolean;
  width: number;
  height: number;
  duration: number;
  sizeBytes: number;
  elapsedSecs: number;
  sizeRetries: number;
}

export type ItemStatus =
  | { state: "queued" }
  | { state: "running"; progress: JobProgress | null }
  | { state: "done"; outcome: ProjectOutcome }
  | { state: "failed"; error: AppError }
  | { state: "cancelled" };

export interface QueueItem {
  id: number;
  title: string;
  projectId: string;
  status: ItemStatus;
}

export interface ProjectSummary {
  id: string;
  name: string;
  duration: number;
  updatedAt: number;
  clipCount: number;
  thumbnail: string | null;
  file: string | null;
}

export interface RecentFile {
  path: string;
  kind: "video" | "project";
  openedAt: number;
}

export interface PlatformPreset {
  id: string;
  group: string;
  label: string;
  tier: string | null;
  megabytes: number;
}

export interface PlatformLimits {
  verifiedAt: string;
  targetRatio: number;
  presets: PlatformPreset[];
}

export interface OpenedProject {
  project: Project;
  missing: string[];
}
