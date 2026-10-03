// Estado global de Snip 2 (Zustand): pestañas con su proyecto e historial,
// selección, rango I/O, reproducción, paneles y datos que llegan de Rust
// (cola, miniaturas, formas de onda, intermedios). Los efectos (hablar con
// Rust) viven en ./controller.ts.

import type { TemplateInfo, VersionInfo } from "../lib/platform";
import { syncWatermarks } from "../project/overlayOps";
import { create } from "zustand";
import { useEffect, useState } from "react";
import type { Project } from "../project/model";
import { fitCanvas } from "../project/ops";
import { beginGesture, cancelGesture, commit, createHistory, endGesture, redo, replace, sameEdit, undo, type History } from "../project/history";
import type { AppError, EncoderInfo, PlatformLimits, ProjectSummary, QueueItem, RecentFile } from "../lib/types";

export type Phase = "welcome" | "editor";
export type Severity = "info" | "success" | "caution" | "critical";
export type DragHint = "none" | "valid" | "invalid";
export type InspectorTab = "clip" | "video" | "audio" | "text" | "export";
/** Edición directa sobre el preview: recorte del clip o ventana de un keyframe de zoom. */
export type ImageEdit = { mode: "crop"; clipId: string } | { mode: "zoom"; clipId: string; keyId: number };

export interface Toast {
  id: number;
  severity: Severity;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
  /** Texto técnico (FFmpeg) para "Ver detalles" y "Copiar". */
  detail?: string | null;
}

/** Dónde caen archivos arrastrados desde el Explorador. */
export interface DropTarget {
  kind: "main" | "overlay" | "audio" | "library";
  /** Fila (capa o pista de audio); -1 = la primera libre. */
  row: number;
  time: number;
}

export interface Tab {
  id: string;
  history: History;
  /** `.snip` asociado (Ctrl+S). */
  file: string | null;
  /** Firma de la última versión guardada o exportada (para saber si hay cambios). */
  saved: string | null;
  selection: string[];
  markIn: number | null;
  markOut: number | null;
  /** Medios cuyo archivo no está (se movió o se borró). */
  missing: string[];
}

export interface Confirm {
  /** Cada pedido tiene su id: si uno abre mientras el anterior se cierra, no se mezclan. */
  id: number;
  title: string;
  body: string;
  primary: string;
  secondary?: string;
  tertiary?: string;
  danger?: boolean;
  resolve: (choice: "primary" | "secondary" | "tertiary" | "cancel") => void;
}

export type ProcState = { status: "pending"; percent: number; sig: string } | { status: "ready"; path: string; sig: string } | { status: "error"; error: AppError; sig: string };

export interface EditorState {
  phase: Phase;
  tabs: Tab[];
  active: string | null;
  opening: boolean;

  time: number;
  playing: boolean;
  loop: boolean;
  volume: number;
  muted: boolean;

  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  queueOpen: boolean;
  shortcutsOpen: boolean;

  queue: QueueItem[];
  unfinished: ProjectSummary[];
  recent: RecentFile[];
  encoder: EncoderInfo | null;
  limits: PlatformLimits | null;

  /** Etapa pesada por clip (preview). */
  heavy: Record<string, ProcState>;
  /** Proxy de preview por ruta de medio (HEVC sin soporte). */
  proxies: Record<string, ProcState>;
  thumbs: Record<string, string>;
  waveforms: Record<string, Uint8Array>;

  imageEdit: ImageEdit | null;
  /** Subtítulos automáticos en curso (descarga del modelo, audio, transcripción). */
  autoSubs: { phase: "download" | "audio" | "transcribing"; percent: number; detail?: string } | null;

  drag: DragHint;
  /** Pista y tiempo bajo el puntero al arrastrar archivos sobre el timeline. */
  dropTarget: DropTarget | null;
  /** Diálogo de proyecto abierto (versiones, plantillas). */
  projectDialog: "version" | "versions" | "template" | "templates" | null;
  versions: VersionInfo[];
  templates: TemplateInfo[];
  /** Progreso de "Empaquetar proyecto" (null = no hay). */
  packaging: number | null;
  /** Exportar como proyecto .snip (formato de la pestaña Exportar). */
  exportAsSnip: boolean;
  /** Biblioteca de medios (panel izquierdo). */
  libraryOpen: boolean;
  /** Visor de origen abierto (id del medio). */
  sourceMedia: string | null;
  /** Gotero del chroma key activo sobre este PiP (id de la capa). */
  eyedropper: string | null;
  toasts: Toast[];
  focused: boolean;
  confirm: Confirm | null;
}

export const initialState: EditorState = {
  phase: "welcome",
  tabs: [],
  active: null,
  opening: false,
  time: 0,
  playing: false,
  loop: false,
  volume: 0.8,
  muted: false,
  inspectorOpen: true,
  inspectorTab: "clip",
  queueOpen: false,
  shortcutsOpen: false,
  queue: [],
  unfinished: [],
  recent: [],
  encoder: null,
  limits: null,
  heavy: {},
  proxies: {},
  thumbs: {},
  waveforms: {},
  imageEdit: null,
  autoSubs: null,
  drag: "none",
  dropTarget: null,
  projectDialog: null,
  versions: [],
  templates: [],
  packaging: null,
  exportAsSnip: false,
  libraryOpen: false,
  sourceMedia: null,
  eyedropper: null,
  toasts: [],
  focused: true,
  confirm: null,
};

function loadVolume(): Pick<EditorState, "volume" | "muted"> {
  try {
    const raw = localStorage.getItem("snip.volume");
    if (raw) {
      const v = JSON.parse(raw);
      return { volume: Math.min(1, Math.max(0, Number(v.volume) || 0)), muted: !!v.muted };
    }
  } catch {
    /* sin storage */
  }
  return { volume: 0.8, muted: false };
}

export function saveVolume(volume: number, muted: boolean) {
  try {
    localStorage.setItem("snip.volume", JSON.stringify({ volume, muted }));
  } catch {
    /* sin storage */
  }
}

export const useEditor = create<EditorState>()(() => ({ ...initialState, ...loadVolume() }));

// ------------------------------- Selectores -------------------------------

export function activeTab(s: EditorState = useEditor.getState()): Tab | null {
  return s.tabs.find((t) => t.id === s.active) ?? null;
}

export function activeProject(s: EditorState = useEditor.getState()): Project | null {
  return activeTab(s)?.history.present ?? null;
}

export function useProject(): Project | null {
  return useEditor((s) => activeTab(s)?.history.present ?? null);
}

/**
 * El proyecto activo, pero solo re-renderiza cuando cambia algo que no sea la
 * vista (zoom/scroll del timeline): para el preview, el transporte y el inspector.
 */
export function useProjectSansView(): Project | null {
  const [p, setP] = useState(() => activeProject());
  useEffect(() => {
    let last = activeProject();
    let sig = last ? JSON.stringify({ ...last, view: null }) : "";
    setP(last);
    return useEditor.subscribe((s) => {
      const next = activeTab(s)?.history.present ?? null;
      if (next === last) return;
      const nsig = next ? JSON.stringify({ ...next, view: null }) : "";
      last = next;
      if (nsig === sig) return;
      sig = nsig;
      setP(next);
    });
  }, []);
  return p;
}

export function useTab(): Tab | null {
  return useEditor((s) => activeTab(s));
}

/** Firma de la edición (sin vista ni fechas) para comparar con lo guardado. */
export function editSignature(p: Project): string {
  return JSON.stringify({ ...p, view: null, updatedAt: 0, exportedAt: null });
}

export function isDirty(t: Tab): boolean {
  const p = t.history.present;
  if (p.clips.length === 0) return false;
  return t.saved === null || t.saved !== editSignature(p);
}

// ------------------------------ Mutaciones ------------------------------

function updateTab(id: string | null, f: (t: Tab) => Tab) {
  if (!id) return;
  useEditor.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? f(t) : t)) }));
}

/** Aplica una edición al proyecto activo como un paso del historial. */
export function edit(f: (p: Project) => Project) {
  const s = useEditor.getState();
  const tab = activeTab(s);
  if (!tab) return;
  const before = tab.history.present;
  const changed = f(before);
  if (changed === before) return;
  // El lienzo automático sigue al primer clip (si se rota, recorta, borra o reordena).
  const next = syncWatermarks(fitCanvas(changed));
  const stamped = sameEdit(next, before) ? next : { ...next, updatedAt: Date.now() };
  updateTab(tab.id, (t) => ({ ...t, history: commit(t.history, stamped) }));
}

/** Cambia el proyecto sin generar un paso (vista, exportación). */
export function patchProject(f: (p: Project) => Project) {
  const tab = activeTab();
  if (!tab) return;
  updateTab(tab.id, (t) => ({ ...t, history: replace(t.history, f(t.history.present)) }));
}

export function gestureStart() {
  const tab = activeTab();
  if (tab) updateTab(tab.id, (t) => ({ ...t, history: beginGesture(t.history) }));
}

export function gestureEnd() {
  const tab = activeTab();
  if (tab) updateTab(tab.id, (t) => ({ ...t, history: endGesture(t.history) }));
}

export function gestureCancel() {
  const tab = activeTab();
  if (tab) updateTab(tab.id, (t) => ({ ...t, history: cancelGesture(t.history) }));
}

export function undoEdit() {
  const tab = activeTab();
  if (tab) updateTab(tab.id, (t) => ({ ...t, history: undo(t.history), selection: [] }));
}

export function redoEdit() {
  const tab = activeTab();
  if (tab) updateTab(tab.id, (t) => ({ ...t, history: redo(t.history), selection: [] }));
}

export function setSelection(ids: string[]) {
  const tab = activeTab();
  if (!tab) return;
  // Elegir un elemento agrupado elige todo el grupo.
  const groups = tab.history.present.groups ?? [];
  const all = new Set(ids);
  for (const g of groups) if (g.some((id) => all.has(id))) for (const id of g) all.add(id);
  const next = all.size === ids.length ? ids : [...all];
  updateTab(tab.id, (t) => ({ ...t, selection: next }));
}

export function setMarks(markIn: number | null, markOut: number | null) {
  const tab = activeTab();
  if (tab) updateTab(tab.id, (t) => ({ ...t, markIn, markOut }));
}

export function markSaved(id: string, file: string | null = null) {
  updateTab(id, (t) => ({ ...t, saved: editSignature(t.history.present), file: file ?? t.file }));
}

export function setMissing(id: string, missing: string[]) {
  updateTab(id, (t) => ({ ...t, missing }));
}

/** Abre una pestaña nueva (o activa la existente con el mismo proyecto). */
export function openTab(p: Project, opts: { file?: string | null; saved?: boolean; missing?: string[] } = {}) {
  const s = useEditor.getState();
  if (s.tabs.some((t) => t.id === p.id)) {
    useEditor.setState({ active: p.id, phase: "editor" });
    return;
  }
  const tab: Tab = {
    id: p.id,
    history: createHistory(p),
    file: opts.file ?? null,
    saved: opts.saved ? editSignature(p) : null,
    selection: [],
    markIn: null,
    markOut: null,
    missing: opts.missing ?? [],
  };
  useEditor.setState({ tabs: [...s.tabs, tab], active: p.id, phase: "editor", time: p.view.playhead, playing: false });
}

export function closeTabState(id: string) {
  const s = useEditor.getState();
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tabs = s.tabs.filter((t) => t.id !== id);
  let active = s.active;
  if (active === id) active = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
  useEditor.setState({ tabs, active, phase: tabs.length ? "editor" : "welcome" });
}

let toastId = 1;
export function pushToast(t: Omit<Toast, "id">): number {
  const id = toastId++;
  useEditor.setState((s) => ({ toasts: [...s.toasts.filter((x) => x.title !== t.title), { ...t, id }].slice(-3) }));
  return id;
}

export function dismissToast(id: number) {
  useEditor.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

let confirmSeq = 1;

/** Diálogo de confirmación como promesa. */
export function ask(c: Omit<Confirm, "resolve" | "id">): Promise<"primary" | "secondary" | "tertiary" | "cancel"> {
  return new Promise((resolve) => {
    useEditor.setState({
      confirm: {
        ...c,
        id: confirmSeq++,
        resolve: (choice) => {
          useEditor.setState({ confirm: null });
          resolve(choice);
        },
      },
    });
  });
}

export function resetEditor() {
  useEditor.setState({ ...initialState, ...loadVolume() });
}
