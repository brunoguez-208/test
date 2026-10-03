// Capa fina sobre las APIs de Tauri. Todo lo que habla con Rust pasa por acá,
// con tipos claros. En el navegador (tests de UI) se usan los mocks de Tauri.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { Clip, Cue, Loudness, MediaRef, Project } from "../project/model";
import type {
  Appearance,
  EncoderInfo,
  ExportJob,
  MediaInfo,
  OpenedProject,
  Palette,
  PlatformLimits,
  ProjectSummary,
  QueueItem,
  RecentFile,
} from "./types";

export const api = {
  takeLaunchFile: () => invoke<string | null>("take_launch_file"),
  showMainWindow: () => invoke<void>("show_main_window"),
  getAppearance: () => invoke<Appearance>("get_appearance"),
  openMedia: (path: string) => invoke<MediaInfo>("open_media", { path }),
  probeMedia: (path: string, id: string) => invoke<MediaRef>("probe_media", { path, id }),
  allowProjectMedia: (project: Project) => invoke<string[]>("allow_project_media", { project }),
  getKeyframes: (path: string) => invoke<number[]>("get_keyframes", { path }),
  requestThumbnails: (group: string, generation: number, items: { path: string; time: number }[], height: number) =>
    invoke<void>("request_thumbnails", { group, generation, items, height }),
  getWaveform: (path: string) => invoke<string>("get_waveform", { path }),
  analyzeAudio: (path: string, tracks: number) => invoke<{ rate: number; level: string; onset: string }>("analyze_audio", { path, tracks }),
  analyzeLoudness: (path: string, start: number, duration: number) => invoke<Loudness>("analyze_loudness", { path, start, duration }),
  createPreviewProxy: (path: string, duration: number, fps: number, tracks?: number[], transfer?: string | null) =>
    invoke<string>("create_preview_proxy", { path, duration, fps, tracks: tracks ?? null, transfer: transfer ?? null }),
  cancelProxy: () => invoke<void>("cancel_proxy"),
  prepareClip: (key: string, media: MediaRef, clip: Clip, canvasFps: string, canvasFpsValue: number) =>
    invoke<string>("prepare_clip", { key, media, clip, canvasFps, canvasFpsValue }),
  cancelPrepare: (key: string) => invoke<void>("cancel_prepare", { key }),
  getEncoder: () => invoke<EncoderInfo>("get_encoder"),
  platformLimits: () => invoke<PlatformLimits>("platform_limits"),
  defaultOutputPath: (job: ExportJob) => invoke<string>("default_output_path", { job }),
  enqueueExport: (job: ExportJob, title: string) => invoke<number>("enqueue_export", { job, title }),
  exportQueue: () => invoke<QueueItem[]>("export_queue"),
  cancelExportItem: (id: number) => invoke<void>("cancel_export_item", { id }),
  reorderExportItem: (id: number, index: number) => invoke<void>("reorder_export_item", { id, index }),
  removeExportItem: (id: number | null) => invoke<void>("remove_export_item", { id }),
  autosaveProject: (project: Project, file: string | null) => invoke<void>("autosave_project", { project, file }),
  saveProjectThumbnail: (id: string, jpegBase64: string) => invoke<void>("save_project_thumbnail", { id, jpegBase64 }),
  listUnfinished: () => invoke<ProjectSummary[]>("list_unfinished"),
  loadAutosave: (id: string) => invoke<Project>("load_autosave", { id }),
  discardProject: (id: string) => invoke<void>("discard_project", { id }),
  markProjectExported: (id: string) => invoke<void>("mark_project_exported", { id }),
  recentFiles: () => invoke<RecentFile[]>("recent_files"),
  addRecentFile: (path: string, kind: "video" | "project") => invoke<void>("add_recent_file", { path, kind }),
  removeRecentFile: (path: string) => invoke<void>("remove_recent_file", { path }),
  openSnip: (path: string) => invoke<OpenedProject>("open_snip", { path }),
  saveSnip: (path: string, project: Project) => invoke<string>("save_snip", { path, project }),
  savePng: (path: string, pngBase64: string) => invoke<string>("save_png", { path, pngBase64 }),
  writeRasterFiles: (id: string, files: { name: string; data: string }[]) => invoke<string>("write_raster_files", { id, files }),
  writeRasterList: (id: string, name: string, text: string) => invoke<string>("write_raster_list", { id, name, text }),
  discardRaster: (dir: string) => invoke<void>("discard_raster", { dir }),
  readSubtitles: (path: string) => invoke<string>("read_subtitles", { path }),
  writeSubtitles: (path: string, text: string) => invoke<string>("write_subtitles", { path, text }),
  modelStatus: () => invoke<ModelStatus>("model_status"),
  downloadModel: () => invoke<void>("download_model"),
  cancelModelDownload: () => invoke<void>("cancel_model_download"),
  transcribe: (project: Project, language: string | null) => invoke<Transcript>("transcribe", { project, language }),
  cancelTranscribe: () => invoke<void>("cancel_transcribe"),
  filesExist: (paths: string[]) => invoke<boolean[]>("files_exist", { paths }),
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
  revealLog: () => invoke<string>("reveal_log"),
  clipboardFiles: () => invoke<string[]>("clipboard_files"),
  packageProject: (project: Project, dest: string, zip: boolean) => invoke<PackageResult>("package_project", { project, dest, zip }),
  saveVersion: (project: Project, name: string | null, auto: boolean, thumb: string | null) => invoke<VersionInfo>("save_version", { project, name, auto, thumb }),
  listVersions: (projectId: string) => invoke<VersionInfo[]>("list_versions", { projectId }),
  loadVersion: (projectId: string, versionId: string) => invoke<Project>("load_version", { projectId, versionId }),
  saveTemplate: (name: string, summary: string, data: unknown, thumb: string | null) => invoke<TemplateInfo>("save_template", { name, summary, data, thumb }),
  listTemplates: () => invoke<TemplateInfo[]>("list_templates"),
  loadTemplate: (id: string) => invoke<unknown>("load_template", { id }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  saveClipboardImage: (data: string, ext: string) => invoke<string>("save_clipboard_image", { data, ext }),
  openInDefaultApp: (path: string) => invoke<void>("open_in_default_app", { path }),
};

export interface ThumbEvent {
  group: string;
  generation: number;
  index: number;
  dataUrl: string;
}

export const events = {
  onThumbnail: (cb: (e: ThumbEvent) => void) => listen<ThumbEvent>("thumbnail", (e) => cb(e.payload)),
  onPackageProgress: (cb: (p: { percent: number }) => void) => listen<{ percent: number }>("package-progress", (e) => cb(e.payload)),
  onProxyProgress: (cb: (p: { path: string; percent: number }) => void) =>
    listen<{ path: string; percent: number }>("proxy-progress", (e) => cb(e.payload)),
  onHeavyProgress: (cb: (p: { key: string; percent: number }) => void) =>
    listen<{ key: string; percent: number }>("heavy-progress", (e) => cb(e.payload)),
  onQueue: (cb: (items: QueueItem[]) => void) => listen<{ items: QueueItem[] }>("queue-updated", (e) => cb(e.payload.items)),
  onOpenFile: (cb: (path: string) => void) => listen<string>("open-file", (e) => cb(e.payload)),
  onThemeChanged: (cb: (p: Palette) => void) => listen<Palette>("theme-changed", (e) => cb(e.payload)),
  onModelProgress: (cb: (p: { received: number; total: number | null }) => void) =>
    listen<{ received: number; total: number | null }>("model-progress", (e) => cb(e.payload)),
  onTranscribeProgress: (cb: (p: { stage: "audio" | "transcribing"; percent: number }) => void) =>
    listen<{ stage: "audio" | "transcribing"; percent: number }>("transcribe-progress", (e) => cb(e.payload)),
};

export interface ModelStatus {
  present: boolean;
  downloadMb: number;
  engine: boolean;
}

export interface Transcript {
  cues: Cue[];
  language: string | null;
  gpu: boolean;
}

export function mediaSrc(path: string): string {
  return convertFileSrc(path);
}

/** Posición en px CSS de la ventana. */
export interface DragPos {
  x: number;
  y: number;
}
export type DragState =
  | { type: "enter"; paths: string[]; pos?: DragPos }
  | { type: "over"; pos?: DragPos }
  | { type: "drop"; paths: string[]; pos?: DragPos }
  | { type: "leave" };

/** Drag & drop nativo de la ventana (Tauri da las rutas reales de los archivos). */
export function onFileDrag(cb: (s: DragState) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    // Tauri da la posición en píxeles físicos.
    const pos = (q: { x: number; y: number } | undefined): DragPos | undefined =>
      q ? { x: q.x / (window.devicePixelRatio || 1), y: q.y / (window.devicePixelRatio || 1) } : undefined;
    switch (p.type) {
      case "enter":
        cb({ type: "enter", paths: p.paths, pos: pos(p.position) });
        break;
      case "over":
        cb({ type: "over", pos: pos(p.position) });
        break;
      case "drop":
        cb({ type: "drop", paths: p.paths, pos: pos(p.position) });
        break;
      default:
        cb({ type: "leave" });
    }
  });
}

export function onWindowFocus(cb: (focused: boolean) => void): Promise<UnlistenFn> {
  return getCurrentWindow().onFocusChanged((e) => cb(e.payload));
}

export const VIDEO_FILTER = { name: "Video", extensions: ["mp4", "mov", "mkv", "webm"] };
export const PROJECT_FILTER = { name: "Proyecto de Snip", extensions: ["snip"] };
export const AUDIO_FILTER = { name: "Audio", extensions: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "mp4", "mov", "mkv", "webm"] };
export const IMAGE_FILTER = { name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp"] };
export const SRT_FILTER = { name: "Subtítulos", extensions: ["srt"] };

export async function pickFiles(title: string, filters: { name: string; extensions: string[] }[], multiple = false): Promise<string[]> {
  const r = await openDialog({ title, multiple, directory: false, filters });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function pickFolder(title: string): Promise<string | null> {
  const r = await openDialog({ title, multiple: false, directory: true });
  return typeof r === "string" ? r : null;
}

export async function pickSavePath(title: string, defaultPath: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const r = await saveDialog({ title, defaultPath, filters });
  return r ?? null;
}

/** ¿Estamos dentro de Tauri (o con los mocks instalados)? */
export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface PackageResult {
  path: string;
  files: number;
  bytes: number;
}

export interface VersionInfo {
  id: string;
  projectId: string;
  name: string | null;
  createdAt: number;
  auto: boolean;
  duration: number;
  clipCount: number;
  thumbnail: string | null;
}

export interface TemplateInfo {
  id: string;
  name: string;
  createdAt: number;
  thumbnail: string | null;
  summary: string;
}
