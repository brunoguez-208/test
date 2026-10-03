// Mock del backend de Tauri para correr la UI en un navegador (tests de
// Playwright y desarrollo sin Rust). Simula los mismos commands y eventos.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import limits from "../../src-tauri/core/config/platform_limits.json";
import type { AppError, ExportJob, ProjectOutcome, ProjectSummary, QueueItem, RecentFile } from "../lib/types";
import type { MediaRef, Project } from "../project/model";
import { totalDuration } from "../project/timeline";

const params = new URLSearchParams(location.search);

function ext(p: string) {
  return (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? "").toLowerCase();
}

function stemOf(p: string) {
  const b = p.split(/[\\/]/).pop() ?? p;
  return b.replace(/\.[^.]+$/, "");
}

function mediaFor(path: string, id: string): MediaRef {
  const e = ext(path);
  if (["mp3", "m4a", "wav", "ogg", "flac", "opus", "aac"].includes(e)) {
    return { id, path, kind: "audio", duration: 60, width: 0, height: 0, fps: 30, fpsNum: 30, fpsDen: 1, hasAudio: true, videoCodec: null, audioCodec: "mp3", rotation: 0 };
  }
  if (["png", "jpg", "jpeg", "webp"].includes(e)) {
    return { id, path, kind: "image", duration: 0, width: 512, height: 512, fps: 30, fpsNum: 30, fpsDen: 1, hasAudio: false, videoCodec: null, audioCodec: null, rotation: 0 };
  }
  const vertical = /vertical/i.test(path);
  const dur = Number(/(\d+)s\b/.exec(path)?.[1] ?? 12);
  return {
    id,
    path,
    kind: "video",
    duration: dur,
    width: vertical ? 1080 : 1920,
    height: vertical ? 1920 : 1080,
    fps: 30,
    fpsNum: 30,
    fpsDen: 1,
    hasAudio: !/mudo/i.test(path),
    videoCodec: params.get("codec") ?? (/hevc/i.test(path) ? "hevc" : "h264"),
    audioCodec: /mudo/i.test(path) ? null : "aac",
    rotation: 0,
    sizeBytes: 48_000_000,
  };
}

const thumbCache = new Map<number, string>();
/** Miniatura sintética: una "escena" con degradé distinto según el tiempo (cacheada). */
function fakeThumb(seed: number): string {
  const k = ((seed % 24) + 24) % 24;
  const hit = thumbCache.get(k);
  if (hit) return hit;
  const url = drawThumb(k);
  thumbCache.set(k, url);
  return url;
}

/** SVG en vez de canvas → JPEG: armar un string es instantáneo (codificar en SwiftShader tarda decenas de ms). */
function drawThumb(seed: number): string {
  const hue = (200 + seed * 37) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},80%,70%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},70%,35%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="160" height="90" fill="url(#g)"/>` +
    `<ellipse cx="80" cy="95" rx="70" ry="34" fill="rgba(0,0,0,0.22)"/>` +
    `<circle cx="118" cy="24" r="10" fill="rgba(255,255,255,0.6)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function fakePeaks(seconds: number): string {
  const n = Math.max(1, Math.round(seconds * 100));
  let s = "";
  for (let i = 0; i < n; i++) {
    const v = 90 + 70 * Math.abs(Math.sin(i / 23)) * (0.6 + 0.4 * Math.sin(i / 7));
    s += String.fromCharCode(Math.max(0, Math.min(255, Math.round(v))));
  }
  return btoa(s);
}

declare global {
  interface Window {
    __snipMock: MockState;
  }
}

export interface MockState {
  emit: (event: string, payload: unknown) => Promise<void>;
  dragEnter: (paths: string[]) => Promise<void>;
  drop: (paths: string[]) => Promise<void>;
  dragLeave: () => Promise<void>;
  calls: { cmd: string; args: unknown }[];
  jobs: ExportJob[];
  nextExportError: AppError | null;
  dialogOpenPaths: string[] | null;
  dialogSavePath: string | null;
  autosaves: Record<string, { project: Project; file: string | null }>;
  snips: Record<string, Project>;
  recent: RecentFile[];
  queue: QueueItem[];
  exportMs: number;
  /** Pausa la cola (para testear la espera y el reordenamiento). */
  holdQueue: boolean;
}

function seedProject(name: string, paths: string[], updatedAt: number): Project {
  const media = paths.map((p, i) => mediaFor(p, `m${i}`));
  return {
    version: 1,
    id: `seed${Math.abs(hash(name))}`,
    name,
    createdAt: updatedAt,
    updatedAt,
    exportedAt: null,
    media,
    clips: media.map((m, i) => ({
      id: `c${i}`,
      mediaId: m.id,
      kind: "video",
      inPoint: 0,
      outPoint: Math.min(6, m.duration),
      speed: 1,
      smoothSlowmo: false,
      reverse: false,
      loopMode: "none",
      loopCount: 1,
      freezeDuration: 0,
      audio: { volume: 1, muted: false, removed: false, fadeIn: 0, fadeOut: 0, normalize: null, denoise: false },
      video: { crop: null, rotate: 0, flipH: false, flipV: false, color: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, exposure: 0 }, look: null, stabilize: null, sharpen: 0, denoise: 0, zoom: [] },
      transition: null,
    })),
    overlays: [],
    music: [],
    markers: [{ id: "k1", time: 2, name: "Gol" }],
    ranges: [],
    subtitles: { cues: [], style: { fontFamily: "Segoe UI Variable Display", size: 0.055, weight: 700, color: "#FFFFFF", highlight: "#FFD60A", stroke: { color: "#000000", width: 0.12 }, background: null, y: 0.86, uppercase: false }, wordByWord: false, language: null },
    fades: { fadeIn: 0, fadeOut: 0 },
    canvas: { width: 1920, height: 1080, fpsNum: 30, fpsDen: 1, auto: true },
    view: { playhead: 4.5, zoom: 0, scroll: 0 },
    export: { format: "mp4", mode: "auto", resolution: { kind: "original" }, fps: "original", allowUpscale: false, allowFpsIncrease: false, sizeTarget: null, gif: { fps: 15, width: 480 } },
  };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function installTauriMock() {
  mockWindows("main");
  const calls: { cmd: string; args: unknown }[] = [];
  const now = Date.now();
  const state: MockState = {
    emit: (event, payload) => emit(event, payload),
    dragEnter: (paths) => emit("tauri://drag-enter", { paths, position: { x: 400, y: 300 } }),
    drop: (paths) => emit("tauri://drag-drop", { paths, position: { x: 400, y: 300 } }),
    dragLeave: () => emit("tauri://drag-leave", null),
    calls,
    jobs: [],
    nextExportError: null,
    dialogOpenPaths: ["C:\\Users\\Bruno\\Videos\\Clip de prueba.mp4"],
    dialogSavePath: null,
    autosaves: {},
    snips: {},
    recent: [],
    queue: [],
    exportMs: Number(params.get("exportMs") ?? 1500),
    holdQueue: false,
  };
  if (params.get("seed") === "1") {
    const a = seedProject("Vacaciones en la costa", ["C:\\Users\\Bruno\\Videos\\playa.mp4", "C:\\Users\\Bruno\\Videos\\atardecer.mov"], now - 5 * 60_000);
    const b = seedProject("Gol del domingo", ["C:\\Users\\Bruno\\Videos\\partido.mkv"], now - 26 * 3600_000);
    const c = seedProject("Receta", ["C:\\Users\\Bruno\\Videos\\movido\\cocina.mp4"], now - 3 * 86400_000);
    for (const p of [a, b, c]) state.autosaves[p.id] = { project: p, file: null };
    state.recent = [
      { path: "C:\\Users\\Bruno\\Videos\\partido.mkv", kind: "video", openedAt: now - 3600_000 },
      { path: "C:\\Users\\Bruno\\Documents\\Gol del domingo.snip", kind: "project", openedAt: now - 2 * 86400_000 },
    ];
    state.snips["C:\\Users\\Bruno\\Documents\\Gol del domingo.snip"] = b;
  }
  window.__snipMock = state;

  // convertFileSrc → fixtures servidos por Vite (WebM porque el Chromium de test no trae H.264).
  (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__.convertFileSrc = (p: string) => {
    if (/\.(mp3|m4a|wav|ogg|flac|opus)$/i.test(p)) return "/fixtures/tone.webm";
    if (/\.(png|jpg|jpeg|webp)$/i.test(p)) return "/fixtures/thumb.png";
    if (params.get("broken") && !/proxy/.test(p)) return "/fixtures/missing.webm";
    return `/fixtures/sample.webm?${encodeURIComponent(p.includes("heavy") ? "heavy" : p.includes("proxy") ? "proxy" : "src")}`;
  };

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

  const emitQueue = () => void emit("queue-updated", { items: structuredClone(state.queue) });
  let nextId = 1;
  let running = false;
  const pump = () => {
    if (running || state.holdQueue) return;
    const it = state.queue.find((q) => q.status.state === "queued");
    if (!it) return;
    running = true;
    it.status = { state: "running", progress: null };
    emitQueue();
    const job = state.jobs[it.id - 1];
    const started = performance.now();
    const tick = () => {
      const cur = state.queue.find((q) => q.id === it.id);
      if (!cur || cur.status.state !== "running") {
        running = false;
        pump();
        return;
      }
      const pct = Math.min(100, ((performance.now() - started) / state.exportMs) * 100);
      if (pct < 100) {
        cur.status = { state: "running", progress: { percent: pct, speed: 3.2, etaSecs: ((100 - pct) / 100) * (state.exportMs / 1000), stage: "encoding" } };
        emitQueue();
        window.setTimeout(tick, 100);
        return;
      }
      if (state.nextExportError) {
        cur.status = { state: "failed", error: state.nextExportError };
        state.nextExportError = null;
      } else {
        const fmt = job.settings?.format ?? job.project.export.format;
        const base = job.output ?? `C:\\Users\\Bruno\\Videos\\${job.project.name || "video"}_snip${job.label ? ` - ${job.label}` : ""}.${fmt}`;
        const outcome: ProjectOutcome = {
          output: base,
          projectFile: job.saveProject === false || job.window ? null : base.replace(/\.[^.]+$/, ".snip"),
          mode: "precise",
          format: fmt,
          encoder: "nvenc",
          fellBack: false,
          width: job.project.canvas.width,
          height: job.project.canvas.height,
          duration: job.window ? job.window.end - job.window.start : totalDuration(job.project),
          sizeBytes: 21_450_000,
          elapsedSecs: state.exportMs / 1000,
          sizeRetries: 0,
        };
        cur.status = { state: "done", outcome };
        if (outcome.projectFile) state.snips[outcome.projectFile] = { ...job.project, exportedAt: Date.now() };
        if (!job.window && state.autosaves[job.project.id]) state.autosaves[job.project.id].project.exportedAt = Date.now();
      }
      emitQueue();
      running = false;
      pump();
    };
    window.setTimeout(tick, 60);
  };

  // La cola arranca sola cuando se libera (holdQueue = false).
  window.setInterval(pump, 100);

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
        case "probe_media": {
          const path = String(a.path);
          if (!["mp4", "mov", "mkv", "webm", "mp3", "m4a", "wav", "ogg", "flac", "png", "jpg", "jpeg", "webp"].includes(ext(path)))
            throw { kind: "unsupportedFormat", message: "Ese formato no se puede abrir. Snip abre MP4, MOV, MKV y WebM." } satisfies AppError;
          if (/corrupto/i.test(path)) throw { kind: "corrupt", message: "No pudimos leer el video. Puede que el archivo esté dañado o incompleto." } satisfies AppError;
          await new Promise((r) => setTimeout(r, 60));
          return mediaFor(path, String(a.id));
        }
        case "allow_project_media":
          return ((a.project as Project).media ?? []).filter((m) => /movido/i.test(m.path)).map((m) => m.id);
        case "get_keyframes":
          return [0, 2, 4, 6, 8, 10];
        case "request_thumbnails": {
          const items = a.items as { path: string; time: number }[];
          const gen = Number(a.generation);
          const delay = Number(params.get("thumbMs") ?? 15);
          items.forEach((it, i) => {
            setTimeout(() => void emit("thumbnail", { group: a.group, generation: gen, index: i, dataUrl: fakeThumb(Math.floor(it.time) + hash(it.path)) }), 40 + i * delay);
          });
          return null;
        }
        case "get_waveform":
          return fakePeaks(/\.(mp3|m4a|wav)/i.test(String(a.path)) ? 60 : 12);
        case "analyze_loudness":
          return { inputI: -23.4, inputTp: -6.1, inputLra: 5.2, inputThresh: -33.9, targetOffset: 0.1 };
        case "create_preview_proxy": {
          for (let p = 0; p <= 100; p += 20) {
            await new Promise((r) => setTimeout(r, 60));
            await emit("proxy-progress", { path: a.path, percent: p });
          }
          return "C:\\Users\\Bruno\\AppData\\Local\\Snip\\proxies\\proxy.mp4";
        }
        case "prepare_clip": {
          const key = String(a.key);
          const ms = Number(params.get("heavyMs") ?? 600);
          for (let p = 0; p <= 100; p += 10) {
            await new Promise((r) => setTimeout(r, ms / 10));
            await emit("heavy-progress", { key, percent: p });
          }
          return `C:\\Users\\Bruno\\AppData\\Local\\Snip\\heavy\\${key}.mp4`;
        }
        case "cancel_proxy":
        case "cancel_prepare":
          return null;
        case "get_encoder":
          return { id: "nvenc", label: "NVIDIA NVENC", hardware: true };
        case "platform_limits":
          return limits;
        case "default_output_path": {
          const job = a.job as ExportJob;
          const first = job.project.media.find((m) => m.id === job.project.clips[0]?.mediaId);
          const dir = first ? first.path.replace(/[\\/][^\\/]*$/, "") : "C:\\Users\\Bruno\\Videos";
          const fmt = job.settings?.format ?? job.project.export.format;
          const n = state.queue.filter((q) => q.status.state === "done" && q.projectId === job.project.id).length;
          return `${dir}\\${job.project.name || "video"}_snip${n ? ` (${n + 1})` : ""}.${fmt}`;
        }
        case "enqueue_export": {
          const job = a.job as ExportJob;
          state.jobs.push(job);
          const id = nextId++;
          state.queue.push({ id, title: String(a.title), projectId: job.project.id, status: { state: "queued" } });
          emitQueue();
          window.setTimeout(pump, 30);
          return id;
        }
        case "export_queue":
          return structuredClone(state.queue);
        case "cancel_export_item": {
          const it = state.queue.find((q) => q.id === Number(a.id));
          if (it && (it.status.state === "queued" || it.status.state === "running")) it.status = { state: "cancelled" };
          emitQueue();
          return null;
        }
        case "reorder_export_item": {
          const id = Number(a.id);
          const from = state.queue.findIndex((q) => q.id === id && q.status.state === "queued");
          if (from >= 0) {
            const [it] = state.queue.splice(from, 1);
            const queued = state.queue.map((q, i) => [q, i] as const).filter(([q]) => q.status.state === "queued");
            const at = Number(a.index) >= queued.length ? (queued.at(-1)?.[1] ?? state.queue.length - 1) + 1 : queued[Number(a.index)][1];
            state.queue.splice(at, 0, it);
            emitQueue();
          }
          return null;
        }
        case "remove_export_item": {
          const id = a.id as number | null;
          state.queue = state.queue.filter((q) => !(["done", "failed", "cancelled"].includes(q.status.state) && (id === null || q.id === id)));
          emitQueue();
          return null;
        }
        case "autosave_project": {
          const p = a.project as Project;
          state.autosaves[p.id] = { project: p, file: (a.file as string | null) ?? state.autosaves[p.id]?.file ?? null };
          return null;
        }
        case "save_project_thumbnail":
          return null;
        case "list_unfinished":
          return Object.values(state.autosaves)
            .filter((x) => !x.project.exportedAt && x.project.clips.length)
            .sort((x, y) => y.project.updatedAt - x.project.updatedAt)
            .map(
              (x): ProjectSummary => ({
                id: x.project.id,
                name: x.project.name,
                duration: totalDuration(x.project),
                updatedAt: x.project.updatedAt,
                clipCount: x.project.clips.length,
                thumbnail: null,
                file: x.file,
              }),
            );
        case "load_autosave": {
          const x = state.autosaves[String(a.id)];
          if (!x) throw { kind: "notFound", message: "No encontramos el archivo." } satisfies AppError;
          return x.project;
        }
        case "discard_project":
          delete state.autosaves[String(a.id)];
          return null;
        case "mark_project_exported":
          if (state.autosaves[String(a.id)]) state.autosaves[String(a.id)].project.exportedAt = Date.now();
          return null;
        case "recent_files":
          return state.recent;
        case "add_recent_file": {
          const path = String(a.path);
          state.recent = [{ path, kind: a.kind as "video" | "project", openedAt: Date.now() }, ...state.recent.filter((r) => r.path !== path)].slice(0, 12);
          return null;
        }
        case "remove_recent_file":
          state.recent = state.recent.filter((r) => r.path !== a.path);
          return null;
        case "open_snip": {
          const path = String(a.path);
          const p = state.snips[path] ?? seedProject(stemOf(path), [/movido/i.test(path) ? "C:\\Users\\Bruno\\Videos\\movido\\viaje.mp4" : "C:\\Users\\Bruno\\Videos\\viaje.mp4"], Date.now());
          if (/dañado/i.test(path)) throw { kind: "badProject", message: "El proyecto está dañado o no es un proyecto de Snip." } satisfies AppError;
          return { project: p, missing: p.media.filter((m) => /movido/i.test(m.path)).map((m) => m.id) };
        }
        case "save_snip": {
          const path = String(a.path).endsWith(".snip") ? String(a.path) : `${a.path}.snip`;
          state.snips[path] = a.project as Project;
          return path;
        }
        case "save_png":
          return String(a.path);
        case "files_exist":
          return (a.paths as string[]).map((p) => !/movido/i.test(p));
        case "reveal_in_folder":
        case "open_in_default_app":
          return null;
        case "plugin:dialog|open": {
          const opts = (a.options ?? {}) as { multiple?: boolean };
          const paths = state.dialogOpenPaths;
          if (!paths || !paths.length) return null;
          return opts.multiple ? paths : paths[0];
        }
        case "plugin:dialog|save": {
          if (state.dialogSavePath) return state.dialogSavePath;
          const opts = (a.options ?? {}) as { defaultPath?: string };
          return opts.defaultPath ?? "C:\\Users\\Bruno\\Desktop\\salida.mp4";
        }
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
