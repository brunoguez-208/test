// Atajos de teclado como función pura (fácil de testear).

export type ShortcutAction =
  | { type: "togglePlay" }
  | { type: "markIn" }
  | { type: "markOut" }
  | { type: "stepFrames"; frames: number }
  | { type: "stepSeconds"; seconds: number }
  | { type: "shuttle"; key: "j" | "k" | "l" }
  | { type: "export" }
  | { type: "open" };

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

  if (ctrl && !e.altKey) {
    if (key === "e") return { type: "export" };
    if (key === "o") return { type: "open" };
    return null;
  }
  if (e.altKey || ctrl) return null;

  if (key === " " || e.code === "Space") return { type: "togglePlay" };
  if (key === "i") return { type: "markIn" };
  if (key === "o") return { type: "markOut" };
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
