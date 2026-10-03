import { useEffect } from "react";
import { onFileDrag } from "../lib/platform";
import { isMp4 } from "../lib/files";
import { useSnip } from "../store/snip";
import { openFile, warnNotMp4 } from "../store/controller";

/** Drag & drop de archivos sobre la ventana: reacciona distinto si no es MP4. */
export function useDragDrop() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const set = (drag: "none" | "valid" | "invalid") => useSnip.setState({ drag });
    onFileDrag((s) => {
      if (s.type === "enter") {
        const ok = s.paths.length === 1 && isMp4(s.paths[0]);
        set(ok ? "valid" : "invalid");
      } else if (s.type === "leave") {
        set("none");
      } else if (s.type === "drop") {
        const ok = s.paths.length === 1 && isMp4(s.paths[0]);
        if (ok) {
          set("none");
          void openFile(s.paths[0]);
        } else {
          // Dejamos ver la animación de "se cierra" un instante.
          window.setTimeout(() => set("none"), 650);
          if (s.paths.length > 1 && s.paths.some(isMp4)) {
            useSnip.getState().pushToast({ severity: "caution", title: "Un video a la vez", message: "Soltá un solo archivo .mp4." });
          } else {
            warnNotMp4();
          }
        }
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
