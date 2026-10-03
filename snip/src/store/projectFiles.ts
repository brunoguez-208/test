// Proyecto como archivo: versiones (manuales y automáticas al exportar),
// empaquetar con los medios, y plantillas (intro, outro, estilos de texto y
// preset de exportación) para arrancar proyectos nuevos.

import { api, pickFiles, pickFolder, pickSavePath, events, type TemplateInfo, type VersionInfo } from "../lib/platform";
import { basename, formatBytes, safeFileName } from "../lib/files";
import type { Clip, ExportSettings, MediaRef, Overlay, Project, SubtitleStyle } from "../project/model";
import { fitCanvas, insertMedia, makeId, newProject } from "../project/ops";
import { syncWatermarks } from "../project/overlayOps";
import { activeProject, activeTab, edit, openTab, pushToast, useEditor } from "./editor";
export type { TemplateInfo, VersionInfo };
import { afterProjectLoaded, notifyError, projectThumb } from "./controller";

// ------------------------------- Versiones -------------------------------

export async function saveVersion(name: string | null) {
  const p = activeProject();
  if (!p || !p.clips.length) return;
  try {
    const v = await api.saveVersion(p, name, false, projectThumb(p));
    pushToast({ severity: "success", title: "Versión guardada", message: v.name ?? "Sin nombre" });
    await refreshVersions();
  } catch (e) {
    notifyError("No se pudo guardar la versión", e);
  }
}

export async function refreshVersions(): Promise<VersionInfo[]> {
  const p = activeProject();
  if (!p) return [];
  const list = await api.listVersions(p.id).catch(() => [] as VersionInfo[]);
  useEditor.setState({ versions: list });
  return list;
}

/** Vuelve a una versión: es una edición más (se deshace con Ctrl+Z) y no toca las otras versiones. */
export async function restoreVersion(v: VersionInfo) {
  const p = activeProject();
  if (!p) return;
  try {
    const old = await api.loadVersion(v.projectId, v.id);
    edit(() => ({ ...old, id: p.id, createdAt: p.createdAt, view: p.view }));
    afterProjectLoaded(activeProject()!);
    pushToast({ severity: "success", title: "Versión restaurada", message: "Ctrl+Z vuelve a como estaba." });
  } catch (e) {
    notifyError("No se pudo abrir la versión", e);
  }
}

// ------------------------------- Empaquetar -------------------------------

/** "Empaquetar proyecto": carpeta o ZIP con el .snip y copias de los medios (rutas relativas). */
export async function packageProject(zip: boolean) {
  const p = activeProject();
  if (!p || !p.clips.length) return;
  const name = safeFileName(p.name || "proyecto");
  let dest: string | null;
  if (zip) dest = await pickSavePath("Empaquetar proyecto en un ZIP", `${name}.zip`, [{ name: "ZIP", extensions: ["zip"] }]).catch(() => null);
  else dest = await pickFolder("Elegí dónde crear la carpeta del proyecto").catch(() => null);
  if (!dest) return;
  useEditor.setState({ packaging: 0 });
  const off = await events.onPackageProgress((e) => useEditor.setState({ packaging: e.percent }));
  try {
    const r = await api.packageProject(p, dest, zip);
    pushToast({
      severity: "success",
      title: "Proyecto empaquetado",
      message: `${basename(r.path)} · ${r.files} archivos · ${formatBytes(r.bytes)}`,
      action: { label: "Mostrar", run: () => void api.revealInFolder(r.path).catch(() => {}) },
    });
  } catch (e) {
    notifyError("No se pudo empaquetar el proyecto", e);
  } finally {
    off();
    useEditor.setState({ packaging: null });
  }
}

// ------------------------------- Plantillas -------------------------------

export interface TemplateData {
  v: 1;
  media: MediaRef[];
  intro: Clip | null;
  outro: Clip | null;
  /** Textos (y logos/marcas de agua) con su estilo y su tiempo desde el inicio. */
  overlays: Overlay[];
  subtitleStyle: SubtitleStyle | null;
  export: ExportSettings | null;
}

export interface TemplateChoice {
  name: string;
  intro: boolean;
  outro: boolean;
  texts: boolean;
  exportPreset: boolean;
}

/** Arma los datos de la plantilla a partir del proyecto. */
export function templateFrom(p: Project, c: TemplateChoice): TemplateData {
  const intro = c.intro && p.clips.length > 1 ? p.clips[0] : null;
  const outro = c.outro && p.clips.length > 1 ? p.clips[p.clips.length - 1] : null;
  const overlays = c.texts ? p.overlays.filter((o) => o.type === "text" || o.type === "image") : [];
  const ids = new Set<string>([intro?.mediaId, outro?.mediaId].filter((x): x is string => !!x));
  for (const o of overlays) if (o.type === "image") ids.add(o.mediaId);
  return {
    v: 1,
    media: p.media.filter((m) => ids.has(m.id)),
    intro,
    outro,
    overlays,
    subtitleStyle: c.texts ? p.subtitles.style : null,
    export: c.exportPreset ? p.export : null,
  };
}

export function templateSummary(d: TemplateData): string {
  const parts: string[] = [];
  if (d.intro) parts.push("intro");
  if (d.outro) parts.push("outro");
  const texts = d.overlays.filter((o) => o.type === "text").length;
  if (texts) parts.push(texts === 1 ? "1 texto" : `${texts} textos`);
  if (d.overlays.some((o) => o.type === "image")) parts.push("logo");
  if (d.export) parts.push(`exporta ${d.export.format.toUpperCase()}${d.export.sizeTarget ? ` ≤ ${d.export.sizeTarget.megabytes} MB` : ""}`);
  return parts.join(" · ") || "estilos";
}

export async function saveTemplate(c: TemplateChoice) {
  const p = activeProject();
  if (!p) return;
  const data = templateFrom(p, c);
  try {
    await api.saveTemplate(c.name.trim() || p.name || "Plantilla", templateSummary(data), data, projectThumb(p));
    pushToast({ severity: "success", title: "Plantilla guardada", message: "Aparece en «Nuevo desde plantilla» al abrir Snip." });
    await refreshTemplates();
  } catch (e) {
    notifyError("No se pudo guardar la plantilla", e);
  }
}

export async function refreshTemplates(): Promise<TemplateInfo[]> {
  const list = await api.listTemplates().catch(() => [] as TemplateInfo[]);
  useEditor.setState({ templates: list });
  return list;
}

/** Proyecto nuevo: intro + los videos elegidos + outro, con textos, estilo de subtítulos y exportación. */
export function projectFromTemplate(d: TemplateData, videos: MediaRef[], now = Date.now()): Project {
  const ids = new Map<string, string>();
  const media = d.media.map((m) => {
    const id = makeId("m");
    ids.set(m.id, id);
    return { ...m, id };
  });
  let p = insertMedia(newProject(now), videos);
  p = { ...p, media: [...p.media, ...media] };
  const copyClip = (c: Clip): Clip => ({ ...c, id: makeId("c"), mediaId: ids.get(c.mediaId) ?? c.mediaId, transition: null });
  p = { ...p, clips: [...(d.intro ? [copyClip(d.intro)] : []), ...p.clips, ...(d.outro ? [copyClip(d.outro)] : [])] };
  const overlays = d.overlays.map((o) => ({ ...o, id: makeId("o"), ...(o.type === "image" ? { mediaId: ids.get(o.mediaId) ?? o.mediaId } : {}) }) as Overlay);
  p = { ...p, overlays, subtitles: d.subtitleStyle ? { ...p.subtitles, style: d.subtitleStyle } : p.subtitles };
  if (d.export) p = { ...p, export: d.export };
  return p;
}

export async function newFromTemplate(t: TemplateInfo) {
  try {
    const d = (await api.loadTemplate(t.id)) as TemplateData;
    const paths = await pickFiles(`Videos para «${t.name}»`, [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "webm"] }], true);
    if (!paths.length) return;
    const videos: MediaRef[] = [];
    for (const path of paths) videos.push(await api.probeMedia(path, makeId("m")));
    // edit() ajusta el lienzo y las marcas de agua; se abre como pestaña nueva.
    const p = syncWatermarks(fitCanvas(projectFromTemplate(d, videos)));
    openTab({ ...p, name: p.name || t.name });
    afterProjectLoaded(p);
    useEditor.setState({ projectDialog: null });
  } catch (e) {
    notifyError("No se pudo usar la plantilla", e);
  }
}

export function currentTabFile(): string | null {
  return activeTab()?.file ?? null;
}
