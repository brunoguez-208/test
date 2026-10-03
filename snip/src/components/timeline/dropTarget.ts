// A qué pista y en qué tiempo caen los archivos arrastrados sobre el timeline.

import type { DropTarget } from "../../store/editor";
import { xToT, type Geo } from "./geometry";

let geo: Geo | null = null;

/** El timeline publica su geometría actual (zoom y scroll) para el drop. */
export function setDropGeo(g: Geo) {
  geo = g;
}

export function dropTargetAt(x: number, y: number): DropTarget | null {
  if (!geo) return null;
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const track = el?.closest("[data-drop]") as HTMLElement | null;
  const area = el?.closest("[data-testid='timeline-area']") as HTMLElement | null;
  if (!track || !area) return null;
  const kind = track.dataset.drop as DropTarget["kind"];
  const r = track.getBoundingClientRect();
  const rowH = Number(track.dataset.rowH || r.height || 1);
  const base = Number(track.dataset.rowBase ?? 0);
  const row = base < 0 ? -1 : base + Math.max(0, Math.floor((y - r.top) / rowH));
  const time = xToT(geo, x - area.getBoundingClientRect().left);
  return { kind, row, time: Math.min(time, Math.max(0, geo.duration)) };
}
