// Acciones con efectos: hablan con Rust y actualizan el store.

import {
  AUDIO_FILTER,
  IMAGE_FILTER,
  PROJECT_FILTER,
  SRT_FILTER,
  VIDEO_FILTER,
  api,
  events,
  hasTauri,
  mediaSrc,
  pickFiles,
  pickSavePath,
} from "../lib/platform";
import { basename, dirname, isAudio, isProjectFile, isVideo, stem } from "../lib/files";
import { toAppError, type AppError, type ExportJob, type QueueItem, type RasterSpec } from "../lib/types";
import { decorSignature, hasDecor, renderDecorSequence, renderZoneAssets, type DecorSequence, type ZoneAssets } from "../engine/raster";
import { addBlur, addImage, addPip, addText, setCues } from "../project/overlayOps";
import { formatSrt, parseSrt } from "../project/srt";
import type { Clip, ExportSettings, MediaRef, Project } from "../project/model";
import { canvasFps, canvasFpsExpr } from "../project/model";
import { EditError, addMusic as addMusicOp, addRange, fitCanvas, insertMedia, makeId, newProject } from "../project/ops";
import { heavySignature, needsHeavy } from "../project/heavy";
import { layout, totalDuration } from "../project/timeline";
import { Player, type SourceResolver } from "../engine/player";
import {
  activeProject,
  activeTab,
  ask,
  closeTabState,
  dismissToast,
  edit,
  editSignature,
  gestureCancel,
  gestureEnd,
  gestureStart,
  isDirty,
  markSaved,
  openTab,
  patchProject,
  pushToast,
  setMissing,
  setSelection,
  useEditor,
  type ImageEdit,
  type ProcState,
} from "./editor";

// ------------------------------- Errores -------------------------------

export function notifyError(title: string, err: AppError | unknown) {
  const e = toAppError(err);
  pushToast({ severity: "critical", title, message: e.message });
}

export function notifyEditError(e: unknown) {
  if (e instanceof EditError) pushToast({ severity: "caution", title: e.message });
  else notifyError("No se pudo hacer", e);
}

export function warnUnsupported() {
  pushToast({
    severity: "caution",
    title: "Ese formato no se puede abrir",
    message: "Snip abre videos MP4, MOV, MKV y WebM, y proyectos .snip.",
  });
}

// ------------------------------- Reproductor -------------------------------

function procReady(st: ProcState | undefined, sig?: string): string | null {
  return st && st.status === "ready" && (sig === undefined || st.sig === sig) ? st.path : null;
}

const resolver: SourceResolver = {
  mediaUrl(m: MediaRef) {
    const s = useEditor.getState();
    const tab = activeTab(s);
    if (tab?.missing.includes(m.id)) return null;
    const proxy = procReady(s.proxies[m.path]);
    return mediaSrc(proxy ?? m.path);
  },
  clipSource(c: Clip, m: MediaRef) {
    const s = useEditor.getState();
    const p = activeProject(s);
    if (p && needsHeavy(c)) {
      const ready = procReady(s.heavy[c.id], heavySignature(c, p));
      if (ready) return { url: mediaSrc(ready), processed: true };
    }
    const url = resolver.mediaUrl(m);
    return url ? { url, processed: false } : null;
  },
  peaks(m: MediaRef) {
    return useEditor.getState().waveforms[m.path] ?? null;
  },
};

let playerInstance: Player | null = null;

export function player(): Player {
  if (!playerInstance) {
    playerInstance = new Player(resolver);
    playerInstance.on((time, playing) => {
      const st = useEditor.getState();
      if (st.time !== time || st.playing !== playing) useEditor.setState({ time, playing });
    });
    playerInstance.onBroken((url) => void fallbackToProxy(url));
    const { volume, muted } = useEditor.getState();
    playerInstance.setVolume(volume, muted);
  }
  return playerInstance;
}

/** El reproductor sigue al proyecto activo. */
function syncPlayer() {
  const p = activeProject();
  const pl = player();
  pl.setProject(p);
}

// ------------------------------- Medios -------------------------------

async function probe(path: string): Promise<MediaRef> {
  return api.probeMedia(path, makeId("m"));
}

/** Carga en segundo plano la forma de onda de un medio. */
export async function ensureWaveform(m: MediaRef) {
  if (!m.hasAudio || useEditor.getState().waveforms[m.path]) return;
  try {
    const b64 = await api.getWaveform(m.path);
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    useEditor.setState((s) => ({ waveforms: { ...s.waveforms, [m.path]: arr } }));
  } catch {
    /* sin forma de onda: el timeline la omite */
  }
}

function afterProjectLoaded(p: Project) {
  for (const m of p.media) void ensureWaveform(m);
  syncPlayer();
  scheduleHeavy();
  if (!useEditor.getState().encoder) api.getEncoder().then((encoder) => useEditor.setState({ encoder })).catch(() => {});
  if (!useEditor.getState().limits) api.platformLimits().then((limits) => useEditor.setState({ limits })).catch(() => {});
}

/** Abre archivos en una pestaña nueva (videos → proyecto nuevo; .snip → ese proyecto). */
export async function openPaths(paths: string[]) {
  const projects = paths.filter(isProjectFile);
  const videos = paths.filter(isVideo);
  if (!projects.length && !videos.length) {
    warnUnsupported();
    return;
  }
  for (const f of projects) await openProjectFile(f);
  if (videos.length) await openVideos(videos);
}

export async function openVideos(paths: string[]) {
  const st = useEditor.getState();
  if (st.opening) return;
  useEditor.setState({ opening: true });
  try {
    const media: MediaRef[] = [];
    for (const path of paths) {
      try {
        media.push(await probe(path));
      } catch (e) {
        const err = toAppError(e);
        if (err.kind === "unsupportedFormat" || err.kind === "notMp4") warnUnsupported();
        else notifyError(`No se pudo abrir ${basename(path)}`, err);
      }
    }
    if (!media.length) return;
    const p = insertMedia(newProject(), media);
    openTab(p);
    afterProjectLoaded(p);
    for (const m of media) void api.addRecentFile(m.path, "video").catch(() => {});
  } finally {
    useEditor.setState({ opening: false });
  }
}

/** Agrega videos al proyecto activo (en `at`, o al final). */
export async function addVideos(paths: string[], at?: number) {
  const vids = paths.filter(isVideo);
  if (!vids.length) {
    warnUnsupported();
    return;
  }
  if (!activeTab()) return openVideos(vids);
  const media: MediaRef[] = [];
  for (const path of vids) {
    try {
      media.push(await probe(path));
    } catch (e) {
      notifyError(`No se pudo agregar ${basename(path)}`, e);
    }
  }
  if (!media.length) return;
  try {
    edit((p) => insertMedia(p, media, at));
  } catch (e) {
    notifyEditError(e);
    return;
  }
  for (const m of media) void ensureWaveform(m);
  pushToast({ severity: "success", title: media.length === 1 ? "Video agregado" : `${media.length} videos agregados` });
}

export async function addVideosWithDialog() {
  try {
    const paths = await pickFiles("Agregar videos", [VIDEO_FILTER], true);
    if (paths.length) await addVideos(paths);
  } catch (e) {
    notifyError("No se pudo abrir el diálogo", e);
  }
}

export async function openWithDialog() {
  try {
    const paths = await pickFiles("Abrir video o proyecto", [{ name: "Videos y proyectos", extensions: [...VIDEO_FILTER.extensions, "snip"] }, VIDEO_FILTER, PROJECT_FILTER], true);
    if (paths.length) await openPaths(paths);
  } catch (e) {
    notifyError("No se pudo abrir el diálogo", e);
  }
}

export async function addMusicWithDialog() {
  try {
    const [path] = await pickFiles("Agregar música", [AUDIO_FILTER]);
    if (path) await addMusicFile(path);
  } catch (e) {
    notifyError("No se pudo abrir el diálogo", e);
  }
}

export async function addMusicFile(path: string) {
  if (!isAudio(path) && !isVideo(path)) {
    warnUnsupported();
    return;
  }
  try {
    const m = await probe(path);
    const t = useEditor.getState().time;
    edit((p) => addMusicOp(p, m, t));
    void ensureWaveform(m);
    useEditor.setState({ inspectorTab: "audio" });
  } catch (e) {
    notifyEditError(e);
  }
}

// ------------------------------- Proyectos -------------------------------

export async function openProjectFile(path: string) {
  try {
    const { project, missing } = await api.openSnip(path);
    openTab(project, { file: path, saved: true, missing });
    afterProjectLoaded(project);
    void api.addRecentFile(path, "project").catch(() => {});
    if (missing.length) warnMissing(project, missing);
  } catch (e) {
    notifyError(`No se pudo abrir ${basename(path)}`, e);
  }
}

function warnMissing(p: Project, missing: string[]) {
  const first = p.media.find((m) => m.id === missing[0]);
  pushToast({
    severity: "caution",
    title: missing.length === 1 ? "Falta un archivo del proyecto" : `Faltan ${missing.length} archivos del proyecto`,
    message: first ? `No encontramos «${basename(first.path)}». Puede que se haya movido o borrado.` : undefined,
    action: { label: "Buscar archivo", run: () => void relinkMedia(missing[0]) },
  });
}

/** Re-vincula un medio que se movió: el usuario elige el archivo nuevo. */
export async function relinkMedia(mediaId: string) {
  const tab = activeTab();
  const p = activeProject();
  const old = p?.media.find((m) => m.id === mediaId);
  if (!tab || !p || !old) return;
  try {
    const kind = old.kind === "audio" ? AUDIO_FILTER : VIDEO_FILTER;
    const [path] = await pickFiles(`Buscar «${basename(old.path)}»`, [kind]);
    if (!path) return;
    const fresh = await api.probeMedia(path, old.id);
    edit((q) => ({ ...q, media: q.media.map((m) => (m.id === old.id ? { ...fresh, id: old.id } : m)) }));
    const proj = activeProject();
    const missing = proj ? await api.allowProjectMedia(proj) : [];
    setMissing(tab.id, missing);
    void ensureWaveform(fresh);
    syncPlayer();
    pushToast({ severity: "success", title: "Archivo vinculado de nuevo" });
    if (missing.length && proj) warnMissing(proj, missing);
  } catch (e) {
    notifyError("No se pudo vincular el archivo", e);
  }
}

export async function resumeProject(id: string) {
  try {
    const p = await api.loadAutosave(id);
    const missing = await api.allowProjectMedia(p);
    const summary = useEditor.getState().unfinished.find((u) => u.id === id);
    openTab(p, { file: summary?.file ?? null, missing });
    useEditor.setState({ time: p.view.playhead });
    afterProjectLoaded(p);
    player().seek(p.view.playhead);
    if (missing.length) warnMissing(p, missing);
  } catch (e) {
    notifyError("No se pudo abrir el proyecto", e);
  }
}

export async function discardProject(id: string, name: string) {
  const choice = await ask({
    title: "¿Descartar el proyecto?",
    body: `«${name || "Sin nombre"}» se va a borrar de los proyectos sin terminar. Tus videos originales no se tocan.`,
    primary: "Descartar",
    danger: true,
  });
  if (choice !== "primary") return;
  await api.discardProject(id).catch(() => {});
  await refreshWelcome();
}

export async function refreshWelcome() {
  if (!hasTauri()) return;
  const [unfinished, recent] = await Promise.all([api.listUnfinished().catch(() => []), api.recentFiles().catch(() => [])]);
  const open = new Set(useEditor.getState().tabs.map((t) => t.id));
  useEditor.setState({ unfinished: unfinished.filter((u) => !open.has(u.id)), recent });
}

/** Ctrl+S: guarda el .snip (pide dónde la primera vez). */
export async function saveProject(saveAs = false): Promise<boolean> {
  const tab = activeTab();
  const p = activeProject();
  if (!tab || !p) return false;
  if (!p.clips.length) {
    pushToast({ severity: "caution", title: "El proyecto está vacío" });
    return false;
  }
  let file = saveAs ? null : tab.file;
  if (!file) {
    const first = p.media.find((m) => m.id === p.clips[0].mediaId);
    const dir = first ? dirname(first.path) : "";
    const name = `${p.name || "proyecto"}.snip`;
    file = await pickSavePath("Guardar proyecto", dir ? `${dir}\\${name}` : name, [PROJECT_FILTER]).catch(() => null);
    if (!file) return false;
  }
  try {
    const saved = await api.saveSnip(file, p);
    markSaved(tab.id, saved);
    void api.autosaveProject(p, saved).catch(() => {});
    void api.addRecentFile(saved, "project").catch(() => {});
    pushToast({ severity: "success", title: "Proyecto guardado", message: basename(saved) });
    return true;
  } catch (e) {
    notifyError("No se pudo guardar el proyecto", e);
    return false;
  }
}

/** Cierra una pestaña; si hay cambios sin guardar, pregunta. */
export async function closeTab(id: string) {
  const s = useEditor.getState();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (isDirty(tab)) {
    if (s.active !== id) useEditor.setState({ active: id });
    const name = tab.history.present.name || "Sin nombre";
    const choice = await ask({
      title: "¿Guardar los cambios?",
      body: `«${name}» tiene cambios sin guardar. Si no lo guardás, igual queda en «Proyectos sin terminar».`,
      primary: "Guardar",
      secondary: "No guardar",
      tertiary: "Cancelar",
    });
    if (choice === "cancel" || choice === "tertiary") return;
    if (choice === "primary" && !(await saveProject())) return;
  }
  player().pause();
  // Último autoguardado (con la posición del playhead) antes de cerrar.
  flushAutosave(tab.id);
  closeTabState(id);
  syncPlayer();
  void refreshWelcome();
}

export function switchTab(dir: 1 | -1) {
  const { tabs, active } = useEditor.getState();
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === active);
  const next = tabs[(i + dir + tabs.length) % tabs.length];
  activateTab(next.id);
}

export function activateTab(id: string) {
  const pl = player();
  pl.pause();
  // Guardamos dónde estaba el playhead de la pestaña que dejamos.
  patchProject((p) => ({ ...p, view: { ...p.view, playhead: useEditor.getState().time } }));
  useEditor.setState({ active: id, phase: "editor" });
  const p = activeProject();
  syncPlayer();
  if (p) pl.seek(p.view.playhead);
}

// ------------------------------- Autoguardado -------------------------------

const autosaveTimers = new Map<string, number>();
const lastSaved = new Map<string, string>();

function doAutosave(id: string) {
  const tab = useEditor.getState().tabs.find((t) => t.id === id);
  if (!tab || !hasTauri()) return;
  const p = { ...tab.history.present, view: { ...tab.history.present.view, playhead: useEditor.getState().active === id ? useEditor.getState().time : tab.history.present.view.playhead } };
  if (!p.clips.length) return;
  const sig = JSON.stringify(p);
  if (lastSaved.get(id) === sig) return;
  lastSaved.set(id, sig);
  void api.autosaveProject(p, tab.file).catch(() => {});
  maybeSaveThumbnail(p);
}

function flushAutosave(id: string) {
  const t = autosaveTimers.get(id);
  if (t) window.clearTimeout(t);
  autosaveTimers.delete(id);
  doAutosave(id);
}

function scheduleAutosave(id: string) {
  const t = autosaveTimers.get(id);
  if (t) window.clearTimeout(t);
  autosaveTimers.set(id, window.setTimeout(() => doAutosave(id), 700));
}

const thumbSaved = new Map<string, string>();
function maybeSaveThumbnail(p: Project) {
  const c = p.clips[0];
  const m = c && p.media.find((x) => x.id === c.mediaId);
  if (!m) return;
  const key = `${m.path}@${c.inPoint}`;
  if (thumbSaved.get(p.id) === key) return;
  const url = useEditor.getState().thumbs[thumbKey(m.path, quantizeThumbTime(c.inPoint + 0.05, 0.1), 96)];
  if (!url) return;
  thumbSaved.set(p.id, key);
  void api.saveProjectThumbnail(p.id, url).catch(() => {});
}

// ------------------------------- Miniaturas -------------------------------

export function thumbKey(path: string, time: number, height: number) {
  return `${path}|${Math.round(time * 1000)}|${height}`;
}

export function quantizeThumbTime(t: number, step: number) {
  return Math.max(0, Math.round(t / step) * step);
}

let thumbGeneration = 0;
let thumbsListening: Promise<() => void> | null = null;
/** Lo que se pidió en este tick y lo que todavía no llegó (se reenvía con cada pedido nuevo). */
const thumbWanted = new Map<string, { path: string; time: number; height: number }>();
let thumbSent: { key: string; path: string; time: number }[] = [];
let thumbFlush = 0;
let thumbInbox: Record<string, string> = {};
let thumbRaf = 0;

/** Pide las miniaturas que faltan. Los pedidos del mismo tick se agrupan en uno solo. */
export function requestThumbs(items: { path: string; time: number }[], height: number) {
  const have = useEditor.getState().thumbs;
  for (const it of items) {
    const key = thumbKey(it.path, it.time, height);
    if (!have[key]) thumbWanted.set(key, { ...it, height });
  }
  if (!thumbFlush) thumbFlush = window.setTimeout(flushThumbs, 0);
}

function flushThumbs() {
  thumbFlush = 0;
  const have = useEditor.getState().thumbs;
  // Lo pendiente del pedido anterior que todavía no llegó, más lo nuevo (lo nuevo primero).
  const batch = new Map<string, { path: string; time: number; height: number }>();
  for (const [k, v] of thumbWanted) if (!have[k]) batch.set(k, v);
  for (const it of thumbSent) if (!have[it.key] && !batch.has(it.key)) batch.set(it.key, { path: it.path, time: it.time, height: 96 });
  thumbWanted.clear();
  if (!batch.size) return;
  const list = [...batch.entries()].slice(0, 300).map(([key, v]) => ({ key, path: v.path, time: v.time }));
  const same = list.length === thumbSent.length && list.every((m, i) => m.key === thumbSent[i].key);
  if (same) return;
  thumbSent = list;
  thumbGeneration += 1;
  const gen = thumbGeneration;
  if (!thumbsListening) {
    thumbsListening = events.onThumbnail((t) => {
      if (t.group !== "timeline" || t.generation !== thumbGeneration) return;
      const it = thumbSent[t.index];
      if (!it) return;
      // Las que llegan juntas se aplican en un solo update por cuadro.
      thumbInbox[it.key] = t.dataUrl;
      if (!thumbRaf) {
        thumbRaf = requestAnimationFrame(() => {
          thumbRaf = 0;
          const add = thumbInbox;
          thumbInbox = {};
          useEditor.setState((s) => ({ thumbs: { ...s.thumbs, ...add } }));
          const p = activeProject();
          if (p) maybeSaveThumbnail(p);
        });
      }
    });
  }
  void thumbsListening.then(() => api.requestThumbnails("timeline", gen, list.map(({ path, time }) => ({ path, time })), 96).catch(() => {}));
}

// ------------------------------- Proxies (HEVC) -------------------------------

async function fallbackToProxy(url: string) {
  const p = activeProject();
  const m = p?.media.find((x) => mediaSrc(x.path) === url);
  if (!m || m.kind !== "video") return;
  const st = useEditor.getState().proxies[m.path];
  if (st) return;
  const set = (v: ProcState) => useEditor.setState((s) => ({ proxies: { ...s.proxies, [m.path]: v } }));
  set({ status: "pending", percent: 0, sig: "" });
  const off = await events.onProxyProgress((e) => {
    if (e.path === m.path) set({ status: "pending", percent: e.percent, sig: "" });
  });
  try {
    const path = await api.createPreviewProxy(m.path, m.duration, m.fps);
    set({ status: "ready", path, sig: "" });
    player().requestRender();
  } catch (e) {
    set({ status: "error", error: toAppError(e), sig: "" });
  } finally {
    off();
  }
}

// ------------------------------- Etapa pesada -------------------------------

let heavyListening: Promise<() => void> | null = null;

/** Lanza (o cancela) la etapa pesada de los clips que la necesitan. */
export function scheduleHeavy() {
  const p = activeProject();
  if (!p || !hasTauri()) return;
  if (!heavyListening) {
    heavyListening = events.onHeavyProgress((e) => {
      const cur = useEditor.getState().heavy[e.key];
      if (cur?.status === "pending") useEditor.setState((s) => ({ heavy: { ...s.heavy, [e.key]: { ...cur, percent: e.percent } } }));
    });
  }
  const st = useEditor.getState();
  for (const c of p.clips) {
    if (!needsHeavy(c)) continue;
    const sig = heavySignature(c, p);
    const cur = st.heavy[c.id];
    if (cur && cur.sig === sig) continue;
    const m = p.media.find((x) => x.id === c.mediaId);
    if (!m) continue;
    useEditor.setState((s) => ({ heavy: { ...s.heavy, [c.id]: { status: "pending", percent: 0, sig } } }));
    api
      .prepareClip(c.id, m, c, canvasFpsExpr(p.canvas), canvasFps(p.canvas))
      .then((path) => {
        const now = useEditor.getState().heavy[c.id];
        if (now?.sig !== sig) return;
        useEditor.setState((s) => ({ heavy: { ...s.heavy, [c.id]: { status: "ready", path, sig } } }));
        player().requestRender();
      })
      .catch((e) => {
        const err = toAppError(e);
        if (err.kind === "cancelled") return;
        const now = useEditor.getState().heavy[c.id];
        if (now?.sig !== sig) return;
        useEditor.setState((s) => ({ heavy: { ...s.heavy, [c.id]: { status: "error", error: err, sig } } }));
      });
  }
}

// ------------------------------- Exportación -------------------------------

export function buildJob(p: Project, opts: { settings?: ExportSettings; window?: { start: number; end: number }; label?: string; output?: string | null } = {}): ExportJob {
  return {
    project: p,
    settings: opts.settings ?? p.export,
    window: opts.window ?? null,
    output: opts.output ?? null,
    label: opts.label ?? null,
    saveProject: !opts.window,
  };
}

/** Manda el proyecto (o un rango) a la cola de exportación. */
// ------------------------------- Textos -------------------------------

/** Texto nuevo (plantilla) en el playhead: queda seleccionado y con la pestaña Texto abierta. */
export function addTextAtPlayhead(template = "title") {
  const p = activeProject();
  if (!p || !p.clips.length) {
    pushToast({ severity: "caution", title: "Agregá un video antes de sumar textos" });
    return;
  }
  let id = "";
  edit((q) => {
    const [r, newId] = addText(q, template, useEditor.getState().time);
    id = newId;
    return r;
  });
  setSelection([id]);
  useEditor.setState({ inspectorTab: "text", inspectorOpen: true });
  requestTextFocus();
}

/** Pide el foco en el cuadro de texto (si el editor todavía no se montó, lo toma al montarse). */
let pendingTextFocus = false;
export function requestTextFocus() {
  pendingTextFocus = true;
  window.dispatchEvent(new CustomEvent("snip:focus-text"));
}
export function takeTextFocus(): boolean {
  const v = pendingTextFocus;
  pendingTextFocus = false;
  return v;
}

/** Logo o marca de agua: arriba a la derecha, durante todo el video. */
export async function addLogoWithDialog() {
  const p = activeProject();
  if (!p || !p.clips.length) {
    pushToast({ severity: "caution", title: "Agregá un video antes de sumar un logo" });
    return;
  }
  const [path] = await pickFiles("Elegí una imagen (PNG con transparencia queda mejor)", [IMAGE_FILTER]);
  if (!path) return;
  try {
    const m = await probe(path);
    if (m.kind !== "image") throw new EditError("Elegí una imagen PNG, JPG o WebP.");
    let id = "";
    edit((q) => {
      const [r, newId] = addImage(q, m);
      id = newId;
      return r;
    });
    setSelection([id]);
    useEditor.setState({ inspectorTab: "video", inspectorOpen: true });
  } catch (e) {
    notifyError("No se pudo agregar la imagen", e);
  }
}

/** Zona desenfocada o pixelada en el playhead. */
export function addBlurAtPlayhead(mode: "blur" | "pixelate") {
  const p = activeProject();
  if (!p || !p.clips.length) return;
  let id = "";
  edit((q) => {
    const [r, newId] = addBlur(q, useEditor.getState().time, mode);
    id = newId;
    return r;
  });
  setSelection([id]);
  useEditor.setState({ inspectorTab: "video", inspectorOpen: true });
}

/** Picture-in-picture: elegir un video y ponerlo abajo a la derecha desde el playhead. */
export async function addPipWithDialog() {
  const p = activeProject();
  if (!p || !p.clips.length) {
    pushToast({ severity: "caution", title: "Agregá un video principal antes del picture-in-picture" });
    return;
  }
  const [path] = await pickFiles("Elegí el video para el picture-in-picture", [VIDEO_FILTER]);
  if (!path) return;
  try {
    const m = await probe(path);
    if (m.kind !== "video") throw new EditError("Elegí un video.");
    void ensureWaveform(m);
    let id = "";
    edit((q) => {
      const [r, newId] = addPip(q, m, useEditor.getState().time);
      id = newId;
      return r;
    });
    setSelection([id]);
    useEditor.setState({ inspectorTab: "video", inspectorOpen: true });
  } catch (e) {
    notifyError("No se pudo agregar el video", e);
  }
}

// ------------------------------- Subtítulos -------------------------------

export async function importSrtWithDialog() {
  const p = activeProject();
  if (!p) return;
  const [path] = await pickFiles("Importar subtítulos", [SRT_FILTER]);
  if (!path) return;
  try {
    const cues = parseSrt(await api.readSubtitles(path), () => makeId("s"));
    if (!cues.length) {
      pushToast({ severity: "caution", title: "No encontramos subtítulos en ese archivo", message: "Revisá que sea un .srt con tiempos del tipo 00:00:01,000 --> 00:00:02,000." });
      return;
    }
    let replace = true;
    if (p.subtitles.cues.length) {
      const r = await ask({
        title: "¿Reemplazar los subtítulos?",
        body: `El proyecto ya tiene ${p.subtitles.cues.length} subtítulos. Podés reemplazarlos o sumar los del archivo.`,
        primary: "Reemplazar",
        secondary: "Sumar",
      });
      if (r === "cancel") return;
      replace = r === "primary";
    }
    edit((q) => setCues(q, replace ? cues : [...q.subtitles.cues, ...cues]));
    pushToast({ severity: "success", title: `${cues.length} subtítulos importados` });
  } catch (e) {
    notifyError("No se pudieron importar los subtítulos", e);
  }
}

export async function exportSrt() {
  const p = activeProject();
  if (!p || !p.subtitles.cues.length) return;
  const first = p.media.find((m) => m.kind === "video");
  const def = first ? `${dirname(first.path)}\\${stem(first.path)}.srt` : `${p.name || "subtitulos"}.srt`;
  const path = await pickSavePath("Guardar subtítulos", def, [SRT_FILTER]);
  if (!path) return;
  try {
    const out = await api.writeSubtitles(path, formatSrt(p.subtitles.cues));
    pushToast({ severity: "success", title: "Subtítulos guardados", message: basename(out) });
  } catch (e) {
    notifyError("No se pudieron guardar los subtítulos", e);
  }
}

// ------------------------- Subtítulos automáticos -------------------------

export const SUB_LANGUAGES: { value: string; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "auto", label: "Detectar automáticamente" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
  { value: "fr", label: "Francés" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Alemán" },
  { value: "ca", label: "Catalán" },
  { value: "ja", label: "Japonés" },
];

const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(SUB_LANGUAGES.filter((l) => l.value !== "auto").map((l) => [l.value, l.label.toLowerCase()]));

let autoSubsListening = false;
function listenAutoSubs() {
  if (autoSubsListening) return;
  autoSubsListening = true;
  void events.onModelProgress(({ received, total }) => {
    const mb = (n: number) => Math.round(n / 1e6);
    const st = useEditor.getState().autoSubs;
    if (st?.phase !== "download") return;
    useEditor.setState({ autoSubs: { phase: "download", percent: total ? (100 * received) / total : 0, detail: total ? `${mb(received)} de ${mb(total)} MB` : `${mb(received)} MB` } });
  });
  void events.onTranscribeProgress(({ stage, percent }) => {
    if (!useEditor.getState().autoSubs) return;
    useEditor.setState({ autoSubs: { phase: stage, percent } });
  });
}

/**
 * Genera subtítulos con whisper.cpp. La primera vez baja el modelo (con
 * permiso). Todo corre en segundo plano y se puede cancelar.
 */
export async function generateSubtitles(language: string) {
  const p = activeProject();
  if (!p || !p.clips.length) return;
  if (useEditor.getState().autoSubs) return;
  listenAutoSubs();
  try {
    const status = await api.modelStatus();
    if (!status.engine) {
      pushToast({ severity: "critical", title: "Falta el motor de subtítulos automáticos", message: "Reinstalá Snip para recuperarlo." });
      return;
    }
    if (!status.present) {
      const ok = await ask({
        title: "Descargar el reconocimiento de voz",
        body: `La primera vez hay que bajar el modelo de reconocimiento de voz (unos ${status.downloadMb} MB). Se guarda en tu equipo y después funciona sin internet.`,
        primary: "Descargar",
        secondary: "Ahora no",
      });
      if (ok !== "primary") return;
      useEditor.setState({ autoSubs: { phase: "download", percent: 0 } });
      await api.downloadModel();
    }
    useEditor.setState({ autoSubs: { phase: "audio", percent: 0 } });
    const r = await api.transcribe(p, language === "auto" ? null : language);
    useEditor.setState({ autoSubs: null });
    if (!r.cues.length) {
      pushToast({ severity: "caution", title: "No se escuchó nada para subtitular", message: "Revisá que el video tenga voz y que el idioma sea el correcto." });
      return;
    }
    const cues = r.cues.map((c) => ({ ...c, id: makeId("s") }));
    let replace = true;
    const cur = activeProject();
    if (cur?.subtitles.cues.length) {
      const a = await ask({
        title: "¿Reemplazar los subtítulos?",
        body: `El proyecto ya tiene ${cur.subtitles.cues.length} subtítulos.`,
        primary: "Reemplazar",
        secondary: "Sumar",
      });
      if (a === "cancel") return;
      replace = a === "primary";
    }
    edit((q) => setCues(q, replace ? cues : [...q.subtitles.cues, ...cues], r.language));
    const lang = r.language && LANGUAGE_NAMES[r.language] ? ` en ${LANGUAGE_NAMES[r.language]}` : "";
    pushToast({ severity: "success", title: `${cues.length} subtítulos generados${lang}`, message: r.gpu ? "Se usó la placa de video." : "Se usó el procesador." });
  } catch (e) {
    useEditor.setState({ autoSubs: null });
    const err = toAppError(e);
    if (err.kind === "cancelled") return;
    notifyError("No se pudieron generar los subtítulos", err);
  }
}

export function cancelAutoSubs() {
  const st = useEditor.getState().autoSubs;
  if (!st) return;
  if (st.phase === "download") void api.cancelModelDownload();
  else void api.cancelTranscribe();
  useEditor.setState({ autoSubs: null });
}

// ---- Capas rasterizadas (textos, subtítulos, logos) para la exportación ----

let decorCache: { sig: string; seq: DecorSequence } | null = null;

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

let zoneCache: { sig: string; assets: ZoneAssets } | null = null;

/**
 * Genera (o reusa) las capas rasterizadas de la exportación (textos/subtítulos/
 * logos, máscaras de zonas desenfocadas y del PiP) y las escribe en una carpeta
 * propia del trabajo. Devuelve null si el proyecto no tiene ninguna.
 */
export async function prepareRaster(p: Project): Promise<RasterSpec | null> {
  const base = `${p.canvas.width}x${p.canvas.height}#${totalDuration(p).toFixed(4)}#${p.canvas.fpsNum}/${p.canvas.fpsDen}`;
  const zoneSig = `${JSON.stringify(p.overlays.filter((o) => o.type === "blur" || o.type === "video"))}#${base}`;
  const needsDecor = hasDecor(p);
  const needsZones = p.overlays.some((o) => o.type === "blur" || o.type === "video");
  if (!needsDecor && !needsZones) return null;
  let seq: DecorSequence | null = null;
  let zones: ZoneAssets | null = null;
  const toast = pushToast({ severity: "info", title: "Preparando textos y capas…" });
  try {
    if (needsDecor) {
      const sig = `${decorSignature(p)}#${base}`;
      seq = decorCache?.sig === sig ? decorCache.seq : null;
      if (!seq) {
        await player().images.ready(p);
        seq = await renderDecorSequence(p, player().images);
        if (seq) decorCache = { sig, seq };
      }
    }
    if (needsZones) {
      zones = zoneCache?.sig === zoneSig ? zoneCache.assets : null;
      if (!zones) {
        zones = await renderZoneAssets(p);
        if (zones) zoneCache = { sig: zoneSig, assets: zones };
      }
    }
  } finally {
    dismissToast(toast);
  }
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let dir = "";
  // En tandas de ~4 MB para no mandar un mensaje gigante por IPC.
  let batch: { name: string; data: string }[] = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    dir = await api.writeRasterFiles(id, batch);
    batch = [];
    size = 0;
  };
  const put = async (name: string, png: Blob) => {
    batch.push({ name, data: await blobToBase64(png) });
    size += png.size;
    if (size > 4_000_000) await flush();
  };
  for (const f of seq?.frames ?? []) await put(f.name, f.png);
  const maskSeqs = Object.entries(zones?.masks ?? {});
  for (const [, ms] of maskSeqs) for (const f of ms.frames) await put(f.name, f.png);
  const pipEntries = Object.entries(zones?.pips ?? {});
  for (const [i, [, a]] of pipEntries.entries()) {
    await put(`pipmask${i}.png`, a.mask);
    if (a.shadow) await put(`pipshadow${i}.png`, a.shadow);
  }
  await flush();
  const sep = dir.includes("\\") ? "\\" : "/";
  const spec: RasterSpec = { dir, masks: {}, pips: {} };
  if (seq) spec.decor = await api.writeRasterList(id, "decor.ffconcat", seq.list);
  for (const [i, [oid, ms]] of maskSeqs.entries()) spec.masks![oid] = await api.writeRasterList(id, `blur${i}.ffconcat`, ms.list);
  for (const [i, [oid, a]] of pipEntries.entries()) {
    spec.pips![oid] = {
      mask: `${dir}${sep}pipmask${i}.png`,
      shadow: a.shadow ? `${dir}${sep}pipshadow${i}.png` : null,
      width: a.rect.w,
      height: a.rect.h,
      x: a.rect.x,
      y: a.rect.y,
    };
  }
  return spec;
}

export async function enqueueExport(opts: { window?: { start: number; end: number }; label?: string; output?: string | null } = {}) {
  const p = activeProject();
  if (!p) return;
  if (!p.clips.length) {
    pushToast({ severity: "caution", title: "Agregá al menos un video para exportar" });
    return;
  }
  const title = opts.label ? `${p.name || "Proyecto"} · ${opts.label}` : p.name || "Proyecto";
  let raster: RasterSpec | null = null;
  try {
    raster = await prepareRaster(p);
    await api.enqueueExport({ ...buildJob(p, opts), raster }, title);
    pushToast({
      severity: "info",
      title: "Exportando en segundo plano",
      message: "Podés seguir editando. La cola está arriba a la derecha.",
      action: { label: "Ver cola", run: () => useEditor.setState({ queueOpen: true }) },
    });
  } catch (e) {
    if (raster?.dir) void api.discardRaster(raster.dir).catch(() => {});
    notifyError("No se pudo exportar", e);
  }
}

/** Exporta cada rango marcado como un archivo separado. */
export async function exportRanges() {
  const p = activeProject();
  if (!p) return;
  if (!p.ranges.length) {
    pushToast({ severity: "caution", title: "No hay fragmentos marcados", message: "Marcá inicio (I) y fin (O) y tocá «Agregar fragmento»." });
    return;
  }
  for (const r of p.ranges) await enqueueExport({ window: { start: r.start, end: r.end }, label: r.name });
}

/** Rango I/O → fragmento para exportar. */
export function addRangeFromMarks() {
  const tab = activeTab();
  if (!tab) return;
  const total = totalDuration(tab.history.present);
  const a = tab.markIn ?? 0;
  const b = tab.markOut ?? total;
  try {
    edit((p) => addRange(p, a, b));
    pushToast({ severity: "success", title: "Fragmento agregado" });
  } catch (e) {
    notifyEditError(e);
  }
}

/** Extrae el audio a MP3 (un trabajo en la cola). */
export async function extractAudio() {
  const p = activeProject();
  if (!p) return;
  const settings: ExportSettings = { ...p.export, format: "mp3", sizeTarget: null, mode: "precise" };
  try {
    await api.enqueueExport({ ...buildJob(p, { settings }), saveProject: false }, `${p.name || "Proyecto"} · audio`);
    pushToast({ severity: "info", title: "Extrayendo el audio", action: { label: "Ver cola", run: () => useEditor.setState({ queueOpen: true }) } });
  } catch (e) {
    notifyError("No se pudo extraer el audio", e);
  }
}

let queueListening = false;
const notified = new Set<number>();

function onQueue(items: QueueItem[]) {
  useEditor.setState({ queue: items });
  for (const it of items) {
    if (notified.has(it.id)) continue;
    if (it.status.state === "done") {
      notified.add(it.id);
      const out = it.status.outcome;
      const tab = useEditor.getState().tabs.find((t) => t.id === it.projectId);
      if (tab && out.projectFile) markSaved(tab.id, out.projectFile);
      pushToast({
        severity: "success",
        title: "Exportación lista",
        message: basename(out.output),
        action: { label: "Mostrar", run: () => void api.revealInFolder(out.output).catch(() => {}) },
      });
      void refreshWelcome();
    } else if (it.status.state === "failed") {
      notified.add(it.id);
      pushToast({ severity: "critical", title: `No se pudo exportar «${it.title}»`, message: it.status.error.message });
    }
  }
}

export async function startQueueListener() {
  if (queueListening || !hasTauri()) return;
  queueListening = true;
  await events.onQueue(onQueue);
  onQueue(await api.exportQueue().catch(() => []));
}

// ------------------------------- Otros -------------------------------

/** Guarda el cuadro actual como PNG (a resolución completa del lienzo). */
export async function saveFramePng() {
  const p = activeProject();
  if (!p) return;
  const t = useEditor.getState().time;
  try {
    const png = await player().capture(t);
    const first = p.media.find((m) => m.id === p.clips[0]?.mediaId);
    const dir = first ? dirname(first.path) : "";
    const name = `${p.name || stem(first?.path ?? "cuadro")}_cuadro.png`;
    const path = await pickSavePath("Guardar cuadro como PNG", dir ? `${dir}\\${name}` : name, [{ name: "Imagen PNG", extensions: ["png"] }]);
    if (!path) return;
    const saved = await api.savePng(path, png);
    pushToast({ severity: "success", title: "Cuadro guardado", message: basename(saved), action: { label: "Mostrar", run: () => void api.revealInFolder(saved).catch(() => {}) } });
  } catch (e) {
    notifyError("No se pudo guardar el cuadro", e);
  }
}

/** Normalizar audio: hace el análisis la primera vez. */
export async function setNormalize(clipId: string, on: boolean) {
  const p = activeProject();
  const c = p?.clips.find((x) => x.id === clipId);
  const m = c && p?.media.find((x) => x.id === c.mediaId);
  if (!c || !m) return;
  if (!on) {
    edit((q) => ({ ...q, clips: q.clips.map((x) => (x.id === clipId ? { ...x, audio: { ...x.audio, normalize: null } } : x)) }));
    return;
  }
  try {
    const l = await api.analyzeLoudness(m.path, c.inPoint, Math.max(0.1, c.outPoint - c.inPoint));
    edit((q) => ({ ...q, clips: q.clips.map((x) => (x.id === clipId ? { ...x, audio: { ...x.audio, normalize: l } } : x)) }));
  } catch (e) {
    notifyError("No se pudo normalizar", e);
  }
}

export async function revealOutput(path: string) {
  try {
    await api.revealInFolder(path);
  } catch (e) {
    notifyError("No se pudo abrir la carpeta", e);
  }
}

export async function playOutput(path: string) {
  try {
    await api.openInDefaultApp(path);
  } catch (e) {
    notifyError("No se pudo reproducir el video", e);
  }
}

// ------------------------------- Suscripciones -------------------------------

let lastProject: Project | null = null;
let lastActive: string | null = null;

/** Mantiene sincronizados el reproductor, el autoguardado y la etapa pesada. */
// ------------------------- Edición sobre el preview -------------------------

function sameEdit(a: ImageEdit | null, b: ImageEdit | null): boolean {
  return !!a && !!b && a.mode === b.mode && a.clipId === b.clipId;
}

/** Lleva el playhead adentro del clip (al keyframe, si se edita uno). */
function seekIntoClip(e: ImageEdit) {
  const p = activeProject();
  if (!p) return;
  const i = p.clips.findIndex((c) => c.id === e.clipId);
  if (i < 0) return;
  const span = layout(p.clips)[i];
  const pl = player();
  pl.pause();
  if (e.mode === "zoom") {
    const k = p.clips[i].video.zoom.find((z) => z.id === e.keyId);
    if (k) pl.seek(Math.min(span.end - pl.frameDur(), span.start + k.t));
    return;
  }
  const t = useEditor.getState().time;
  if (t < span.start || t >= span.end) pl.seek(span.start + Math.min(0.5, span.duration / 2));
}

/**
 * Entra o sale de la edición sobre el preview. Todo un recorte es un solo
 * paso de deshacer: "done" lo confirma y "cancel" lo descarta.
 */
export function setImageEdit(next: ImageEdit | null, how: "done" | "cancel" = "done") {
  const prev = useEditor.getState().imageEdit;
  if (prev?.mode === "crop" && !sameEdit(prev, next)) {
    if (how === "cancel") gestureCancel();
    else gestureEnd();
  }
  if (next?.mode === "crop" && !sameEdit(prev, next)) gestureStart();
  if (next) seekIntoClip(next);
  useEditor.setState({ imageEdit: next });
  const pl = player();
  pl.override = next ? { clipId: next.clipId, noCrop: next.mode === "crop", noZoom: true } : null;
  pl.requestRender();
}

let heavyTimer = 0;

export function startSync() {
  return useEditor.subscribe((s) => {
    const tab = activeTab(s);
    const p = tab?.history.present ?? null;
    if (s.active !== lastActive) {
      if (s.imageEdit) queueMicrotask(() => setImageEdit(null));
      lastActive = s.active;
      lastProject = p;
      syncPlayer();
      return;
    }
    // Si el clip que se editaba sobre el preview ya no está (deshacer, borrar), se sale.
    if (s.imageEdit && (!p || !p.clips.some((c) => c.id === s.imageEdit!.clipId))) {
      queueMicrotask(() => setImageEdit(null, "cancel"));
    }
    if (p && p !== lastProject) {
      const prev = lastProject;
      lastProject = p;
      const fitted = fitCanvas(p);
      if (fitted !== p) {
        patchProject(() => fitted);
        return;
      }
      if (!prev || editSignature(prev) !== editSignature(p)) {
        player().setProject(p);
        // Con un pequeño respiro: arrastrar un slider (ruido, estabilización) no relanza el proceso a cada paso.
        window.clearTimeout(heavyTimer);
        heavyTimer = window.setTimeout(scheduleHeavy, 450);
      }
      // La vista (zoom, scroll) solo se autoguarda: no cambia el preview.
      scheduleAutosave(p.id);
    }
  });
}
