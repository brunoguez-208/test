// Superposiciones (texto, logo/imagen) y subtítulos: operaciones puras.

import type { BlurLayer, Cue, EffectKind, ImageLayer, MediaRef, Overlay, OverlayContent, PipLayer, Project, Rect, RectKey, SubtitleStyle, TextLayer } from "./model";
import { EFFECTS } from "./effects";
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

/** Imagen como capa normal: centrada, en el playhead, por unos segundos. */
export function addImageAt(p: Project, media: MediaRef, at: number, duration = 5): [Project, string] {
  const [q, ref] = addMedia(p, media);
  const aspect = media.width > 0 && media.height > 0 ? media.height / media.width : 1;
  const canvasAspect = q.canvas.height / q.canvas.width;
  // Que entre entera: 40 % del ancho, o menos si es muy alta.
  const width = Math.min(0.4, (0.6 * canvasAspect) / aspect);
  const layer: ImageLayer = { type: "image", mediaId: ref.id, x: 0.5, y: 0.5, width, opacity: 1, radius: 0, shadow: false };
  return addOverlay(q, layer, at, duration);
}

/**
 * "Usar como marca de agua": la imagen pasa a durar todo el video y se ubica
 * en una esquina; si se desactiva vuelve a ser una capa normal.
 */
export function setWatermark(p: Project, id: string, on: boolean): Project {
  const total = Math.max(MIN_OVERLAY, totalDuration(p));
  return updateOverlay(p, id, (o) => {
    if (o.type !== "image") return o;
    if (!on) return { ...o, watermark: false, duration: Math.min(o.duration, 5), start: Math.min(o.start, Math.max(0, total - 5)) };
    return { ...o, watermark: true, start: 0, duration: total, animIn: null, animOut: null, opacity: o.opacity >= 1 ? 0.85 : o.opacity };
  });
}

/** Las marcas de agua siguen el largo del video (se llama en cada edición). */
export function syncWatermarks(p: Project): Project {
  if (!p.overlays.some((o) => o.type === "image" && o.watermark)) return p;
  const total = Math.max(MIN_OVERLAY, totalDuration(p));
  let changed = false;
  const overlays = p.overlays.map((o) => {
    if (o.type !== "image" || !o.watermark || (o.start === 0 && Math.abs(o.duration - total) < 1e-9)) return o;
    changed = true;
    return { ...o, start: 0, duration: total };
  });
  return changed ? { ...p, overlays } : p;
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

// ------------------------- Desenfoque / pixelado de zona -------------------------

export const MIN_RECT = 0.02;

/** Radio del desenfoque en píxeles del lienzo (igual que blur_radius de Rust). */
export function blurRadius(strength: number, canvasH: number): number {
  return Math.max(1, Math.round(Math.min(1, Math.max(0, strength)) * canvasH * 0.04));
}

/** Lado del bloque del pixelado en píxeles del lienzo (igual que pixel_size de Rust). */
export function pixelSize(strength: number, canvasH: number): number {
  return Math.max(2, Math.round(Math.min(1, Math.max(0, strength)) * canvasH * 0.06));
}

export function clampRect(r: Rect): Rect {
  const w = Math.min(1, Math.max(MIN_RECT, r.w));
  const h = Math.min(1, Math.max(MIN_RECT, r.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, r.x)), y: Math.min(1 - h, Math.max(0, r.y)) };
}

/** Rectángulo de la zona en el tiempo local u (interpolación lineal entre keyframes). */
export function rectAt(b: Pick<BlurLayer, "rect" | "keys">, u: number): Rect {
  const keys = [...b.keys].sort((x, y) => x.t - y.t);
  if (!keys.length) return b.rect;
  if (u <= keys[0].t) return keys[0].rect;
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, c] = [keys[i], keys[i + 1]];
    if (u < c.t) {
      const k = (u - a.t) / Math.max(1e-6, c.t - a.t);
      const m = (p: number, q: number) => p + (q - p) * k;
      return { x: m(a.rect.x, c.rect.x), y: m(a.rect.y, c.rect.y), w: m(a.rect.w, c.rect.w), h: m(a.rect.h, c.rect.h) };
    }
  }
  return keys[keys.length - 1].rect;
}

/** Zona desenfocada nueva en el playhead (3 s, al centro). */
export function addBlur(p: Project, at: number, mode: BlurLayer["mode"] = "blur"): [Project, string] {
  const layer: BlurLayer & { type: "blur" } = { type: "blur", mode, strength: 0.6, rect: { x: 0.35, y: 0.3, w: 0.3, h: 0.3 }, keys: [] };
  return addOverlay(p, layer, at, 3);
}

/**
 * Cambia el rectángulo de la zona en el tiempo local u: sin keyframes cambia
 * el fijo; con keyframes, crea o actualiza el del cuadro actual.
 */
export function setBlurRectAt(p: Project, id: string, u: number, rect: Rect, frame = 1 / 30): Project {
  return updateOverlay(p, id, (o) => {
    if (o.type !== "blur") return o;
    const r = clampRect(rect);
    if (!o.keys.length) return { ...o, rect: r };
    const near = o.keys.find((k) => Math.abs(k.t - u) < frame / 2);
    const keys = near ? o.keys.map((k) => (k === near ? { ...k, rect: r } : k)) : [...o.keys, { id: Math.max(0, ...o.keys.map((k) => k.id)) + 1, t: u, rect: r }];
    return { ...o, keys: keys.sort((a, b) => a.t - b.t) };
  });
}

/** Activa el seguimiento: primer keyframe con el rectángulo actual en u. */
export function addBlurKey(p: Project, id: string, u: number): Project {
  return updateOverlay(p, id, (o) => {
    if (o.type !== "blur") return o;
    const t = Math.min(o.duration, Math.max(0, u));
    if (o.keys.some((k) => Math.abs(k.t - t) < 1e-3)) return o;
    const key: RectKey = { id: Math.max(0, ...o.keys.map((k) => k.id)) + 1, t, rect: rectAt(o, t) };
    return { ...o, keys: [...o.keys, key].sort((a, b) => a.t - b.t) };
  });
}

export function removeBlurKeys(p: Project, id: string): Project {
  return updateOverlay(p, id, (o) => (o.type === "blur" ? { ...o, rect: rectAt(o, 0), keys: [] } : o));
}

// --------------------------------- Efectos ---------------------------------

/** Efecto de un clic en el playhead (con su duración típica). */
export function addEffect(p: Project, kind: EffectKind, at: number, duration?: number): [Project, string] {
  const d = duration ?? EFFECTS.find((e) => e.kind === kind)?.duration ?? 0.6;
  return addOverlay(p, { type: "effect", kind, intensity: 0.7 }, at, d);
}

// ------------------------------- Picture-in-picture -------------------------------

/** PiP nuevo: abajo a la derecha, con esquinas redondeadas y sombra, sin sonido. */
export function addPip(p: Project, media: MediaRef, at: number): [Project, string] {
  const [q, ref] = addMedia(p, media);
  const width = 0.32;
  const aspect = media.width > 0 && media.height > 0 ? media.height / media.width : 9 / 16;
  const canvasAspect = q.canvas.height / q.canvas.width;
  const mx = 0.04;
  const layer: PipLayer = {
    type: "video",
    mediaId: ref.id,
    inPoint: 0,
    x: 1 - mx - width / 2,
    y: 1 - mx / canvasAspect - (width * aspect) / canvasAspect / 2,
    width,
    radius: 0.08,
    shadow: true,
    volume: 0,
  };
  const total = totalDuration(q);
  return addOverlay(q, layer, at, Math.min(media.duration || 5, Math.max(MIN_OVERLAY, total - at)));
}

/** Rectángulo del PiP en píxeles enteros (pares) del lienzo, igual que lo usa FFmpeg. */
export function pipRect(o: Pick<PipLayer, "x" | "y" | "width">, m: Pick<MediaRef, "width" | "height">, W: number, H: number) {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const w = even(o.width * W);
  const h = even((w * Math.max(1, m.height)) / Math.max(1, m.width));
  return { x: Math.round(o.x * W - w / 2), y: Math.round(o.y * H - h / 2), w, h };
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
