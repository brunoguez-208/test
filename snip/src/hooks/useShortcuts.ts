import { useEffect } from "react";
import { nextShuttleRate, shortcutFor, type ShortcutAction } from "../lib/shortcuts";
import { activeProject, activeTab, edit, redoEdit, setMarks, setSelection, undoEdit, useEditor } from "../store/editor";
import {
  closeTab,
  enqueueExport,
  notifyEditError,
  openWithDialog,
  player,
  saveProject,
  setImageEdit,
  switchTab,
} from "../store/controller";
import { addMarker, adjacentMarker, deleteClips, deleteRange, splitAt } from "../project/ops";
import { totalDuration } from "../project/timeline";
import { zoomTimeline } from "../components/timeline/zoom";
import { audioUnder, splitMusicAt } from "../project/audioOps";
import { copy, cut, duplicateSelection, groupSelection, pasteEffectsToSelection, ungroupSelection } from "../store/clipboard";

let shuttleRate = 0;

/** Ejecuta un atajo (exportado para los tests). */
export function runShortcut(action: ShortcutAction, repeat = false): boolean {
  const st = useEditor.getState();
  if (action.type === "open") {
    void openWithDialog();
    return true;
  }
  if (action.type === "help") {
    useEditor.setState({ shortcutsOpen: !st.shortcutsOpen });
    return true;
  }
  if (action.type === "nextTab" || action.type === "prevTab") {
    switchTab(action.type === "nextTab" ? 1 : -1);
    return true;
  }
  const tab = activeTab(st);
  const p = activeProject(st);
  if (st.phase !== "editor" || !tab || !p) return false;
  if (repeat && ["togglePlay", "export", "shuttle", "split", "marker", "save", "closeTab", "delete", "copy", "cut", "duplicate", "pasteEffects", "group", "ungroup"].includes(action.type)) return true;
  // Recorte / zoom sobre el preview: Esc sale; deshacer descarta el recorte;
  // cualquier otra edición primero lo confirma.
  if (st.imageEdit) {
    if (action.type === "escape") {
      setImageEdit(null, st.imageEdit.mode === "crop" ? "cancel" : "done");
      return true;
    }
    if (st.imageEdit.mode === "crop" && (action.type === "undo" || action.type === "redo")) {
      setImageEdit(null, "cancel");
      return true;
    }
    if (["split", "delete", "marker", "undo", "redo", "export", "save", "closeTab"].includes(action.type)) setImageEdit(null);
  }
  const pl = player();
  const t = st.time;
  // Con texto seleccionado en la página (detalles de un error), Ctrl+C copia el texto.
  if (action.type === "copy" && (window.getSelection()?.toString() ?? "") !== "") return false;
  switch (action.type) {
    case "copy":
      return copy();
    case "cut":
      return cut();
    case "duplicate":
      return duplicateSelection();
    case "pasteEffects":
      return pasteEffectsToSelection();
    case "group":
      return groupSelection();
    case "ungroup":
      return ungroupSelection();
    case "togglePlay":
      shuttleRate = 0;
      pl.toggle();
      break;
    case "shuttle":
      shuttleRate = nextShuttleRate(pl.playing ? pl.rate : 0, action.key);
      pl.setRate(shuttleRate);
      break;
    case "stepFrames":
      pl.step(action.frames);
      break;
    case "stepSeconds":
      pl.pause();
      pl.seek(t + action.seconds);
      break;
    case "home":
      pl.pause();
      pl.seek(0);
      break;
    case "end":
      pl.pause();
      pl.seek(totalDuration(p));
      break;
    case "markIn":
      setMarks(t, tab.markOut !== null && tab.markOut <= t ? null : tab.markOut);
      break;
    case "markOut": {
      const end = Math.min(totalDuration(p), t + pl.frameDur());
      setMarks(tab.markIn !== null && tab.markIn >= end ? null : tab.markIn, end);
      break;
    }
    case "split":
      try {
        // Con audio elegido bajo el playhead, S divide ese audio; si no, el clip de video.
        const audio = audioUnder(p, tab.selection, t);
        if (audio.length) edit((q) => audio.reduce((r, id) => splitMusicAt(r, id, t), q));
        else edit((q) => splitAt(q, t));
      } catch (e) {
        notifyEditError(e);
      }
      break;
    case "delete":
      try {
        if (tab.selection.length) {
          edit((q) => deleteClips(q, tab.selection));
          setSelection([]);
        } else if (tab.markIn !== null || tab.markOut !== null) {
          edit((q) => deleteRange(q, tab.markIn ?? 0, tab.markOut ?? totalDuration(q)));
          setMarks(null, null);
        }
      } catch (e) {
        notifyEditError(e);
      }
      break;
    case "marker":
      edit((q) => addMarker(q, t));
      break;
    case "nextMarker":
    case "prevMarker": {
      const m = adjacentMarker(p, t, action.type === "nextMarker" ? 1 : -1);
      if (m !== null) {
        pl.pause();
        pl.seek(m);
      }
      break;
    }
    case "undo":
      undoEdit();
      break;
    case "redo":
      redoEdit();
      break;
    case "save":
      void saveProject();
      break;
    case "export":
      void enqueueExport();
      break;
    case "zoomIn":
      zoomTimeline(1.5);
      break;
    case "zoomOut":
      zoomTimeline(1 / 1.5);
      break;
    case "closeTab":
      void closeTab(tab.id);
      break;
    case "escape":
      if (tab.selection.length) setSelection([]);
      else if (tab.markIn !== null || tab.markOut !== null) setMarks(null, null);
      else if (st.queueOpen) useEditor.setState({ queueOpen: false });
      else return false;
      break;
    default:
      return false;
  }
  return true;
}

/** Atajos globales. Se ignoran mientras se escribe o hay un diálogo abierto. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (useEditor.getState().confirm) return;
      if (document.querySelector("[data-modal='true']")) return;
      const action = shortcutFor(e, e.target as HTMLElement | null);
      if (!action) return;
      if (runShortcut(action, e.repeat)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
