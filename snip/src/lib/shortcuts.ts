// Atajos de teclado como función pura (fácil de testear).

export type ShortcutAction =
  | { type: "togglePlay" }
  | { type: "markIn" }
  | { type: "markOut" }
  | { type: "stepFrames"; frames: number }
  | { type: "stepSeconds"; seconds: number }
  | { type: "shuttle"; key: "j" | "k" | "l" }
  | { type: "export" }
  | { type: "open" }
  | { type: "split" }
  | { type: "delete" }
  | { type: "marker" }
  | { type: "nextMarker" }
  | { type: "prevMarker" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "save" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "nextTab" }
  | { type: "prevTab" }
  | { type: "closeTab" }
  | { type: "help" }
  | { type: "home" }
  | { type: "end" }
  | { type: "escape" }
  | { type: "copy" }
  | { type: "cut" }
  | { type: "duplicate" }
  | { type: "pasteEffects" }
  | { type: "group" }
  | { type: "ungroup" }
  | { type: "saveAs" }
  | { type: "trimStart" }
  | { type: "trimEnd" };

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
}

/** ¿El foco está en un lugar donde se escribe? Ahí se ignoran todos los atajos. */
export function isTypingTarget(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (t.type || "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(type);
  }
  return false;
}

export function shortcutFor(e: KeyLike, target?: TargetLike | null): ShortcutAction | null {
  if (isTypingTarget(target)) return null;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (ctrl && e.altKey && !e.shiftKey && key === "v") return { type: "pasteEffects" };
  if (ctrl && !e.altKey) {
    if (key === "c") return { type: "copy" };
    if (key === "x") return { type: "cut" };
    if (key === "d") return { type: "duplicate" };
    if (key === "g") return e.shiftKey ? { type: "ungroup" } : { type: "group" };
    if (key === "Tab") return e.shiftKey ? { type: "prevTab" } : { type: "nextTab" };
    if (key === "e") return { type: "export" };
    if (key === "o") return { type: "open" };
    if (key === "s") return e.shiftKey ? { type: "saveAs" } : { type: "save" };
    if (key === "w") return { type: "closeTab" };
    if (key === "z") return e.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "y") return { type: "redo" };
    if (key === "m" && e.shiftKey) return { type: "prevMarker" };
    if (key === "+" || key === "=" || e.code === "NumpadAdd") return { type: "zoomIn" };
    if (key === "-" || e.code === "NumpadSubtract") return { type: "zoomOut" };
    return null;
  }
  if (e.altKey || ctrl) return null;

  if (key === " " || e.code === "Space") return { type: "togglePlay" };
  if (key === "?" || (key === "/" && e.shiftKey)) return { type: "help" };
  if (key === "+" || key === "=" || e.code === "NumpadAdd") return { type: "zoomIn" };
  if (key === "-" || key === "_" || e.code === "NumpadSubtract") return { type: "zoomOut" };
  if (key === "Delete" || key === "Backspace") return { type: "delete" };
  if (key === "Home") return { type: "home" };
  if (key === "End") return { type: "end" };
  if (key === "Escape") return { type: "escape" };
  if (key === "i") return { type: "markIn" };
  if (key === "o") return { type: "markOut" };
  if (key === "s") return { type: "split" };
  if (key === "q") return { type: "trimStart" };
  if (key === "w") return { type: "trimEnd" };
  if (key === "m") return e.shiftKey ? { type: "nextMarker" } : { type: "marker" };
  if (key === "ArrowLeft") return e.shiftKey ? { type: "stepSeconds", seconds: -1 } : { type: "stepFrames", frames: -1 };
  if (key === "ArrowRight") return e.shiftKey ? { type: "stepSeconds", seconds: 1 } : { type: "stepFrames", frames: 1 };
  if (key === "j" || key === "k" || key === "l") return { type: "shuttle", key };
  return null;
}

/**
 * Velocidad J/K/L. Positivo = adelante, negativo = atrás, 0 = pausa.
 * L acelera hacia adelante (1×, 2×, 4×, 8×); J igual hacia atrás; K frena.
 */
export function nextShuttleRate(current: number, key: "j" | "k" | "l"): number {
  if (key === "k") return 0;
  const dir = key === "l" ? 1 : -1;
  if (Math.sign(current) !== dir) return dir;
  return dir * Math.min(8, Math.abs(current) * 2);
}

/** Lista para el panel de atajos (?). */
export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Reproducción",
    items: [
      ["Espacio", "Reproducir / pausa"],
      ["J / K / L", "Atrás / pausa / adelante (repetir acelera)"],
      ["← / →", "Un cuadro"],
      ["Shift + ← / →", "Un segundo"],
      ["Inicio / Fin", "Ir al principio / al final"],
    ],
  },
  {
    title: "Edición",
    items: [
      ["S", "Dividir en el playhead (o el audio elegido)"],
      ["Q / W", "Recortar el inicio / el final del clip hasta el playhead"],
      ["Supr", "Borrar la selección o el rango I/O"],
      ["I / O", "Marcar inicio / fin del rango"],
      ["M", "Agregar marcador"],
      ["Shift + M", "Ir al marcador siguiente"],
      ["Ctrl + Shift + M", "Ir al marcador anterior"],
      ["Ctrl + Z", "Deshacer"],
      ["Ctrl + Y", "Rehacer"],
    ],
  },
  {
    title: "Portapapeles",
    items: [
      ["Ctrl + C / X", "Copiar / cortar la selección"],
      ["Ctrl + V", "Pegar en el playhead (también capturas, texto y archivos)"],
      ["Ctrl + D", "Duplicar a continuación"],
      ["Ctrl + Alt + V", "Pegar solo los efectos"],
      ["Ctrl + G", "Agrupar"],
      ["Ctrl + Shift + G", "Desagrupar"],
    ],
  },
  {
    title: "Pistas y audio",
    items: [
      ["Ojo / M / S / candado", "Ocultar, silenciar, solo y bloquear (cabecera de cada pista)"],
      ["Doble clic en un audio", "Agregar un punto de volumen (doble clic en el punto lo borra)"],
      ["Clic derecho en un clip", "Separar audio, Mejorar voz, copiar, agrupar…"],
      ["Arrastrar del Explorador", "Soltar sobre una pista: va a esa pista, en ese tiempo"],
    ],
  },
  {
    title: "Proyecto",
    items: [
      ["Ctrl + O", "Abrir video o proyecto"],
      ["Ctrl + S", "Guardar el proyecto (.snip)"],
      ["Ctrl + Shift + S", "Guardar el proyecto como…"],
      ["Ctrl + E", "Exportar"],
      ["Ctrl + Tab", "Pestaña siguiente"],
      ["Ctrl + W", "Cerrar pestaña"],
      ["+ / −", "Zoom del timeline (también Ctrl + rueda)"],
      ["?", "Este panel"],
    ],
  },
];
