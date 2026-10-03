import { useEffect } from "react";
import { onFileDrag } from "../lib/platform";
import { isAudio, isImage, isProjectFile, isVideo } from "../lib/files";
import { useEditor } from "../store/editor";
import { addMusicFile, addVideos, openPaths, warnUnsupported } from "../store/controller";
import { importFilesAt } from "../store/clipboard";
import { dropTargetAt } from "../components/timeline/dropTarget";

export type DropKind = "open" | "add" | "music" | "invalid";

/** Qué pasaría al soltar estos archivos (para que la zona reaccione antes de soltar). */
export function dropKind(paths: string[], inEditor: boolean): DropKind {
  if (!paths.length) return "invalid";
  if (paths.every((p) => isVideo(p) || isProjectFile(p))) {
    if (inEditor && paths.every(isVideo)) return "add";
    return "open";
  }
  if (inEditor && paths.length === 1 && isAudio(paths[0])) return "music";
  // En el editor se puede soltar cualquier mezcla de videos, audio e imágenes.
  if (inEditor && paths.every((p) => isVideo(p) || isAudio(p) || isImage(p))) return "add";
  return "invalid";
}

/** Drag & drop de archivos sobre la ventana. */
export function useDragDrop() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let lastKind: DropKind = "invalid";
    onFileDrag((s) => {
      const st = useEditor.getState();
      const inEditor = st.phase === "editor";
      const target = (pos?: { x: number; y: number }) => (inEditor && lastKind !== "invalid" && pos ? dropTargetAt(pos.x, pos.y) : null);
      if (s.type === "enter") {
        lastKind = dropKind(s.paths, inEditor);
        useEditor.setState({ drag: lastKind === "invalid" ? "invalid" : "valid", dropTarget: target(s.pos) });
      } else if (s.type === "over") {
        const t = target(s.pos);
        const cur = st.dropTarget;
        if (JSON.stringify(t) !== JSON.stringify(cur)) useEditor.setState({ dropTarget: t });
      } else if (s.type === "leave") {
        useEditor.setState({ drag: "none", dropTarget: null });
      } else if (s.type === "drop") {
        const kind = dropKind(s.paths, inEditor);
        if (kind === "invalid") {
          window.setTimeout(() => useEditor.setState({ drag: "none" }), 650);
          warnUnsupported();
          return;
        }
        useEditor.setState({ drag: "none", dropTarget: null });
        // Soltado sobre una pista: va a esa pista, en ese tiempo.
        const t = inEditor ? (s.pos ? dropTargetAt(s.pos.x, s.pos.y) : null) : null;
        if (t) {
          void importFilesAt(s.paths, t.time, { target: t });
          return;
        }
        if (kind === "add" && !s.paths.every(isVideo)) void importFilesAt(s.paths);
        else if (kind === "add") void addVideos(s.paths);
        else if (kind === "music") void addMusicFile(s.paths[0]);
        else void openPaths(s.paths);
      }
    })
      .then((u) => {
        if (cancelled) u();
        else {
          unlisten = u;
          document.documentElement.dataset.dnd = "ready";
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/** Tipo de drop en curso (para los textos de la capa de drop). */
export function useDropKindLabel(): DropKind {
  return useEditor((s) => (s.drag === "invalid" ? "invalid" : s.phase === "editor" ? "add" : "open"));
}
