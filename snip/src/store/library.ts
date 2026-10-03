// Biblioteca de medios: importar sin poner en el timeline y llevar un medio
// (entero o un tramo) a cualquier pista.

import { api, pickFiles } from "../lib/platform";
import { basename, isAudio, isImage, isVideo } from "../lib/files";
import { addToLibrary, placeMedia } from "../project/library";
import { makeId } from "../project/ops";
import type { MediaRef } from "../project/model";
import { activeProject, edit, pushToast, setSelection, useEditor, type DropTarget } from "./editor";
import { ensureWaveform, notifyEditError, notifyError } from "./controller";

export const LIBRARY_FILTER = { name: "Videos, audio e imágenes", extensions: ["mp4", "mov", "mkv", "webm", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "png", "jpg", "jpeg", "webp"] };

/** Suma archivos a la biblioteca (sin tocar el timeline). */
export async function importToLibrary(paths: string[]) {
  if (!activeProject()) return;
  const usable = paths.filter((p) => isVideo(p) || isAudio(p) || isImage(p));
  if (!usable.length) {
    pushToast({ severity: "caution", title: "Ese tipo de archivo no se puede importar", message: "Videos MP4/MOV/MKV/WebM, audio o imágenes PNG/JPG/WebP." });
    return;
  }
  const media: MediaRef[] = [];
  for (const path of usable) {
    try {
      media.push(await api.probeMedia(path, makeId("m")));
    } catch (e) {
      notifyError(`No se pudo importar ${basename(path)}`, e);
    }
  }
  if (!media.length) return;
  edit((p) => addToLibrary(p, media));
  for (const m of media) void ensureWaveform(m);
  useEditor.setState({ libraryOpen: true });
  pushToast({ severity: "success", title: media.length === 1 ? `${basename(media[0].path)} en la biblioteca` : `${media.length} archivos en la biblioteca` });
}

export async function importToLibraryWithDialog() {
  try {
    const paths = await pickFiles("Importar a la biblioteca", [LIBRARY_FILTER], true);
    if (paths.length) await importToLibrary(paths);
  } catch (e) {
    notifyError("No se pudo abrir el diálogo", e);
  }
}

/** Lleva un medio de la biblioteca (o un tramo, desde el visor) al timeline. */
export function placeFromLibrary(mediaId: string, t: number, target?: DropTarget | null, range?: [number, number] | null) {
  const p = activeProject();
  const m = p?.media.find((x) => x.id === mediaId);
  if (!p || !m) return;
  try {
    let ids: string[] = [];
    edit((q) => {
      const [r, n] = placeMedia(q, [m], t, target && target.kind !== "library" ? target : null, range);
      ids = n;
      return r;
    });
    setSelection(ids);
  } catch (e) {
    notifyEditError(e);
  }
}

/** ¿El puntero o el foco están en la biblioteca? (Ctrl+V importa ahí). */
let overLibrary = false;
export function setOverLibrary(v: boolean) {
  overLibrary = v;
}
export function libraryActive(): boolean {
  if (!useEditor.getState().libraryOpen) return false;
  return overLibrary || !!document.activeElement?.closest("[data-library]");
}
