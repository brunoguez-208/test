import { useEffect } from "react";
import { api, events, hasTauri, onWindowFocus } from "../lib/platform";
import { applyMaterial, applyPalette, systemPrefersDark } from "../lib/theme";
import { useEditor } from "../store/editor";
import { openPaths, refreshWelcome, startQueueListener, startSync } from "../store/controller";

/** Tema/acento de Windows, foco, archivo de arranque, "Abrir con" en caliente, cola y autoguardado. */
export function useAppShell() {
  useEffect(() => {
    const offs: Promise<() => void>[] = [];
    const stopSync = startSync();

    const mq = matchMedia("(prefers-color-scheme: dark)");
    const fromMedia = () => (document.documentElement.dataset.theme = systemPrefersDark() ? "dark" : "light");
    if (hasTauri()) {
      api
        .getAppearance()
        .then((a) => {
          applyMaterial(a.material);
          applyPalette(a.palette);
        })
        .catch(() => {
          applyMaterial("none");
          fromMedia();
        });
      offs.push(events.onThemeChanged(applyPalette));
    } else {
      applyMaterial("none");
      fromMedia();
      mq.addEventListener("change", fromMedia);
    }

    const setFocused = (f: boolean) => {
      document.documentElement.dataset.focused = String(f);
      useEditor.setState({ focused: f });
    };
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (hasTauri()) {
      offs.push(onWindowFocus(setFocused));
      // Otro "Abrir con" mientras Snip ya está abierto (single instance): pestaña nueva.
      offs.push(events.onOpenFile((p) => void openPaths([p])));
      api
        .takeLaunchFile()
        .then((p) => {
          if (p) void openPaths([p]);
        })
        .catch(() => {});
      void refreshWelcome();
      void startQueueListener();
    }

    return () => {
      stopSync();
      mq.removeEventListener("change", fromMedia);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      offs.forEach((p) => p.then((u) => u()).catch(() => {}));
    };
  }, []);
}
