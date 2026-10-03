import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauri } from "../lib/platform";

// Glifos de Segoe Fluent Icons (los mismos que usa Windows 11).
const GLYPH = { minimize: "", maximize: "", restore: "", close: "" };

/**
 * Minimizar / maximizar / cerrar. Un solo juego, dibujado por la app (antes
 * los inyectaba decorum y DWM pintaba otros detrás: al maximizar se veían
 * los dos corridos). Pasar el mouse por maximizar abre Snap Layouts.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const snapTimer = useRef<number | undefined>(undefined);
  const target = document.getElementById("titlebar");

  useEffect(() => {
    if (!hasTauri()) return;
    const win = getCurrentWindow();
    let off: (() => void) | undefined;
    let alive = true;
    const sync = () => void win.isMaximized().then((m) => alive && setMaximized(m)).catch(() => {});
    sync();
    void win.onResized(sync).then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off?.();
      window.clearTimeout(snapTimer.current);
    };
  }, []);

  if (!target || !hasTauri()) return null;
  const win = () => getCurrentWindow();
  const cancelSnap = () => window.clearTimeout(snapTimer.current);

  return createPortal(
    <div className="window-controls flex shrink-0" data-testid="window-controls" data-maximized={maximized}>
      <button type="button" id="decorum-tb-minimize" className="decorum-tb-btn" aria-label="Minimizar" tabIndex={-1} onClick={() => void win().minimize()} data-testid="win-minimize">
        {GLYPH.minimize}
      </button>
      <button
        type="button"
        id="decorum-tb-maximize"
        className="decorum-tb-btn"
        aria-label={maximized ? "Restaurar" : "Maximizar"}
        tabIndex={-1}
        onClick={() => {
          cancelSnap();
          void win().toggleMaximize();
        }}
        onMouseEnter={() => {
          // Igual que Windows: después de un momento sobre el botón, Snap Layouts.
          cancelSnap();
          snapTimer.current = window.setTimeout(() => {
            void win()
              .setFocus()
              .then(() => invoke("plugin:decorum|show_snap_overlay"))
              .catch(() => {});
          }, 620);
        }}
        onMouseLeave={cancelSnap}
        data-testid="win-maximize"
      >
        {maximized ? GLYPH.restore : GLYPH.maximize}
      </button>
      <button type="button" id="decorum-tb-close" className="decorum-tb-btn" aria-label="Cerrar" tabIndex={-1} onClick={() => void win().close()} data-testid="win-close">
        {GLYPH.close}
      </button>
    </div>,
    target,
  );
}
