import { useEffect } from "react";
import { onFileDrag } from "../lib/platform";
import { isAudio, isProjectFile, isVideo } from "../lib/files";
import { useEditor } from "../store/editor";
import { addMusicFile, addVideos, openPaths, warnUnsupported } from "../store/controller";

export type DropKind = "open" | "add" | "music" | "invalid";

/** Qué pasaría al soltar estos archivos (para que la zona reaccione antes de soltar). */
export function dropKind(paths: string[], inEditor: boolean): DropKind {
  if (!paths.length) return "invalid";
  if (paths.every((p) => isVideo(p) || isProjectFile(p))) {
    if (inEditor && paths.every(isVideo)) return "add";
    return "open";
  }
  if (inEditor && paths.length === 1 && isAudio(paths[0])) return "music";
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
      if (s.type === "enter") {
        lastKind = dropKind(s.paths, inEditor);
        useEditor.setState({ drag: lastKind === "invalid" ? "invalid" : "valid" });
      } else if (s.type === "leave") {
        useEditor.setState({ drag: "none" });
      } else if (s.type === "drop") {
        const kind = dropKind(s.paths, inEditor);
        if (kind === "invalid") {
          window.setTimeout(() => useEditor.setState({ drag: "none" }), 650);
          warnUnsupported();
          return;
        }
        useEditor.setState({ drag: "none" });
        if (kind === "add") void addVideos(s.paths);
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
