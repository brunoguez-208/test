// Capa fina sobre las APIs de Tauri. Todo lo que habla con Rust pasa por acá,
// con tipos claros. En el navegador (tests de UI) se usan los mocks de Tauri.

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type {
  Appearance,
  EncoderInfo,
  ExportOutcome,
  ExportRequest,
  MediaInfo,
  Palette,
  ProgressReport,
  ThumbEvent,
} from "./types";

export const api = {
  takeLaunchFile: () => invoke<string | null>("take_launch_file"),
  showMainWindow: () => invoke<void>("show_main_window"),
  getAppearance: () => invoke<Appearance>("get_appearance"),
  openMedia: (path: string) => invoke<MediaInfo>("open_media", { path }),
  getKeyframes: (path: string) => invoke<number[]>("get_keyframes", { path }),
  startThumbnails: (path: string, duration: number, count: number, height: number, generation: number) =>
    invoke<void>("start_thumbnails", { path, duration, count, height, generation }),
  createPreviewProxy: (path: string, duration: number, fps: number) =>
    invoke<string>("create_preview_proxy", { path, duration, fps }),
  cancelProxy: () => invoke<void>("cancel_proxy"),
  getEncoder: () => invoke<EncoderInfo>("get_encoder"),
  defaultOutputPath: (path: string) => invoke<string>("default_output_path", { path }),
  exportVideo: (request: ExportRequest) => invoke<ExportOutcome>("export_video", { request }),
  cancelExport: () => invoke<void>("cancel_export"),
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
  openInDefaultApp: (path: string) => invoke<void>("open_in_default_app", { path }),
};

export const events = {
  onThumbnail: (cb: (e: ThumbEvent) => void) => listen<ThumbEvent>("thumbnail", (e) => cb(e.payload)),
  onExportProgress: (cb: (p: ProgressReport) => void) =>
    listen<ProgressReport>("export-progress", (e) => cb(e.payload)),
  onProxyProgress: (cb: (p: { path: string; percent: number }) => void) =>
    listen<{ path: string; percent: number }>("proxy-progress", (e) => cb(e.payload)),
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

export async function pickVideo(): Promise<string | null> {
  const r = await openDialog({
    title: "Abrir video",
    multiple: false,
    directory: false,
    filters: [{ name: "Video MP4", extensions: ["mp4"] }],
  });
  return typeof r === "string" ? r : null;
}

export async function pickSavePath(defaultPath: string): Promise<string | null> {
  const r = await saveDialog({
    title: "Guardar como",
    defaultPath,
    filters: [{ name: "Video MP4", extensions: ["mp4"] }],
  });
  return r ?? null;
}

/** ¿Estamos dentro de Tauri (o con los mocks instalados)? */
export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
