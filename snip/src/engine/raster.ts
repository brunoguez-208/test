// Capa de "decoración": textos, logos y subtítulos dibujados con canvas 2D.
// El MISMO código dibuja el preview (en vivo) y la exportación (secuencia de
// PNG que Rust superpone con overlay), así lo que se ve es lo que se exporta.
//
// Todo se mide en fracciones del lienzo (posiciones) o del tamaño de la letra
// (contorno, sombra, fondo), así el resultado no depende de la resolución.

import type { Cue, ImageLayer, MediaRef, Overlay, Project, SubtitleStyle, TextAnim, TextLayer, TextStyle } from "../project/model";
import { canvasFps } from "../project/model";
import { totalDuration } from "../project/timeline";
import { pipRect, rectAt } from "../project/overlayOps";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type TextOverlay = Overlay & TextLayer;
type ImageOverlay = Overlay & ImageLayer;

const FALLBACK_FONTS = `"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
const LINE_HEIGHT = 1.2;

export function isTextOverlay(o: Overlay): o is TextOverlay {
  return o.type === "text";
}
export function isImageOverlay(o: Overlay): o is ImageOverlay {
  return o.type === "image";
}

/** ¿El proyecto tiene algo para la capa de decoración? */
export function hasDecor(p: Project): boolean {
  return p.overlays.some((o) => o.type === "text" || o.type === "image") || p.subtitles.cues.length > 0;
}

export function isActive(o: Pick<Overlay, "start" | "duration">, t: number): boolean {
  return t >= o.start - 1e-6 && t < o.start + o.duration - 1e-6;
}

export function cueAt(cues: Cue[], t: number): Cue | null {
  for (const c of cues) if (t >= c.start - 1e-6 && t < c.end - 1e-6) return c;
  return null;
}

/** Índice de la palabra que se está diciendo (la última que ya empezó). */
export function wordIndexAt(c: Cue, t: number): number {
  let idx = -1;
  c.words.forEach((w, i) => {
    if (t >= w.start - 1e-6) idx = i;
  });
  return idx;
}

/** Capas visibles en orden de dibujo: por fila (lane) y después por inicio. */
function visibleOverlays(p: Project, t: number): Overlay[] {
  return p.overlays
    .filter((o) => (o.type === "text" || o.type === "image") && isActive(o, t) && !p.tracks?.overlays?.[o.lane]?.hidden)
    .sort((a, b) => a.lane - b.lane || a.start - b.start);
}

/** Progreso de la animación de entrada / salida (null = sin animar en t). */
function animPhase(o: Pick<Overlay, "start" | "duration"> & { animIn?: TextAnim | null; animOut?: TextAnim | null }, t: number): { kind: "in" | "out"; anim: TextAnim; p: number } | null {
  const u = t - o.start;
  const dIn = o.animIn ? Math.min(o.animIn.duration, o.duration / 2) : 0;
  const dOut = o.animOut ? Math.min(o.animOut.duration, o.duration / 2) : 0;
  if (o.animIn && dIn > 0 && u < dIn) return { kind: "in", anim: o.animIn, p: Math.max(0, u / dIn) };
  if (o.animOut && dOut > 0 && u > o.duration - dOut) return { kind: "out", anim: o.animOut, p: Math.max(0, (o.duration - u) / dOut) };
  return null;
}

/**
 * Clave del estado de la capa en el cuadro t: si dos cuadros tienen la misma
 * clave, se ven idénticos (la exportación reusa el PNG).
 */
export function decorKey(p: Project, t: number, fps = canvasFps(p.canvas)): string {
  const parts: string[] = [];
  for (const o of visibleOverlays(p, t)) {
    const ph = o.type === "text" || o.type === "image" ? animPhase(o as TextOverlay | ImageOverlay, t) : null;
    parts.push(ph ? `${o.id}:${ph.kind}${Math.round((t - o.start) * fps)}` : o.id);
  }
  const c = p.tracks?.subtitles?.hidden ? null : cueAt(p.subtitles.cues, t);
  if (c) parts.push(p.subtitles.wordByWord && c.words.length ? `${c.id}:w${wordIndexAt(c, t)}` : c.id);
  return parts.join("|");
}

// ------------------------------- Texto -------------------------------

export function fontString(s: Pick<TextStyle, "fontFamily" | "weight"> & { italic?: boolean }, px: number): string {
  return `${s.italic ? "italic " : ""}${s.weight} ${px.toFixed(2)}px "${s.fontFamily}", ${FALLBACK_FONTS}`;
}

/** Corta en líneas (respeta los saltos y parte por palabras si no entra en maxW). */
export function wrapLines(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/ +/);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > maxW) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export interface TextBox {
  /** Rectángulo del bloque (sin el fondo), en píxeles. */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  fontPx: number;
}

/** Medidas del bloque de texto centrado en (x, y) del lienzo. */
export function measureText(ctx: Ctx, text: string, style: TextStyle, cx: number, cy: number, W: number, H: number): TextBox {
  const fontPx = Math.max(1, style.size * H);
  ctx.font = fontString(style, fontPx);
  const lines = wrapLines(ctx, text, W * 0.9);
  const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const h = lines.length * fontPx * LINE_HEIGHT;
  return { x: cx * W - w / 2, y: cy * H - h / 2, w, h, lines, fontPx };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.min(1, Math.max(0, a))})`;
}

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
function easeOutBack(x: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = Math.min(1, Math.max(0, x));
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Un trozo de línea con su color (para resaltar palabras). */
interface Run {
  text: string;
  color: string;
}

/**
 * Dibuja un bloque de texto. `runs` permite colorear palabras sueltas
 * (subtítulos palabra por palabra); si no, todo va del color del estilo.
 */
function drawTextBlock(
  ctx: Ctx,
  box: TextBox,
  style: TextStyle,
  opts: { alpha?: number; dy?: number; scale?: number; chars?: number; runs?: Run[][] } = {},
) {
  const { fontPx } = box;
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2 + (opts.dy ?? 0);
  if (opts.scale !== undefined && opts.scale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(opts.scale, opts.scale);
    ctx.translate(-cx, -cy);
  }
  const top = cy - box.h / 2;
  // Fondo redondeado detrás del bloque.
  if (style.background && style.background.opacity > 0) {
    const pad = style.background.padding * fontPx;
    ctx.fillStyle = hexAlpha(style.background.color, style.background.opacity);
    roundRect(ctx, box.x - pad, top - pad * 0.6, box.w + pad * 2, box.h + pad * 1.2, style.background.radius * fontPx);
    ctx.fill();
  }
  ctx.font = fontString(style, fontPx);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  let remaining = opts.chars ?? Infinity;
  box.lines.forEach((line, i) => {
    const runs = opts.runs?.[i] ?? [{ text: line, color: style.color }];
    const lineW = ctx.measureText(runs.map((r) => r.text).join("")).width;
    let x = style.align === "left" ? box.x : style.align === "right" ? box.x + box.w - lineW : box.x + (box.w - lineW) / 2;
    const y = top + (i + 0.5) * fontPx * LINE_HEIGHT;
    for (const r of runs) {
      if (remaining <= 0) break;
      const txt = r.text.length > remaining ? r.text.slice(0, remaining) : r.text;
      remaining -= r.text.length;
      // Sombra (debajo de todo), contorno y relleno.
      if (style.shadow) {
        ctx.save();
        ctx.shadowColor = style.shadow.color;
        ctx.shadowBlur = style.shadow.blur * fontPx;
        ctx.shadowOffsetX = style.shadow.offsetX * fontPx;
        ctx.shadowOffsetY = style.shadow.offsetY * fontPx;
        ctx.fillStyle = r.color;
        ctx.fillText(txt, x, y);
        ctx.restore();
      }
      if (style.stroke && style.stroke.width > 0) {
        ctx.strokeStyle = style.stroke.color;
        ctx.lineWidth = style.stroke.width * fontPx * 2;
        ctx.strokeText(txt, x, y);
      }
      ctx.fillStyle = r.color;
      ctx.fillText(txt, x, y);
      x += ctx.measureText(r.text).width;
    }
    remaining -= 1; // el salto de línea cuenta como un carácter en la máquina de escribir
  });
  ctx.restore();
}

/** Texto de una capa con su animación en el instante t. */
export function drawTextOverlay(ctx: Ctx, o: TextOverlay, t: number, W: number, H: number) {
  if (!o.text.trim()) return;
  const box = measureText(ctx, o.text, o.style, o.x, o.y, W, H);
  const ph = animPhase(o, t);
  if (!ph) return drawTextBlock(ctx, box, o.style);
  const p = ph.p;
  switch (ph.anim.kind) {
    case "fade":
      return drawTextBlock(ctx, box, o.style, { alpha: p });
    case "slide":
      return drawTextBlock(ctx, box, o.style, { alpha: p, dy: (1 - easeOut(p)) * box.fontPx * 0.8 * (ph.kind === "in" ? 1 : -1) });
    case "pop":
      return drawTextBlock(ctx, box, o.style, { alpha: Math.min(1, p * 2), scale: 0.6 + 0.4 * easeOutBack(p) });
    case "typewriter":
      return drawTextBlock(ctx, box, o.style, { chars: Math.floor(p * (o.text.length + 0.999)) });
  }
}

// ------------------------------- Subtítulos -------------------------------

export function subtitleTextStyle(s: SubtitleStyle): TextStyle {
  return {
    fontFamily: s.fontFamily,
    size: s.size,
    weight: s.weight,
    italic: false,
    color: s.color,
    align: "center",
    stroke: s.stroke,
    shadow: null,
    background: s.background,
  };
}

export function drawSubtitle(ctx: Ctx, p: Project, c: Cue, t: number, W: number, H: number) {
  const st = p.subtitles.style;
  const style = subtitleTextStyle(st);
  const up = (x: string) => (st.uppercase ? x.toLocaleUpperCase("es") : x);
  const byWord = p.subtitles.wordByWord && c.words.length > 0;
  const text = up(byWord ? c.words.map((w) => w.text.trim()).join(" ") : c.text);
  if (!text.trim()) return;
  const box = measureText(ctx, text, style, 0.5, st.y, W, H);
  if (!byWord) return drawTextBlock(ctx, box, style);
  // Resalta la palabra que se está diciendo: recorre las líneas ya cortadas.
  const cur = wordIndexAt(c, t);
  let wi = 0;
  const runs: Run[][] = box.lines.map((line) => {
    const ws = line.split(" ");
    return ws.map((w, k) => {
      const run = { text: k < ws.length - 1 ? `${w} ` : w, color: wi === cur ? st.highlight : st.color };
      wi += 1;
      return run;
    });
  });
  drawTextBlock(ctx, box, style, { runs });
}

// ------------------------------- Imágenes -------------------------------

export interface ImageSource {
  /** Imagen ya cargada (o null si todavía no). */
  get(m: MediaRef): CanvasImageSource | null;
}

export function imageRect(o: ImageLayer, m: Pick<MediaRef, "width" | "height">, W: number, H: number) {
  const w = Math.max(1, o.width * W);
  const h = w * (Math.max(1, m.height) / Math.max(1, m.width));
  return { x: o.x * W - w / 2, y: o.y * H - h / 2, w, h };
}

export function drawImageOverlay(ctx: Ctx, p: Project, o: ImageOverlay, W: number, H: number, images: ImageSource, t?: number) {
  const m = p.media.find((x) => x.id === o.mediaId);
  if (!m) return;
  const img = images.get(m);
  if (!img) return;
  const r = imageRect(o, m, W, H);
  const radius = o.radius * Math.min(r.w, r.h);
  // Animación de entrada / salida (misma curva que los textos) y rotación.
  const ph = t === undefined ? null : animPhase(o, t);
  let alpha = 1;
  let dy = 0;
  let scale = 1;
  if (ph) {
    const q = ph.p;
    if (ph.anim.kind === "slide") {
      alpha = q;
      dy = (1 - easeOut(q)) * r.h * 0.25 * (ph.kind === "in" ? 1 : -1);
    } else if (ph.anim.kind === "pop") {
      alpha = Math.min(1, q * 2);
      scale = 0.6 + 0.4 * easeOutBack(q);
    } else alpha = q;
  }
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, o.opacity * alpha));
  const rot = ((o.rotation ?? 0) * Math.PI) / 180;
  if (rot || scale !== 1 || dy) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2 + dy;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }
  if (o.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = Math.min(r.w, r.h) * 0.12;
    ctx.shadowOffsetY = Math.min(r.w, r.h) * 0.04;
    ctx.fillStyle = "#000";
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.fill();
    ctx.restore();
  }
  roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.clip();
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  ctx.restore();
}

/** Imágenes de las capas (logos): se cargan una vez y avisan cuando están listas. */
export class ImageCache implements ImageSource {
  private map = new Map<string, HTMLImageElement | "loading" | "error">();
  private waiting = new Map<string, Promise<void>>();
  constructor(
    private url: (m: MediaRef) => string | null,
    private onLoad: () => void = () => {},
  ) {}

  get(m: MediaRef): CanvasImageSource | null {
    const e = this.map.get(m.path);
    if (e instanceof HTMLImageElement) return e;
    if (!e) void this.load(m);
    return null;
  }

  load(m: MediaRef): Promise<void> {
    const pending = this.waiting.get(m.path);
    if (pending) return pending;
    const u = this.url(m);
    if (!u) return Promise.resolve();
    this.map.set(m.path, "loading");
    const img = new Image();
    // Con CORS: el canvas no queda "contaminado" y se puede exportar a PNG.
    img.crossOrigin = "anonymous";
    img.src = u;
    const done = img
      .decode()
      .then(() => {
        this.map.set(m.path, img);
        this.onLoad();
      })
      .catch(() => {
        this.map.set(m.path, "error");
      });
    this.waiting.set(m.path, done);
    return done;
  }

  /** Espera a que estén cargadas todas las imágenes que usa el proyecto. */
  async ready(p: Project): Promise<void> {
    const ids = new Set(p.overlays.filter((o) => o.type === "image").map((o) => (o as ImageOverlay).mediaId));
    await Promise.all(p.media.filter((m) => ids.has(m.id)).map((m) => (this.map.get(m.path) instanceof HTMLImageElement ? Promise.resolve() : this.load(m))));
  }
}

// ------------------------------- PiP y zonas -------------------------------

/** Sombra del PiP sobre un canvas transparente del tamaño del lienzo (solo la sombra). */
export function drawPipShadow(ctx: Ctx, rect: { x: number; y: number; w: number; h: number }, radius: number, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  const m = Math.min(rect.w, rect.h);
  const shift = W + rect.w + 100;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = m * 0.12;
  ctx.shadowOffsetX = shift;
  ctx.shadowOffsetY = m * 0.04;
  ctx.fillStyle = "#000";
  // La figura queda fuera del lienzo: solo se ve su sombra.
  roundRect(ctx, rect.x - shift, rect.y, rect.w, rect.h, radius);
  ctx.fill();
  ctx.restore();
}

/** Máscara del PiP (blanco = se ve) del tamaño del PiP, con las esquinas redondeadas. */
export function drawPipMask(ctx: Ctx, w: number, h: number, radius: number) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fill();
}

/** Zona en píxeles enteros del lienzo (el mismo redondeo usa el shader del preview). */
export function zonePixels(r: { x: number; y: number; w: number; h: number }, W: number, H: number): [number, number, number, number] {
  return [Math.round(r.x * W), Math.round(r.y * H), Math.round((r.x + r.w) * W), Math.round((r.y + r.h) * H)];
}

// ------------------------------- Cuadro completo -------------------------------

/** Dibuja la capa de decoración del instante t sobre un canvas transparente de W×H. */
export function drawDecor(ctx: Ctx, p: Project, t: number, W: number, H: number, images: ImageSource) {
  ctx.clearRect(0, 0, W, H);
  for (const o of visibleOverlays(p, t)) {
    if (o.type === "text") drawTextOverlay(ctx, o as TextOverlay, t, W, H);
    else if (o.type === "image") drawImageOverlay(ctx, p, o as ImageOverlay, W, H, images, t);
  }
  const c = p.tracks?.subtitles?.hidden ? null : cueAt(p.subtitles.cues, t);
  if (c) drawSubtitle(ctx, p, c, t, W, H);
}

// ------------------------------- Preview -------------------------------

/** Firma de todo lo que afecta a la capa (para invalidar la caché del preview). */
const sigCache = new WeakMap<Project, string>();
export function decorSignature(p: Project): string {
  let s = sigCache.get(p);
  if (s === undefined) {
    s = JSON.stringify([p.overlays.filter((o) => o.type === "text" || o.type === "image"), p.subtitles, p.canvas.fpsNum, p.canvas.fpsDen, p.tracks?.overlays?.map((t) => !!t?.hidden), !!p.tracks?.subtitles?.hidden]);
    sigCache.set(p, s);
  }
  return s;
}

/** Capa del preview: se vuelve a dibujar solo cuando cambia lo que se ve. */
export class DecorLayer {
  private canvas: HTMLCanvasElement | null = null;
  private last = "";
  /** Cambia cada vez que se redibuja (el renderer solo sube la textura si cambió). */
  version = 0;
  constructor(private images: ImageSource) {}

  /** Fuerza a redibujar (por ejemplo, cuando terminó de cargar una imagen). */
  invalidate() {
    this.last = "";
  }

  get(p: Project, t: number, W: number, H: number): HTMLCanvasElement | null {
    if (!hasDecor(p)) return null;
    const key = decorKey(p, t);
    if (!key) return null;
    const full = `${decorSignature(p)}#${key}#${W}x${H}`;
    if (!this.canvas) this.canvas = document.createElement("canvas");
    const c = this.canvas;
    if (full !== this.last) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      drawDecor(ctx, p, t, W, H, this.images);
      this.last = full;
      this.version += 1;
    }
    return c;
  }
}

// ------------------------------- Exportación -------------------------------

export interface DecorFrame {
  name: string;
  png: Blob;
}

export interface DecorSequence {
  frames: DecorFrame[];
  /** Lista ffconcat (rutas relativas a su carpeta). */
  list: string;
}

/**
 * Tramos del timeline con el mismo estado (según `keyAt`). Cada cuadro k se
 * muestrea en k/fps (como el preview); el tramo empieza medio cuadro antes para
 * que el overlay de FFmpeg siempre tome el PNG correcto aunque haya redondeos.
 */
export function runsOf(p: Project, keyAt: (t: number) => string): { key: string; t: number; start: number; end: number }[] {
  const fps = canvasFps(p.canvas);
  const total = totalDuration(p);
  const n = Math.max(1, Math.ceil(total * fps - 1e-6));
  const runs: { key: string; t: number; start: number; end: number }[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / fps;
    const key = keyAt(t);
    const last = runs[runs.length - 1];
    if (last && last.key === key) continue;
    if (last) last.end = Math.max(0, (k - 0.5) / fps);
    runs.push({ key, t, start: last ? last.end : 0, end: total + 1 });
  }
  return runs;
}

export function decorRuns(p: Project) {
  const fps = canvasFps(p.canvas);
  return runsOf(p, (t) => decorKey(p, t, fps));
}

function canvasToPng(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: "image/png" });
  return new Promise((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error("No se pudo generar la imagen"))), "image/png"));
}

/** Secuencia de PNG (uno por estado distinto) + lista ffconcat. */
async function renderSequence(
  p: Project,
  prefix: string,
  keyAt: (t: number) => string,
  draw: (ctx: CanvasRenderingContext2D, t: number, W: number, H: number) => void,
  onProgress?: (f: number) => void,
): Promise<DecorSequence> {
  const W = p.canvas.width;
  const H = p.canvas.height;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Sin canvas 2D");
  const runs = runsOf(p, keyAt);
  const byKey = new Map<string, string>();
  const frames: DecorFrame[] = [];
  const lines = ["ffconcat version 1.0"];
  let lastName = "";
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    let name = byKey.get(r.key);
    if (!name) {
      name = `${prefix}${String(frames.length + 1).padStart(5, "0")}.png`;
      draw(ctx, r.t, W, H);
      frames.push({ name, png: await canvasToPng(canvas) });
      byKey.set(r.key, name);
    }
    lines.push(`file '${name}'`, `duration ${(r.end - r.start).toFixed(6)}`);
    lastName = name;
    onProgress?.((i + 1) / runs.length);
    // Ceder el hilo de vez en cuando (la UI sigue respondiendo).
    if (i % 20 === 19) await new Promise((res) => setTimeout(res, 0));
  }
  // ffconcat necesita repetir el último archivo para respetar su duración.
  lines.push(`file '${lastName}'`);
  return { frames, list: lines.join("\n") + "\n" };
}

/** Arma la secuencia de PNG de toda la capa de decoración. */
export async function renderDecorSequence(p: Project, images: ImageSource, onProgress?: (f: number) => void): Promise<DecorSequence | null> {
  if (!hasDecor(p)) return null;
  const fps = canvasFps(p.canvas);
  return renderSequence(p, "f", (t) => decorKey(p, t, fps), (ctx, t, W, H) => drawDecor(ctx, p, t, W, H, images), onProgress);
}

export interface PipAssets {
  mask: Blob;
  shadow: Blob | null;
  rect: { x: number; y: number; w: number; h: number };
}

export interface ZoneAssets {
  /** Máscara (secuencia) de cada zona desenfocada. */
  masks: Record<string, DecorSequence>;
  pips: Record<string, PipAssets>;
}

/** Máscaras de las zonas y máscara + sombra de cada PiP, como las dibuja el preview. */
export async function renderZoneAssets(p: Project): Promise<ZoneAssets | null> {
  const blurs = p.overlays.filter((o) => o.type === "blur");
  const pipsL = p.overlays.filter((o) => o.type === "video");
  if (!blurs.length && !pipsL.length) return null;
  const W = p.canvas.width;
  const H = p.canvas.height;
  const fps = canvasFps(p.canvas);
  const out: ZoneAssets = { masks: {}, pips: {} };
  for (const o of blurs) {
    if (o.type !== "blur") continue;
    out.masks[o.id] = await renderSequence(
      p,
      `m${Object.keys(out.masks).length}_`,
      (t) => (isActive(o, t) ? (o.keys.length ? `k${Math.round(t * fps)}` : "on") : ""),
      (ctx, t) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        if (!isActive(o, t)) return;
        const [x0, y0, x1, y1] = zonePixels(rectAt(o, t - o.start), W, H);
        ctx.fillStyle = "#fff";
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      },
    );
  }
  for (const o of pipsL) {
    if (o.type !== "video") continue;
    const m = p.media.find((x) => x.id === o.mediaId);
    if (!m) continue;
    const rect = pipRect(o, m, W, H);
    const radius = o.radius * Math.min(rect.w, rect.h);
    const mc = document.createElement("canvas");
    mc.width = rect.w;
    mc.height = rect.h;
    drawPipMask(mc.getContext("2d")!, rect.w, rect.h, radius);
    let shadow: Blob | null = null;
    if (o.shadow) {
      const sc = document.createElement("canvas");
      sc.width = W;
      sc.height = H;
      drawPipShadow(sc.getContext("2d")!, rect, radius, W, H);
      shadow = await canvasToPng(sc);
    }
    out.pips[o.id] = { mask: await canvasToPng(mc), shadow, rect };
  }
  return out;
}
