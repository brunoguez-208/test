// Zoom del timeline: píxeles por segundo, guardado en project.view.zoom
// (0 = ajustar todo el proyecto al ancho visible).

import { activeProject, patchProject, useEditor } from "../../store/editor";
import { totalDuration } from "../../project/timeline";

export const MAX_PPS = 600;

/** Ancho visible del timeline (lo actualiza el componente). */
export const viewport = { width: 800 };

export function fitPps(duration: number, width = viewport.width): number {
  return Math.max(1, (width - 24) / Math.max(1, duration));
}

export function currentPps(): number {
  const p = activeProject();
  if (!p) return 50;
  const fit = fitPps(totalDuration(p));
  return p.view.zoom > 0 ? Math.max(fit, p.view.zoom) : fit;
}

/** Multiplica el zoom manteniendo `anchorTime` (por defecto el playhead) en el mismo lugar. */
export function zoomTimeline(factor: number, anchorTime?: number, anchorX?: number) {
  const p = activeProject();
  if (!p) return;
  const dur = totalDuration(p);
  const fit = fitPps(dur);
  const cur = currentPps();
  const next = Math.min(MAX_PPS, Math.max(fit, cur * factor));
  const t = anchorTime ?? useEditor.getState().time;
  const x = anchorX ?? t * cur - p.view.scroll;
  const scroll = Math.max(0, t * next - x);
  const maxScroll = Math.max(0, dur * next - (viewport.width - 24));
  patchProject((q) => ({ ...q, view: { ...q.view, zoom: next <= fit * 1.001 ? 0 : next, scroll: next <= fit * 1.001 ? 0 : Math.min(scroll, maxScroll) } }));
}

export function setScroll(scroll: number) {
  const p = activeProject();
  if (!p) return;
  const dur = totalDuration(p);
  const pps = currentPps();
  const maxScroll = Math.max(0, dur * pps - (viewport.width - 24));
  const s = Math.min(maxScroll, Math.max(0, scroll));
  if (Math.abs(s - p.view.scroll) < 0.5) return;
  patchProject((q) => ({ ...q, view: { ...q.view, scroll: s } }));
}
