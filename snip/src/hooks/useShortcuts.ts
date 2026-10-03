import { useEffect } from "react";
import { shortcutFor } from "../lib/shortcuts";
import { useSnip } from "../store/snip";
import { openWithDialog, startExport } from "../store/controller";
import { shuttle, stepFrames, stepSeconds, togglePlay } from "../lib/playback";

/** Atajos globales. Se ignoran mientras se escribe en un input o hay un diálogo abierto. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const st = useSnip.getState();
      if (st.confirmation) return;
      const action = shortcutFor(e, e.target as HTMLElement | null);
      if (!action) return;

      // Los que no necesitan un video cargado.
      if (action.type === "open") {
        e.preventDefault();
        void openWithDialog();
        return;
      }
      if (st.phase !== "editor" || !st.media) return;
      const busy = st.exportState.status === "running";
      e.preventDefault();
      if (e.repeat && (action.type === "togglePlay" || action.type === "export" || action.type === "shuttle")) return;

      switch (action.type) {
        case "togglePlay":
          togglePlay();
          break;
        case "markIn":
          if (!busy) st.markIn();
          break;
        case "markOut":
          if (!busy) st.markOut();
          break;
        case "stepFrames":
          stepFrames(action.frames);
          break;
        case "stepSeconds":
          stepSeconds(action.seconds);
          break;
        case "shuttle":
          shuttle(action.key);
          break;
        case "export":
          if (!busy) void startExport();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
