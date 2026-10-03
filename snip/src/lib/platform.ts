// Capa fina sobre las APIs de Tauri. Todo lo que habla con Rust pasa por acá,
// con tipos claros. En el navegador (tests de UI) se usan los mocks de Tauri.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { Clip, Loudness, MediaRef, Project } from "../project/model";
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
  analyzeLoudness: (path: string, start: number, duration: number) => invoke<Loudness>("analyze_loudness", { path, start, duration }),
  createPreviewProxy: (path: string, duration: number, fps: number) => invoke<string>("create_preview_proxy", { path, duration, fps }),
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
  filesExist: (paths: string[]) => invoke<boolean[]>("files_exist", { paths }),
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
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
  onProxyProgress: (cb: (p: { path: string; percent: number }) => void) =>
    listen<{ path: string; percent: number }>("proxy-progress", (e) => cb(e.payload)),
  onHeavyProgress: (cb: (p: { key: string; percent: number }) => void) =>
    listen<{ key: string; percent: number }>("heavy-progress", (e) => cb(e.payload)),
  onQueue: (cb: (items: QueueItem[]) => void) => listen<{ items: QueueItem[] }>("queue-updated", (e) => cb(e.payload.items)),
  onOpenFile: (cb: (path: string) => void) => listen<string>("open-file", (e) => cb(e.payload)),
  onThemeChanged: (cb: (p: Palette) => void) => listen<Palette>("theme-changed", (e) => cb(e.payload)),
};

export function mediaSrc(path: string): string {
  return convertFileSrc(path);
}

export type DragState =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

/** Drag & drop nativo de la ventana (Tauri da las rutas reales de los archivos). */
export function onFileDrag(cb: (s: DragState) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    switch (p.type) {
      case "enter":
        cb({ type: "enter", paths: p.paths });
        break;
      case "over":
        cb({ type: "over" });
        break;
      case "drop":
        cb({ type: "drop", paths: p.paths });
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

export async function pickFiles(title: string, filters: { name: string; extensions: string[] }[], multiple = false): Promise<string[]> {
  const r = await openDialog({ title, multiple, directory: false, filters });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function pickSavePath(title: string, defaultPath: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const r = await saveDialog({ title, defaultPath, filters });
  return r ?? null;
}

/** ¿Estamos dentro de Tauri (o con los mocks instalados)? */
export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
