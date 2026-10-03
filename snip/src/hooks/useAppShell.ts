import { useEffect } from "react";
import { api, events, hasTauri, onWindowFocus } from "../lib/platform";
import { applyMaterial, applyPalette, systemPrefersDark } from "../lib/theme";
import { useSnip } from "../store/snip";
import { openFile } from "../store/controller";

/** Tema/acento de Windows, foco de la ventana, archivo de arranque y "Abrir con" en caliente. */
export function useAppShell() {
  useEffect(() => {
    const offs: Promise<() => void>[] = [];

    // Tema y material. Sin Rust (navegador), seguimos prefers-color-scheme.
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

    // Título atenuado cuando la ventana pierde el foco.
    const setFocused = (f: boolean) => {
      document.documentElement.dataset.focused = String(f);
      useSnip.setState({ focused: f });
    };
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (hasTauri()) offs.push(onWindowFocus(setFocused));

    // Otro "Abrir con" mientras Snip ya está abierto (single instance).
    if (hasTauri()) offs.push(events.onOpenFile((p) => void openFile(p)));

    // Archivo con el que se lanzó la app.
    if (hasTauri()) {
      api
        .takeLaunchFile()
        .then((p) => {
          if (p) void openFile(p);
        })
        .catch(() => {});
    }

    return () => {
      mq.removeEventListener("change", fromMedia);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      offs.forEach((p) => p.then((u) => u()).catch(() => {}));
    };
  }, []);
}
