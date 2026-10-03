// Mock del backend de Tauri para correr la UI en un navegador (tests de
// Playwright y desarrollo sin Rust). Simula los mismos commands y eventos.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { AppError, EncoderInfo, ExportOutcome, ExportRequest, MediaInfo } from "../lib/types";

const params = new URLSearchParams(location.search);

const SAMPLE: MediaInfo = {
  path: "C:\\Users\\Bruno\\Videos\\Clip de prueba.mp4",
  duration: 12,
  width: 1920,
  height: 1080,
  codedWidth: 1920,
  codedHeight: 1080,
  rotation: 0,
  fps: 30,
  fpsNum: 30,
  fpsDen: 1,
  frameCount: 360,
  videoCodec: params.get("codec") ?? "h264",
  pixFmt: "yuv420p",
  hasAudio: true,
  audioCodec: "aac",
  sizeBytes: 48_000_000,
  bitRate: 32_000_000,
};

const exportDelayMs = Number(params.get("exportMs") ?? 1600);
let pendingExport: { reject: (e: AppError) => void; timer: number } | null = null;
let exportCount = 0;

declare global {
  interface Window {
    __snipMock: {
      emit: (event: string, payload: unknown) => Promise<void>;
      dragEnter: (paths: string[]) => Promise<void>;
      drop: (paths: string[]) => Promise<void>;
      dragLeave: () => Promise<void>;
      calls: { cmd: string; args: unknown }[];
      lastExport: ExportRequest | null;
      nextExportError: AppError | null;
      dialogOpenPath: string | null;
    };
  }
}

/** Miniatura sintética: una "escena" con degradé distinto por índice. */
function fakeThumb(i: number, total: number): string {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 90;
  const g = c.getContext("2d")!;
  const hue = (200 + (i / total) * 160) % 360;
  const grad = g.createLinearGradient(0, 0, 160, 90);
  grad.addColorStop(0, `hsl(${hue} 80% 70%)`);
  grad.addColorStop(1, `hsl(${(hue + 50) % 360} 70% 35%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 160, 90);
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath();
  g.ellipse(80, 95, 70, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.beginPath();
  g.arc(118, 24, 10, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL("image/jpeg", 0.8);
}

export function installTauriMock() {
  mockWindows("main");
  const calls: { cmd: string; args: unknown }[] = [];
  const state = {
    emit: (event: string, payload: unknown) => emit(event, payload),
    dragEnter: (paths: string[]) => emit("tauri://drag-enter", { paths, position: { x: 400, y: 300 } }),
    drop: (paths: string[]) => emit("tauri://drag-drop", { paths, position: { x: 400, y: 300 } }),
    dragLeave: () => emit("tauri://drag-leave", null),
    calls,
    lastExport: null as ExportRequest | null,
    nextExportError: null as AppError | null,
    dialogOpenPath: SAMPLE.path as string | null,
  };
  window.__snipMock = state;

  // convertFileSrc → fixture servido por Vite (WebM porque Chromium de test no trae H.264).
  (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__.convertFileSrc = (p: string) =>
    p.includes("proxy") ? "/fixtures/sample.webm?proxy" : params.get("broken") ? "/fixtures/missing.webm" : "/fixtures/sample.webm";

  const palette = (dark: boolean) => ({
    dark,
    accent: params.get("accent") ?? "#0078D4",
    light1: "#0093F9",
    light2: params.get("accentLight2") ?? "#60CDFF",
    light3: "#99EBFF",
    dark1: params.get("accentDark1") ?? "#005FB8",
    dark2: "#004A83",
    dark3: "#003A6A",
  });

  mockIPC(
    async (cmd, args) => {
      calls.push({ cmd, args });
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "take_launch_file":
          return params.get("file");
        case "show_main_window":
          return null;
        case "get_appearance": {
          const theme = params.get("theme");
          const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
          return { material: "none", palette: palette(dark) };
        }
        case "open_media": {
          const path = String(a.path);
          if (!/\.mp4$/i.test(path)) throw { kind: "notMp4", message: "Por ahora solo MP4." } satisfies AppError;
          if (/corrupto/i.test(path)) throw { kind: "corrupt", message: "No pudimos leer el video. Puede que el archivo esté dañado o incompleto." } satisfies AppError;
          await new Promise((r) => setTimeout(r, 120));
          return { ...SAMPLE, path };
        }
        case "get_keyframes":
          return [0, 2, 4, 6, 8, 10];
        case "start_thumbnails": {
          const total = Number(a.count);
          const gen = Number(a.generation);
          const delay = Number(params.get("thumbMs") ?? 60);
          for (let i = 0; i < total; i++) {
            setTimeout(() => void emit("thumbnail", { generation: gen, index: i, total, dataUrl: fakeThumb(i, total) }), 150 + i * delay);
          }
          return null;
        }
        case "create_preview_proxy": {
          for (let p = 0; p <= 100; p += 20) {
            await new Promise((r) => setTimeout(r, 80));
            await emit("proxy-progress", { path: a.path, percent: p });
          }
          return "C:\\Users\\Bruno\\AppData\\Local\\Snip\\proxies\\proxy.mp4";
        }
        case "cancel_proxy":
          return null;
        case "get_encoder":
          return { id: "nvenc", label: "NVIDIA NVENC", hardware: true } satisfies EncoderInfo;
        case "default_output_path": {
          const p = String(a.path).replace(/\.mp4$/i, "");
          return exportCount === 0 ? `${p}_snip.mp4` : `${p}_snip (${exportCount + 1}).mp4`;
        }
        case "export_video": {
          const req = a.request as ExportRequest;
          state.lastExport = req;
          if (state.nextExportError) {
            const e = state.nextExportError;
            state.nextExportError = null;
            await new Promise((r) => setTimeout(r, 300));
            throw e;
          }
          return await new Promise<ExportOutcome>((resolve, reject) => {
            const started = performance.now();
            const tick = () => {
              const pct = Math.min(100, ((performance.now() - started) / exportDelayMs) * 100);
              void emit("export-progress", { percent: Math.min(99.5, pct), speed: 3.4, etaSecs: ((100 - pct) / 100) * (exportDelayMs / 1000), outTime: 0 });
              if (pct >= 100) {
                pendingExport = null;
                const base = req.input.replace(/\.mp4$/i, "");
                const output = req.output ?? (exportCount === 0 ? `${base}_snip.mp4` : `${base}_snip (${exportCount + 1}).mp4`);
                exportCount++;
                resolve({
                  output,
                  mode: req.mode,
                  encoder: req.mode === "precise" ? "nvenc" : null,
                  fellBack: false,
                  width: 1920,
                  height: 1080,
                  duration: req.end - req.start,
                  sizeBytes: 21_450_000,
                  elapsedSecs: exportDelayMs / 1000,
                });
                return;
              }
              pendingExport = { reject, timer: window.setTimeout(tick, 100) };
            };
            tick();
          });
        }
        case "cancel_export":
          if (pendingExport) {
            window.clearTimeout(pendingExport.timer);
            pendingExport.reject({ kind: "cancelled", message: "Exportación cancelada." });
            pendingExport = null;
          }
          return null;
        case "reveal_in_folder":
        case "open_in_default_app":
          return null;
        case "plugin:dialog|open":
          return state.dialogOpenPath;
        case "plugin:dialog|save":
          return "C:\\Users\\Bruno\\Desktop\\recorte final.mp4";
        default:
          // Llamadas de ventana (onFocusChanged, etc.)
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
