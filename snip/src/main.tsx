import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

async function boot() {
  // Modo "mock": UI en navegador con el IPC de Tauri simulado (tests de Playwright).
  if (import.meta.env.MODE === "mock") {
    const { installTauriMock } = await import("./mocks/tauriMock");
    installTauriMock();
  }

  if (!import.meta.env.DEV) {
    // En producción: sin menú contextual del WebView ni atajos del navegador.
    window.addEventListener("contextmenu", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest("input, textarea, pre")) e.preventDefault();
    });
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      // Atajos del navegador que no tienen sentido en la app (Ctrl+S, Ctrl+W, Ctrl+Tab los maneja Snip).
      if (k === "f5" || k === "f7" || (ctrl && ["r", "p", "f", "g", "u", "j"].includes(k)) || (ctrl && e.shiftKey && ["i", "c"].includes(k))) {
        e.preventDefault();
      }
    }, true);
  }

  const { App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
