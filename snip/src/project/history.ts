// Deshacer / rehacer sobre el modelo de proyecto. Historial ilimitado en la
// sesión: cada acción del usuario es un paso. Los gestos (arrastrar un handle)
// actualizan en vivo sin generar pasos y se confirman como uno solo al soltar.

import type { Project } from "./model";

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** Estado al empezar un gesto en curso (null si no hay gesto). */
  gestureBase: Project | null;
}

export function createHistory(p: Project): History {
  return { past: [], present: p, future: [], gestureBase: null };
}

/** Partes del proyecto que no son "edición" (no generan pasos ni ensucian). */
function editable(p: Project) {
  return { ...p, view: null, updatedAt: 0, exportedAt: null, export: null };
}

export function sameEdit(a: Project, b: Project): boolean {
  if (a === b) return true;
  return JSON.stringify(editable(a)) === JSON.stringify(editable(b));
}

/** Aplica una acción como un paso (si cambió algo). */
export function commit(h: History, next: Project): History {
  if (h.gestureBase) return { ...h, present: next };
  if (next === h.present) return h;
  if (sameEdit(next, h.present)) return { ...h, present: next };
  return { past: [...h.past, h.present], present: next, future: [], gestureBase: null };
}

/** Reemplaza sin crear un paso (vista, configuración de exportación, etc.). */
export function replace(h: History, next: Project): History {
  return { ...h, present: next };
}

export function beginGesture(h: History): History {
  return h.gestureBase ? h : { ...h, gestureBase: h.present };
}

export function endGesture(h: History): History {
  const base = h.gestureBase;
  if (!base) return h;
  if (sameEdit(base, h.present)) return { ...h, gestureBase: null };
  return { past: [...h.past, base], present: h.present, future: [], gestureBase: null };
}

/** Cancela un gesto (Esc mientras se arrastra). */
export function cancelGesture(h: History): History {
  return h.gestureBase ? { ...h, present: h.gestureBase, gestureBase: null } : h;
}

/** Los cambios de vista y exportación viajan con el presente al deshacer. */
function carry(from: Project, to: Project): Project {
  return { ...to, view: from.view, export: from.export };
}

export function undo(h: History): History {
  const base = h.gestureBase ? endGesture(h) : h;
  if (!base.past.length) return base;
  const prev = base.past[base.past.length - 1];
  return { past: base.past.slice(0, -1), present: carry(base.present, prev), future: [base.present, ...base.future], gestureBase: null };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: carry(h.present, next), future: rest, gestureBase: null };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History): boolean {
  return h.future.length > 0;
}
