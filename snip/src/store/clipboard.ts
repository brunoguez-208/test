// Portapapeles del editor: copiar, cortar, pegar (interno, entre pestañas y
// desde Windows: capturas, texto y archivos del Explorador), duplicar, pegar
// efectos y agrupar. Todo es una edición más: se deshace con Ctrl+Z.

import { api, hasTauri } from "../lib/platform";
import { basename, isAudio, isImage, isVideo } from "../lib/files";
import {
  copySelection,
  cutSelection,
  duplicate,
  freeMusicTrack,
  effectsOf,
  groupItems,
  parseClipboard,
  pasteAt,
  pasteEffects,
  ungroupItems,
  type ClipboardData,
  type Effects,
} from "../project/clipboard";
import { addImageAt, addOverlay, addPip, textFromTemplate } from "../project/overlayOps";
import { TEXT_TEMPLATES } from "../project/templates";
import { addMusic, deleteClips, insertMedia, makeId, EditError } from "../project/ops";
import { layout, totalDuration } from "../project/timeline";
import { DEFAULT_VIDEO, type MediaRef, type Project } from "../project/model";
import { unlockedOnly } from "../project/tracks";
import type { MenuEntry } from "../components/ui/ContextMenu";
import { activeProject, activeTab, edit, pushToast, setSelection, useEditor, type DropTarget } from "./editor";
import { ensureWaveform, notifyEditError, notifyError } from "./controller";

let internal: ClipboardData | null = null;
let internalText = "";
let fx: Effects | null = null;

/** Lo último copiado (para tests y para el menú contextual). */
export function clipboardState() {
  return { hasItems: !!internal, hasEffects: !!fx };
}

function selection(): string[] {
  return activeTab()?.selection ?? [];
}

function remember(data: ClipboardData) {
  internal = data;
  internalText = JSON.stringify(data);
  // También al portapapeles del sistema: se puede pegar en otra pestaña o ventana de Snip.
  void navigator.clipboard?.writeText(internalText).catch(() => {});
  // El primer clip copiado aporta los efectos para Ctrl+Alt+V.
  if (data.clips[0]) fx = effectsOf(data.clips[0]);
  else if (data.music[0]) fx = { ...(fx ?? NO_EFFECTS), volume: data.music[0].volume };
}

const NO_EFFECTS: Effects = {
  video: { color: { ...DEFAULT_VIDEO.color }, look: null, sharpen: 0, denoise: 0, stabilize: null },
  speed: 1,
  smoothSlowmo: false,
  volume: 1,
};

function count(d: ClipboardData) {
  return d.clips.length + d.overlays.length + d.music.length + d.cues.length;
}

export function copy(): boolean {
  const p = activeProject();
  const sel = selection();
  if (!p || !sel.length) return false;
  const data = copySelection(p, sel);
  if (!data) return false;
  remember(data);
  pushToast({ severity: "info", title: count(data) === 1 ? "Copiado" : `${count(data)} elementos copiados` });
  return true;
}

export function cut(): boolean {
  const p = activeProject();
  if (!p || !selection().length) return false;
  try {
    const sel = unlockedOnly(p, selection());
    let data: ClipboardData | null = null;
    edit((q) => {
      const [r, d] = cutSelection(q, sel, deleteClips);
      data = d;
      return r;
    });
    if (data) remember(data);
    setSelection([]);
  } catch (e) {
    notifyEditError(e);
  }
  return true;
}

function pasteData(data: ClipboardData) {
  const t = useEditor.getState().time;
  try {
    let ids: string[] = [];
    edit((q) => {
      const [r, n] = pasteAt(q, data, t);
      ids = n;
      return r;
    });
    setSelection(ids);
    for (const m of data.media) void ensureWaveform(m);
  } catch (e) {
    notifyEditError(e);
  }
}

export function duplicateSelection(): boolean {
  const sel = selection();
  if (!activeProject() || !sel.length) return false;
  try {
    let ids: string[] = [];
    edit((q) => {
      const [r, n] = duplicate(q, sel);
      ids = n;
      return r;
    });
    setSelection(ids);
  } catch (e) {
    notifyEditError(e);
  }
  return true;
}

export function pasteEffectsToSelection(): boolean {
  if (!activeProject()) return false;
  if (!fx) {
    pushToast({ severity: "caution", title: "Primero copiá un clip (Ctrl+C) para pegar sus efectos" });
    return true;
  }
  const effects = fx;
  try {
    edit((q) => pasteEffects(q, effects, selection()));
    pushToast({ severity: "success", title: "Efectos pegados", message: "Color, filtros, velocidad y volumen." });
  } catch (e) {
    notifyEditError(e);
  }
  return true;
}

export function groupSelection(): boolean {
  if (!activeProject()) return false;
  try {
    edit((q) => groupItems(q, selection()));
    setSelection(selection());
    pushToast({ severity: "info", title: "Agrupado", message: "Se mueven, copian y borran juntos. Ctrl+Shift+G desagrupa." });
  } catch (e) {
    notifyEditError(e);
  }
  return true;
}

export function ungroupSelection(): boolean {
  if (!activeProject()) return false;
  try {
    edit((q) => ungroupItems(q, selection()));
  } catch (e) {
    notifyEditError(e);
  }
  return true;
}

// ------------------------ Pegar desde Windows ------------------------

async function probeAll(paths: string[]): Promise<MediaRef[]> {
  const out: MediaRef[] = [];
  for (const path of paths) {
    try {
      out.push(await api.probeMedia(path, makeId("m")));
    } catch (e) {
      notifyError(`No se pudo agregar ${basename(path)}`, e);
    }
  }
  return out;
}

/** Index de la pista principal en el tiempo t (para insertar videos pegados). */
function mainIndexAt(p: Project, t: number): number {
  const spans = layout(p.clips);
  const i = spans.findIndex((s) => t < (s.start + s.end) / 2);
  return i < 0 ? p.clips.length : i;
}

/**
 * Agrega archivos en el tiempo `t` según su tipo: videos a la pista principal,
 * audio a una pista de audio libre, imágenes como capa. Con `target` (soltados
 * sobre una pista del timeline) van a esa fila: un video sobre una capa es un
 * picture-in-picture y sobre una pista de audio suma solo su sonido.
 */
export async function importFilesAt(paths: string[], t = useEditor.getState().time, opts: { target?: DropTarget } = {}) {
  const usable = paths.filter((p) => isVideo(p) || isAudio(p) || isImage(p));
  if (!usable.length) {
    pushToast({ severity: "caution", title: "Ese tipo de archivo no se puede agregar", message: "Videos MP4/MOV/MKV/WebM, audio o imágenes PNG/JPG/WebP." });
    return;
  }
  const media = await probeAll(usable);
  if (!media.length) return;
  const target = opts.target;
  const ids: string[] = [];
  try {
    edit((p0) => {
      let p = p0;
      const asAudio = (m: MediaRef) => m.kind === "audio" || (m.kind === "video" && target?.kind === "audio" && m.hasAudio);
      const asPip = (m: MediaRef) => m.kind === "video" && target?.kind === "overlay" && p.clips.length > 0;
      const videos = media.filter((m) => m.kind === "video" && !asAudio(m) && !asPip(m));
      if (videos.length) {
        const before = new Set(p.clips.map((c) => c.id));
        p = insertMedia(p, videos, mainIndexAt(p, t));
        ids.push(...p.clips.filter((c) => !before.has(c.id)).map((c) => c.id));
      }
      if (!p.clips.length) throw new EditError("Agregá un video antes de sumar audio o imágenes.");
      let at = Math.min(t, Math.max(0, totalDuration(p) - 0.2));
      for (const m of media.filter(asAudio)) {
        const before = new Set(p.music.map((x) => x.id));
        p = addMusic(p, m, at);
        const mu = p.music.find((x) => !before.has(x.id))!;
        const prefer = target?.kind === "audio" && target.row >= 0 ? target.row : 0;
        const track = freeMusicTrack(p, mu.start, mu.start + (mu.outPoint - mu.inPoint), prefer, mu.id);
        p = { ...p, music: p.music.map((x) => (x.id === mu.id ? { ...x, track, volume: 1, fadeOut: 0 } : x)) };
        ids.push(mu.id);
      }
      const inLane = (q: Project, id: string) => {
        if (target?.kind !== "overlay" || target.row < 0) return q;
        const o = q.overlays.find((x) => x.id === id)!;
        const busy = q.overlays.some((x) => x.id !== id && x.lane === target.row && x.start < o.start + o.duration - 1e-6 && x.start + x.duration > o.start + 1e-6);
        return busy ? q : { ...q, overlays: q.overlays.map((x) => (x.id === id ? { ...x, lane: target.row } : x)) };
      };
      for (const m of media.filter(asPip)) {
        const [r, id] = addPip(p, m, at);
        p = inLane(r, id);
        ids.push(id);
      }
      for (const m of media.filter((x) => x.kind === "image")) {
        const [r, id] = addImageAt(p, m, at);
        p = inLane(r, id);
        ids.push(id);
        at = Math.min(at + 0.5, Math.max(0, totalDuration(p) - 0.5));
      }
      return p;
    });
  } catch (e) {
    notifyEditError(e);
    return;
  }
  for (const m of media) void ensureWaveform(m);
  setSelection(ids);
  pushToast({ severity: "success", title: media.length === 1 ? `${basename(media[0].path)} agregado` : `${media.length} archivos agregados` });
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Imagen pegada (Win+Shift+S, copiar imagen en el navegador) → capa de imagen. */
export async function pasteImageBlob(blob: Blob) {
  const ext = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";
  try {
    const path = await api.saveClipboardImage(await blobToBase64(blob), ext);
    await importFilesAt([path]);
  } catch (e) {
    notifyError("No se pudo pegar la imagen", e);
  }
}

/** Texto pegado → capa de texto con el estilo de título. */
export function pasteText(text: string) {
  const p = activeProject();
  const clean = text.replace(/\r\n/g, "\n").trim().slice(0, 500);
  if (!p || !clean) return;
  if (!p.clips.length) {
    pushToast({ severity: "caution", title: "Agregá un video antes de sumar textos" });
    return;
  }
  const tpl = TEXT_TEMPLATES.find((x) => x.id === "title") ?? TEXT_TEMPLATES[0];
  let id = "";
  edit((q) => {
    const [r, newId] = addOverlay(q, { ...textFromTemplate(tpl), text: clean, template: null }, useEditor.getState().time, 3);
    id = newId;
    return r;
  });
  setSelection([id]);
  useEditor.setState({ inspectorTab: "text", inspectorOpen: true });
}

export interface PastePayload {
  text: string;
  images: Blob[];
}

/**
 * Pegar: lo copiado en Snip gana; si no, archivos del Explorador, después una
 * imagen y por último texto.
 */
export async function paste(payload?: PastePayload) {
  if (!activeProject() || useEditor.getState().phase !== "editor") return;
  const fromText = parseClipboard(payload?.text);
  if (fromText) return pasteData(fromText);
  if (internal && (!payload || payload.text === internalText || (!payload.text && !payload.images.length))) return pasteData(internal);
  if (hasTauri()) {
    const files = await api.clipboardFiles().catch(() => [] as string[]);
    if (files.length) return importFilesAt(files);
  }
  if (payload?.images.length) return pasteImageBlob(payload.images[0]);
  if (payload?.text.trim()) return pasteText(payload.text);
  if (internal) return pasteData(internal);
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || "").toUpperCase();
  return el.isContentEditable || tag === "TEXTAREA" || (tag === "INPUT" && !["checkbox", "radio", "button", "range"].includes((el as HTMLInputElement).type));
}

let lastPasteEvent = 0;

/** Escucha Ctrl+V (evento `paste` del navegador, con respaldo por teclado). */
export function installPasteHandler(): () => void {
  const onPaste = (e: ClipboardEvent) => {
    if (typing(e.target) || document.querySelector("[data-modal='true']")) return;
    lastPasteEvent = Date.now();
    const dt = e.clipboardData;
    const images: Blob[] = [];
    for (const it of Array.from(dt?.items ?? [])) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) images.push(f);
      }
    }
    e.preventDefault();
    void paste({ text: dt?.getData("text/plain") ?? "", images });
  };
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "v" || typing(e.target)) return;
    // Si el WebView no dispara `paste` (nada enfocado), se lee el portapapeles a mano.
    const at = Date.now();
    window.setTimeout(async () => {
      if (lastPasteEvent >= at) return;
      const payload: PastePayload = { text: "", images: [] };
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const img = it.types.find((x) => x.startsWith("image/"));
          if (img) payload.images.push(await it.getType(img));
          if (it.types.includes("text/plain")) payload.text = await (await it.getType("text/plain")).text();
        }
      } catch {
        try {
          payload.text = await navigator.clipboard.readText();
        } catch {
          /* sin permiso: se pega lo interno */
        }
      }
      if (lastPasteEvent < at) void paste(payload);
    }, 60);
  };
  document.addEventListener("paste", onPaste);
  window.addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("paste", onPaste);
    window.removeEventListener("keydown", onKey);
  };
}


// --------------------------- Menú contextual ---------------------------

/** Menú del clic derecho sobre un elemento del timeline. */
export function itemMenu(id: string, extra: MenuEntry[] = []): MenuEntry[] {
  const tab = activeTab();
  const p = activeProject();
  if (!tab || !p) return [];
  if (!tab.selection.includes(id)) setSelection([id]);
  const sel = activeTab()?.selection ?? [id];
  const grouped = (p.groups ?? []).some((g) => g.some((x) => sel.includes(x)));
  const isClip = p.clips.some((c) => sel.includes(c.id)) || p.music.some((m) => sel.includes(m.id));
  return [
    { label: "Copiar", hint: "Ctrl+C", run: copy, testId: "menu-copy" },
    { label: "Cortar", hint: "Ctrl+X", run: cut, testId: "menu-cut" },
    { label: "Pegar", hint: "Ctrl+V", disabled: !internal, run: () => void paste(), testId: "menu-paste" },
    { label: "Duplicar", hint: "Ctrl+D", run: duplicateSelection, testId: "menu-duplicate" },
    { label: "Pegar efectos", hint: "Ctrl+Alt+V", disabled: !fx || !isClip, run: pasteEffectsToSelection, testId: "menu-paste-effects" },
    "separator",
    grouped
      ? { label: "Desagrupar", hint: "Ctrl+Shift+G", run: ungroupSelection, testId: "menu-ungroup" }
      : { label: "Agrupar", hint: "Ctrl+G", disabled: sel.length < 2, run: groupSelection, testId: "menu-group" },
    ...extra,
    "separator",
    {
      label: "Eliminar",
      hint: "Supr",
      run: () => {
        try {
          const ids = unlockedOnly(p, activeTab()?.selection ?? sel);
          edit((q) => deleteClips(q, ids));
          setSelection([]);
        } catch (e) {
          notifyEditError(e);
        }
      },
      testId: "menu-delete",
    },
  ];
}
