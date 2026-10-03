// Superposiciones (texto, logo/imagen) y subtítulos: operaciones puras.

import type { Cue, ImageLayer, MediaRef, Overlay, OverlayContent, Project, SubtitleStyle, TextLayer } from "./model";
import { addMedia, makeId } from "./ops";
import { totalDuration } from "./timeline";
import { TEXT_TEMPLATES, type TextTemplate } from "./templates";

export const MIN_OVERLAY = 0.2;
export const MIN_CUE = 0.2;

/** Primera fila libre en [start, end) (para no pisar otras capas). */
export function freeLane(p: Project, start: number, end: number, exceptId?: string): number {
  for (let lane = 0; lane < 64; lane++) {
    const busy = p.overlays.some((o) => o.id !== exceptId && o.lane === lane && o.start < end - 1e-6 && o.start + o.duration > start + 1e-6);
    if (!busy) return lane;
  }
  return 0;
}

export function addOverlay(p: Project, content: OverlayContent, start: number, duration: number): [Project, string] {
  const total = Math.max(MIN_OVERLAY, totalDuration(p));
  const s = Math.min(Math.max(0, start), Math.max(0, total - MIN_OVERLAY));
  const d = Math.max(MIN_OVERLAY, Math.min(duration, total - s));
  const id = makeId("o");
  const o = { id, start: s, duration: d, lane: freeLane(p, s, s + d), ...content } as Overlay;
  return [{ ...p, overlays: [...p.overlays, o] }, id];
}

export function textFromTemplate(t: TextTemplate): TextLayer {
  return { type: "text", text: t.text, template: t.id, style: t.style, x: t.x, y: t.y, animIn: t.animIn, animOut: t.animOut };
}

/** Texto nuevo en el playhead (3 s, o lo que quede). */
export function addText(p: Project, templateId: string, at: number): [Project, string] {
  const t = TEXT_TEMPLATES.find((x) => x.id === templateId) ?? TEXT_TEMPLATES[0];
  return addOverlay(p, textFromTemplate(t), at, 3);
}

/** Logo / marca de agua: arriba a la derecha, durante todo el video. */
export function addImage(p: Project, media: MediaRef): [Project, string] {
  const [q, ref] = addMedia(p, media);
  const aspect = media.width > 0 && media.height > 0 ? media.height / media.width : 1;
  const canvasAspect = q.canvas.height / q.canvas.width;
  const width = 0.16;
  // Margen igual en los dos ejes (en píxeles).
  const mx = 0.03;
  const my = mx / canvasAspect;
  const layer: ImageLayer = { type: "image", mediaId: ref.id, x: 1 - mx - width / 2, y: my + (width * aspect) / canvasAspect / 2, width, opacity: 0.9, radius: 0, shadow: false };
  return addOverlay(q, layer, 0, totalDuration(q));
}

export function updateOverlay(p: Project, id: string, f: (o: Overlay) => Overlay): Project {
  let changed = false;
  const overlays = p.overlays.map((o) => {
    if (o.id !== id) return o;
    changed = true;
    return f(o);
  });
  return changed ? { ...p, overlays } : p;
}

/** Mueve en el tiempo (y de fila). */
export function moveOverlay(p: Project, id: string, start: number, lane?: number): Project {
  const total = totalDuration(p);
  return updateOverlay(p, id, (o) => {
    const s = Math.min(Math.max(0, start), Math.max(0, total - Math.min(o.duration, total)));
    return { ...o, start: s, lane: lane === undefined ? o.lane : Math.max(0, Math.min(63, lane)) };
  });
}

/** Recorta un borde (tiempo del timeline). */
export function trimOverlay(p: Project, id: string, edge: "in" | "out", t: number): Project {
  const total = totalDuration(p);
  return updateOverlay(p, id, (o) => {
    const end = o.start + o.duration;
    if (edge === "in") {
      const s = Math.min(end - MIN_OVERLAY, Math.max(0, t));
      return { ...o, start: s, duration: end - s };
    }
    const e = Math.max(o.start + MIN_OVERLAY, Math.min(total, t));
    return { ...o, duration: e - o.start };
  });
}

// ------------------------------- Subtítulos -------------------------------

function sortCues(cues: Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.start - b.start);
}

export function setCues(p: Project, cues: Cue[], language: string | null = p.subtitles.language): Project {
  return { ...p, subtitles: { ...p.subtitles, cues: sortCues(cues), language } };
}

/** Subtítulo nuevo en t (2 s o hasta el siguiente). */
export function addCue(p: Project, t: number): [Project, string] {
  const total = totalDuration(p);
  const next = p.subtitles.cues.find((c) => c.start > t + 1e-6);
  const start = Math.max(0, Math.min(t, total - MIN_CUE));
  const end = Math.min(total, next ? next.start : start + 2, start + 2);
  const id = makeId("s");
  const cue: Cue = { id, start, end: Math.max(start + MIN_CUE, end), text: "Nuevo subtítulo", words: [] };
  return [setCues(p, [...p.subtitles.cues, cue]), id];
}

export function updateCue(p: Project, id: string, patch: Partial<Pick<Cue, "start" | "end" | "text">>): Project {
  return setCues(
    p,
    p.subtitles.cues.map((c) => {
      if (c.id !== id) return c;
      const start = Math.max(0, patch.start ?? c.start);
      const end = Math.max(start + MIN_CUE, patch.end ?? c.end);
      const text = patch.text ?? c.text;
      // Si cambia el texto o los tiempos, las palabras de la transcripción ya no valen.
      const words = text !== c.text || start !== c.start || end !== c.end ? (text === c.text ? c.words.filter((w) => w.start >= start && w.end <= end) : []) : c.words;
      return { ...c, start, end, text, words };
    }),
  );
}

export function removeCue(p: Project, id: string): Project {
  return setCues(p, p.subtitles.cues.filter((c) => c.id !== id));
}

/** Corre todos los subtítulos (para sincronizar un .srt que viene desfasado). */
export function shiftCues(p: Project, dt: number): Project {
  return setCues(
    p,
    p.subtitles.cues
      .map((c) => ({ ...c, start: c.start + dt, end: c.end + dt, words: c.words.map((w) => ({ ...w, start: w.start + dt, end: w.end + dt })) }))
      .filter((c) => c.end > 0)
      .map((c) => ({ ...c, start: Math.max(0, c.start) })),
  );
}

export function setSubtitleStyle(p: Project, patch: Partial<SubtitleStyle>): Project {
  return { ...p, subtitles: { ...p.subtitles, style: { ...p.subtitles.style, ...patch } } };
}
