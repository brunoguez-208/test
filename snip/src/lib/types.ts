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
