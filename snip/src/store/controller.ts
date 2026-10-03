// Acciones con efectos: hablan con Rust y actualizan el store.

import { api, events, mediaSrc, pickSavePath, pickVideo } from "../lib/platform";
import { basename, isMp4 } from "../lib/files";
import { toAppError, type AppError } from "../lib/types";
import { buildExportRequest, THUMB_COUNT, useSnip } from "./snip";
import { pause } from "../lib/playback";

let session = 0;
let unlistenThumbs: (() => void) | null = null;
let unlistenProxy: (() => void) | null = null;

const THUMB_HEIGHT = 96;

export function notifyError(title: string, err: AppError) {
  useSnip.getState().pushToast({ severity: "critical", title, message: err.message });
}

export function warnNotMp4() {
  useSnip.getState().pushToast({
    severity: "caution",
    title: "Por ahora solo MP4",
    message: "Snip abre únicamente archivos .mp4. Probá con otro video.",
  });
}

/** Abre un video por ruta (argumento, drag & drop, diálogo o "Abrir con"). */
export async function openFile(path: string) {
  const st = useSnip.getState();
  if (!isMp4(path)) {
    warnNotMp4();
    return;
  }
  if (st.exportState.status === "running") {
    st.pushToast({ severity: "caution", title: "Hay una exportación en curso", message: "Esperá a que termine o cancelala para abrir otro video." });
    return;
  }
  if (st.opening) return;
  useSnip.setState({ opening: true });
  pause();
  try {
    const media = await api.openMedia(path);
    session += 1;
    const my = session;
    void api.cancelProxy().catch(() => {});
    useSnip.getState().setMediaLoaded(media, mediaSrc(media.path), my);
    startThumbnails(my);
    api
      .getKeyframes(media.path)
      .then((k) => {
        if (useSnip.getState().session === my) useSnip.setState({ keyframes: k });
      })
      .catch(() => {});
    api
      .defaultOutputPath(media.path)
      .then((p) => {
        if (useSnip.getState().session === my) useSnip.setState({ defaultOutput: p });
      })
      .catch(() => {});
    if (!useSnip.getState().encoder) {
      api.getEncoder().then((encoder) => useSnip.setState({ encoder })).catch(() => {});
    }
  } catch (e) {
    useSnip.setState({ opening: false });
    const err = toAppError(e);
    if (err.kind === "notMp4") warnNotMp4();
    else notifyError(`No se pudo abrir ${basename(path)}`, err);
  }
}

export async function openWithDialog() {
  try {
    const p = await pickVideo();
    if (p) await openFile(p);
  } catch (e) {
    notifyError("No se pudo abrir el diálogo", toAppError(e));
  }
}

async function startThumbnails(my: number) {
  const { media } = useSnip.getState();
  if (!media) return;
  unlistenThumbs?.();
  unlistenThumbs = await events.onThumbnail((t) => {
    if (t.generation !== my || useSnip.getState().session !== my) return;
    useSnip.setState((s) => {
      const thumbs = s.thumbs.slice();
      thumbs[t.index] = t.dataUrl;
      return { thumbs };
    });
  });
  await api.startThumbnails(media.path, media.duration, THUMB_COUNT, THUMB_HEIGHT, my).catch(() => {});
}

/** WebView2 no pudo reproducir el original (típicamente HEVC): proxy 720p. */
export async function fallbackToProxy() {
  const st = useSnip.getState();
  const { media, session: my } = st;
  if (!media || st.usingProxy || st.proxy.status === "creating") return;
  useSnip.setState({ proxy: { status: "creating", percent: 0 }, videoReady: false });
  unlistenProxy?.();
  unlistenProxy = await events.onProxyProgress((p) => {
    if (useSnip.getState().session !== my || p.path !== media.path) return;
    useSnip.setState({ proxy: { status: "creating", percent: p.percent } });
  });
  try {
    const proxyPath = await api.createPreviewProxy(media.path, media.duration, media.fps);
    if (useSnip.getState().session !== my) return;
    useSnip.setState({ videoSrc: mediaSrc(proxyPath), usingProxy: true, proxy: { status: "ready" } });
  } catch (e) {
    if (useSnip.getState().session !== my) return;
    const err = toAppError(e);
    useSnip.setState({ proxy: { status: "error", error: err } });
  } finally {
    unlistenProxy?.();
    unlistenProxy = null;
  }
}

export async function chooseSavePath() {
  const { media, settings, defaultOutput } = useSnip.getState();
  if (!media) return;
  const suggestion = settings.outputPath ?? defaultOutput ?? media.path.replace(/\.mp4$/i, "_snip.mp4");
  try {
    const p = await pickSavePath(suggestion);
    if (p) useSnip.getState().setOutputPath(p);
  } catch (e) {
    notifyError("No se pudo abrir «Guardar como…»", toAppError(e));
  }
}

let unlistenExport: (() => void) | null = null;

export async function startExport() {
  const st = useSnip.getState();
  if (!st.media || st.exportState.status === "running") return;
  const req = buildExportRequest(st);
  if (!req) return;
  pause();
  if (!st.panelOpen) st.togglePanel(true);
  useSnip.setState({
    exportState: {
      status: "running",
      progress: { percent: 0, speed: null, etaSecs: null, outTime: 0 },
      startedAt: performance.now(),
      cancelling: false,
    },
  });
  unlistenExport?.();
  unlistenExport = await events.onExportProgress((p) => {
    const cur = useSnip.getState().exportState;
    if (cur.status === "running") useSnip.setState({ exportState: { ...cur, progress: p } });
  });
  try {
    const outcome = await api.exportVideo(req);
    useSnip.setState({ exportState: { status: "success", outcome } });
    // El próximo export por defecto no pisa nada: pedimos un nombre nuevo.
    api.defaultOutputPath(req.input).then((p) => useSnip.setState({ defaultOutput: p })).catch(() => {});
    if (outcome.fellBack) {
      useSnip.setState({ encoder: { id: "libx264", label: "x264 (CPU)", hardware: false } });
    }
  } catch (e) {
    const err = toAppError(e);
    if (err.kind === "cancelled") {
      useSnip.setState({ exportState: { status: "idle" } });
      useSnip.getState().pushToast({ severity: "info", title: "Exportación cancelada", message: "No quedó ningún archivo a medias." });
    } else {
      useSnip.setState({ exportState: { status: "error", error: err } });
    }
  } finally {
    unlistenExport?.();
    unlistenExport = null;
  }
}

export async function cancelExport() {
  const cur = useSnip.getState().exportState;
  if (cur.status !== "running") return;
  useSnip.setState({ exportState: { ...cur, cancelling: true } });
  await api.cancelExport().catch(() => {});
}

export function backToSettings() {
  useSnip.setState({ exportState: { status: "idle" } });
}

export async function revealOutput(path: string) {
  try {
    await api.revealInFolder(path);
  } catch (e) {
    notifyError("No se pudo abrir la carpeta", toAppError(e));
  }
}

export async function playOutput(path: string) {
  try {
    await api.openInDefaultApp(path);
  } catch (e) {
    notifyError("No se pudo reproducir el video", toAppError(e));
  }
}

export function closeFile() {
  pause();
  void api.cancelProxy().catch(() => {});
  unlistenThumbs?.();
  unlistenThumbs = null;
  session += 1;
  const { volume, muted, encoder, toasts } = useSnip.getState();
  useSnip.getState().reset();
  useSnip.setState({ volume, muted, encoder, toasts, session });
}
