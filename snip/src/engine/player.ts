// Reproductor del preview: reloj del timeline, elementos <video> que lo siguen
// (con corrección de deriva y precarga del clip siguiente), audio con WebAudio
// y el compositor WebGL que arma cada cuadro.

import type { Clip, Look, MediaRef, MusicClip, Project } from "../project/model";
import { canvasFps, LOUDNORM_I } from "../project/model";
import { activeAt, layout, sourceTime, totalDuration, type Span } from "../project/timeline";
import { dbToGain, resumeAudio, setGain, setMasterVolume } from "./audio";
import { Renderer, type ClipDraw, type FrameDraw } from "./renderer";
import { clipGeometry, zoomAt } from "./effects";
import { colorPipeline, sharpenWeight } from "./color";

export interface ClipSource {
  url: string;
  /** Intermedio de la etapa pesada: el tiempo local del clip es el tiempo del archivo. */
  processed: boolean;
}

export interface SourceResolver {
  clipSource(clip: Clip, media: MediaRef): ClipSource | null;
  mediaUrl(media: MediaRef): string | null;
  /** Picos de la forma de onda (100 por segundo) si ya se cargaron. */
  peaks(media: MediaRef): Uint8Array | null;
  /** Capas rasterizadas (texto/subtítulos) para el tiempo t, si hay. */
  layers?(t: number, w: number, h: number): TexImageSource[];
}

interface Slot {
  el: HTMLVideoElement;
  url: string;
  owner: string | null;
  used: number;
  broken: boolean;
}

interface Want {
  key: string;
  url: string;
  time: number;
  rate: number;
  gain: number;
  play: boolean;
}

const MAX_SLOTS = 6;
const PRELOAD_SECS = 1.5;

/** Pequeño margen para que el seek caiga dentro del cuadro y no en el borde. */
function frameSeek(t: number, fps: number): number {
  return t + Math.min(0.001, 0.25 / Math.max(1, fps));
}

export type PlayerListener = (time: number, playing: boolean) => void;

export class Player {
  private project: Project | null = null;
  private spans: Span[] = [];
  private total = 0;
  private resolver: SourceResolver;
  private slots: Slot[] = [];
  private music = new Map<string, HTMLAudioElement>();
  private host: HTMLDivElement;
  private renderer: Renderer | null = null;
  private raf = 0;
  private renderQueued = false;
  private startNow = 0;
  private startTime = 0;
  private listeners = new Set<PlayerListener>();
  private brokenListeners = new Set<(url: string) => void>();
  time = 0;
  playing = false;
  rate = 1;
  loop: [number, number] | null = null;
  volume = 1;
  muted = false;
  renderW = 1920;
  renderH = 1080;
  /** Edición del recorte / zoom: el clip se dibuja sin recorte o sin zoom. */
  override: { clipId: string; noCrop?: boolean; noZoom?: boolean } | null = null;

  constructor(resolver: SourceResolver) {
    this.resolver = resolver;
    this.host = document.createElement("div");
    this.host.setAttribute("aria-hidden", "true");
    this.host.style.cssText = "position:fixed;left:-20px;top:-20px;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden";
    document.body.appendChild(this.host);
  }

  attachCanvas(canvas: HTMLCanvasElement | null) {
    this.renderer?.dispose();
    this.renderer = null;
    if (!canvas) return;
    try {
      this.renderer = new Renderer(canvas);
    } catch {
      this.renderer = null;
    }
    this.requestRender();
  }

  hasRenderer(): boolean {
    return !!this.renderer;
  }

  on(l: PlayerListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onBroken(l: (url: string) => void) {
    this.brokenListeners.add(l);
    return () => this.brokenListeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l(this.time, this.playing);
  }

  setProject(p: Project | null) {
    this.project = p;
    this.spans = p ? layout(p.clips) : [];
    this.total = p ? totalDuration(p) : 0;
    if (this.time > this.total) this.time = Math.max(0, this.total - this.frameDur());
    this.syncMusicElements();
    this.requestRender();
  }

  setResolver(r: SourceResolver) {
    this.resolver = r;
    this.requestRender();
  }

  duration() {
    return this.total;
  }

  fps(): number {
    return this.project ? canvasFps(this.project.canvas) : 30;
  }

  frameDur(): number {
    return 1 / this.fps();
  }

  setVolume(v: number, muted: boolean) {
    this.volume = v;
    this.muted = muted;
    setMasterVolume(muted ? 0 : v);
  }

  // ------------------------------ Transporte ------------------------------

  seek(t: number) {
    const f = this.fps();
    const max = Math.max(0, this.total - 1 / f);
    // Cuantizado al cuadro del lienzo.
    this.time = Math.min(max, Math.max(0, Math.round(t * f) / f));
    if (this.playing) {
      this.startNow = performance.now();
      this.startTime = this.time;
    }
    this.sync(false);
    this.emit();
    this.requestRender();
  }

  play() {
    if (!this.project || this.total <= 0) return;
    resumeAudio();
    const [a, b] = this.loop ?? [0, this.total];
    if (this.time >= b - this.frameDur() * 0.5 || this.time < a - 1e-6) this.time = a;
    this.playing = true;
    this.startNow = performance.now();
    this.startTime = this.time;
    this.loopTick();
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.rate = 1;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    // Quedamos en un cuadro exacto.
    this.seek(this.time);
    for (const s of this.slots) s.el.pause();
    for (const m of this.music.values()) m.pause();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else {
      this.rate = 1;
      this.play();
    }
  }

  setRate(rate: number) {
    if (rate === 0) {
      this.pause();
      return;
    }
    this.startTime = this.time;
    this.startNow = performance.now();
    this.rate = rate;
    if (!this.playing) this.play();
  }

  step(frames: number) {
    this.pause();
    this.seek(this.time + frames * this.frameDur());
  }

  private loopTick = () => {
    if (!this.playing) return;
    const now = performance.now();
    let t = this.startTime + ((now - this.startNow) / 1000) * this.rate;
    const [a, b] = this.loop ?? [0, this.total];
    if (this.rate > 0 && t >= b - 1e-6) {
      if (this.loop) {
        t = a;
        this.startTime = a;
        this.startNow = now;
        this.time = t;
        this.sync(true, true);
      } else {
        this.time = Math.max(0, b - this.frameDur());
        this.playing = false;
        this.rate = 1;
        for (const s of this.slots) s.el.pause();
        for (const m of this.music.values()) m.pause();
        this.sync(false);
        this.renderNow();
        this.emit();
        return;
      }
    } else if (this.rate < 0 && t <= a) {
      this.time = a;
      this.playing = false;
      this.rate = 1;
      this.sync(false);
      this.renderNow();
      this.emit();
      return;
    }
    this.time = t;
    this.sync(this.rate > 0);
    this.renderNow();
    this.emit();
    this.raf = requestAnimationFrame(this.loopTick);
  };

  // --------------------------- Elementos de video ---------------------------

  private slotFor(key: string, url: string, now: number): Slot | null {
    let s = this.slots.find((x) => x.owner === key && x.url === url);
    if (!s) s = this.slots.find((x) => x.owner === null && x.url === url);
    if (!s) s = this.slots.find((x) => x.owner === null);
    if (!s && this.slots.length < MAX_SLOTS) {
      const el = document.createElement("video");
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.playsInline = true;
      el.disablePictureInPicture = true;
      el.preservesPitch = true;
      const slot: Slot = { el, url: "", owner: null, used: 0, broken: false };
      el.addEventListener("seeked", () => this.requestRender());
      el.addEventListener("loadeddata", () => {
        if (el.videoWidth === 0) this.markBroken(slot);
        this.requestRender();
      });
      el.addEventListener("error", () => this.markBroken(slot));
      this.host.appendChild(el);
      this.slots.push(slot);
      s = slot;
    }
    if (!s) {
      // Reusar el que hace más que no se usa.
      s = [...this.slots].sort((a, b) => a.used - b.used)[0];
    }
    if (!s) return null;
    s.owner = key;
    s.used = now;
    if (s.url !== url) {
      s.url = url;
      s.broken = false;
      s.el.src = url;
    }
    return s;
  }

  private markBroken(slot: Slot) {
    if (slot.broken) return;
    slot.broken = true;
    for (const l of this.brokenListeners) l(slot.url);
  }

  /** Qué elementos hacen falta ahora (y cuál precargar). */
  private wants(playing: boolean): { wants: Want[]; frame: ReturnType<typeof activeAt> } {
    const p = this.project;
    const out: Want[] = [];
    if (!p) return { wants: out, frame: null };
    const frame = activeAt(this.spans, this.time);
    if (!frame) return { wants: out, frame };
    const add = (i: number, layerGain: number, play: boolean) => {
      const c = p.clips[i];
      const m = p.media.find((x) => x.id === c.mediaId);
      if (!m) return;
      const src = this.resolver.clipSource(c, m);
      if (!src) return;
      const u = Math.max(0, this.time - this.spans[i].start);
      const time = src.processed ? u : sourceTime(c, u);
      const forward = src.processed || (!c.reverse && c.loopMode !== "boomerang");
      const rate = src.processed ? this.rate : c.speed * this.rate;
      out.push({
        key: c.id,
        url: src.url,
        time: c.kind === "freeze" ? c.inPoint : time,
        rate,
        gain: layerGain * this.clipGain(c, m, u, this.spans[i].duration),
        play: play && forward && c.kind !== "freeze" && rate > 0,
      });
    };
    if (frame.b !== null) {
      // acrossfade con curvas triangulares (lineales).
      add(frame.a, frame.progress, playing);
      add(frame.b, 1 - frame.progress, playing);
    } else add(frame.a, 1, playing);
    // Precarga del siguiente clip.
    const next = (frame.b ?? frame.a) + 1;
    if (next < p.clips.length && this.spans[next].start - this.time < PRELOAD_SECS) {
      const c = p.clips[next];
      const m = p.media.find((x) => x.id === c.mediaId);
      const src = m ? this.resolver.clipSource(c, m) : null;
      if (src) out.push({ key: c.id, url: src.url, time: src.processed ? 0 : sourceTime(c, 0), rate: 1, gain: 0, play: false });
    }
    return { wants: out, frame };
  }

  /** Ganancia del audio del clip en el tiempo local u (volumen, normalizar, fades). */
  private clipGain(c: Clip, m: MediaRef, u: number, d: number): number {
    const a = c.audio;
    if (!m.hasAudio || a.removed || a.muted || c.kind === "freeze") return 0;
    let g = a.volume;
    if (a.normalize) {
      const db = Math.min(LOUDNORM_I - a.normalize.inputI, -1 - a.normalize.inputTp);
      g *= dbToGain(db);
    }
    if (a.fadeIn > 0 && u < a.fadeIn) g *= u / a.fadeIn;
    if (a.fadeOut > 0 && u > d - a.fadeOut) g *= Math.max(0, (d - u) / a.fadeOut);
    return g * this.globalFade();
  }

  /** Fundido global (a negro / silencio) al inicio y al final. */
  globalFade(t = this.time): number {
    const p = this.project;
    if (!p) return 1;
    let f = 1;
    if (p.fades.fadeIn > 0) f = Math.min(f, Math.max(0, t / p.fades.fadeIn));
    if (p.fades.fadeOut > 0) f = Math.min(f, Math.max(0, (this.total - t) / p.fades.fadeOut));
    return Math.min(1, f);
  }

  /** Ajusta los elementos al reloj. `playing`: reproducir; si no, seek exacto. */
  private sync(playing: boolean, hardSeek = false) {
    const now = performance.now();
    const { wants } = this.wants(playing);
    const keys = new Set<string>();
    const fps = this.fps();
    for (const w of wants) {
      const s = this.slotFor(w.key, w.url, now);
      if (!s) continue;
      keys.add(w.key);
      const el = s.el;
      setGain(el, w.gain);
      if (w.play) {
        const drift = el.currentTime - w.time;
        const rate = Math.min(16, Math.max(0.0625, w.rate));
        if (el.paused || hardSeek || Math.abs(drift) > 0.3) {
          if (Math.abs(drift) > 0.02 || el.readyState < 2) el.currentTime = w.time;
          el.playbackRate = rate;
          if (el.paused) void el.play().catch(() => {});
        } else if (Math.abs(drift) > 0.04) {
          // Corrección suave de deriva sin saltar.
          el.playbackRate = Math.min(16, Math.max(0.0625, rate * (1 - Math.max(-0.1, Math.min(0.1, drift)))));
        } else {
          el.playbackRate = rate;
        }
      } else {
        if (!el.paused) el.pause();
        const target = frameSeek(w.time, fps);
        if (Math.abs(el.currentTime - target) > 0.5 / Math.max(fps, 1) && !el.seeking) el.currentTime = target;
        else if (el.seeking && Math.abs(el.currentTime - target) > 0.5 / Math.max(fps, 1)) el.currentTime = target;
      }
    }
    for (const s of this.slots) {
      if (s.owner && !keys.has(s.owner)) {
        s.owner = null;
        if (!s.el.paused) s.el.pause();
        setGain(s.el, 0);
      }
    }
    this.syncMusic(playing);
  }

  // --------------------------------- Música ---------------------------------

  private syncMusicElements() {
    const p = this.project;
    const ids = new Set(p?.music.map((m) => m.id) ?? []);
    for (const [id, el] of this.music) {
      if (!ids.has(id)) {
        el.pause();
        el.removeAttribute("src");
        el.remove();
        this.music.delete(id);
      }
    }
    for (const mu of p?.music ?? []) {
      const media = p!.media.find((m) => m.id === mu.mediaId);
      const url = media ? this.resolver.mediaUrl(media) : null;
      if (!url) continue;
      let el = this.music.get(mu.id);
      if (!el) {
        el = document.createElement("audio");
        el.crossOrigin = "anonymous";
        el.preload = "auto";
        this.host.appendChild(el);
        this.music.set(mu.id, el);
      }
      if (el.getAttribute("src") !== url) el.src = url;
    }
  }

  /** Nivel del audio principal en t (0..1), para el ducking. */
  private mainLevel(t: number): number {
    const p = this.project;
    if (!p) return 0;
    const f = activeAt(this.spans, t);
    if (!f) return 0;
    const c = p.clips[f.b ?? f.a];
    const m = p.media.find((x) => x.id === c.mediaId);
    if (!m || !m.hasAudio || c.audio.muted || c.audio.removed || c.kind === "freeze") return 0;
    const peaks = this.resolver.peaks(m);
    if (!peaks) return 0.5;
    const st = sourceTime(c, t - this.spans[f.b ?? f.a].start);
    const i = Math.floor(st * 100);
    let v = 0;
    for (let k = Math.max(0, i - 10); k < Math.min(peaks.length, i + 10); k++) v = Math.max(v, peaks[k]);
    return v / 255;
  }

  private musicGain(mu: MusicClip, t: number): number {
    const len = mu.outPoint - mu.inPoint;
    const u = t - mu.start;
    let g = mu.volume;
    if (mu.fadeIn > 0 && u < mu.fadeIn) g *= Math.max(0, u / mu.fadeIn);
    if (mu.fadeOut > 0 && u > len - mu.fadeOut) g *= Math.max(0, (len - u) / mu.fadeOut);
    if (mu.ducking) {
      // Aproximación del sidechaincompress de la exportación: baja ~10 dB con voz.
      const lvl = this.mainLevel(t);
      if (lvl > 0.17) g *= 0.32;
    }
    return g * this.globalFade(t);
  }

  private syncMusic(playing: boolean) {
    const p = this.project;
    if (!p) return;
    for (const mu of p.music) {
      const el = this.music.get(mu.id);
      if (!el) continue;
      const len = mu.outPoint - mu.inPoint;
      const u = this.time - mu.start;
      const inside = u >= 0 && u < len && this.time < this.total;
      if (!inside) {
        if (!el.paused) el.pause();
        setGain(el, 0);
        continue;
      }
      const target = mu.inPoint + u;
      setGain(el, this.musicGain(mu, this.time));
      if (playing && this.rate > 0) {
        if (el.paused || Math.abs(el.currentTime - target) > 0.25) {
          el.currentTime = target;
          el.playbackRate = Math.min(4, this.rate);
          void el.play().catch(() => {});
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
      }
    }
  }

  // --------------------------------- Render ---------------------------------

  requestRender() {
    if (this.renderQueued || this.playing) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.playing) {
        this.sync(false);
        this.renderNow();
      }
    });
  }

  private clipDraw(i: number, p: Project): ClipDraw | null {
    const c = p.clips[i];
    const s = this.slots.find((x) => x.owner === c.id);
    if (!s || s.el.readyState < 2 || s.el.videoWidth === 0) return null;
    const u = Math.max(0, this.time - this.spans[i].start);
    const media = p.media.find((m) => m.id === c.mediaId);
    const geo = clipGeometry(c.video, media && media.width > 0 ? media : { width: s.el.videoWidth, height: s.el.videoHeight });
    const ov = this.override?.clipId === c.id ? this.override : null;
    return {
      source: s.el,
      texW: s.el.videoWidth,
      texH: s.el.videoHeight,
      crop: ov?.noCrop ? { x: 0, y: 0, w: 1, h: 1 } : geo.crop,
      dispW: ov?.noCrop ? geo.fullWidth : geo.width,
      dispH: ov?.noCrop ? geo.fullHeight : geo.height,
      rotate: c.video.rotate,
      flipH: c.video.flipH,
      flipV: c.video.flipV,
      zoom: ov?.noZoom ? { zoom: 1, cx: 0.5, cy: 0.5 } : zoomAt(c.video.zoom, u),
      color: colorPipeline(c.video.color, c.video.look),
      sharpen: sharpenWeight(c.video.sharpen),
    };
  }

  private thumbRenderer: Renderer | null = null;

  /**
   * Miniaturas del cuadro actual con distintos looks (para elegir uno). Usa el
   * clip bajo el playhead con sus ajustes; null si todavía no hay cuadro.
   */
  lookThumbs(looks: (Look | null)[], w: number, h: number): string[] | null {
    const p = this.project;
    if (!p) return null;
    const f = activeAt(this.spans, this.time);
    if (!f) return null;
    const i = f.b ?? f.a;
    const base = this.clipDraw(i, p);
    if (!base) return null;
    try {
      if (!this.thumbRenderer) {
        const canvas = document.createElement("canvas");
        this.thumbRenderer = new Renderer(canvas);
      }
      const r = this.thumbRenderer;
      r.canvas.width = w;
      r.canvas.height = h;
      const c = p.clips[i];
      return looks.map((look) => {
        r.render({ a: { ...base, zoom: { zoom: 1, cx: 0.5, cy: 0.5 }, color: colorPipeline(c.video.color, look) }, b: null, transition: null, fade: 1, layers: [] }, w, h);
        return r.canvas.toDataURL("image/jpeg", 0.82);
      });
    } catch {
      return null;
    }
  }

  /** Arma la descripción del cuadro actual. */
  frameDraw(): FrameDraw | null {
    const p = this.project;
    if (!p) return null;
    const f = activeAt(this.spans, this.time);
    if (!f) return { a: null, b: null, transition: null, fade: 1, layers: [] };
    const a = this.clipDraw(f.a, p);
    const b = f.b !== null ? this.clipDraw(f.b, p) : null;
    const kind = f.b !== null ? p.clips[f.b].transition?.kind ?? "fade" : null;
    return {
      a,
      b,
      transition: f.b !== null && kind ? { kind, progress: f.progress } : null,
      fade: this.globalFade(),
      layers: this.resolver.layers?.(this.time, this.renderW, this.renderH) ?? [],
    };
  }

  private renderNow() {
    if (!this.renderer) return;
    const f = this.frameDraw();
    if (!f) return;
    // Si el clip que entra todavía no tiene cuadro, mostramos el que sale.
    if (f.transition && !f.b) f.transition = null;
    this.renderer.render(f, this.renderW, this.renderH);
  }

  /** Tamaño interno de render (el canvas se estira con CSS). */
  setRenderSize(w: number, h: number) {
    this.renderW = Math.max(2, Math.round(w));
    this.renderH = Math.max(2, Math.round(h));
    this.requestRender();
  }

  /** Espera a que los elementos tengan el cuadro de t listo. */
  async settle(t: number, timeoutMs = 4000): Promise<void> {
    this.pause();
    this.seek(t);
    const started = performance.now();
    for (;;) {
      this.sync(false);
      const { wants } = this.wants(false);
      const fps = this.fps();
      const ready = wants
        .filter((w) => w.gain >= 0 && this.slots.some((s) => s.owner === w.key))
        .every((w) => {
          const s = this.slots.find((x) => x.owner === w.key)!;
          return s.el.readyState >= 2 && !s.el.seeking && Math.abs(s.el.currentTime - frameSeek(w.time, fps)) <= 0.5 / fps;
        });
      if (ready || performance.now() - started > timeoutMs) break;
      await new Promise((r) => setTimeout(r, 16));
    }
    // Un cuadro más para que el decodificador presente la imagen.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  /** Renderiza el cuadro de t a resolución completa y devuelve un PNG. */
  async capture(t: number, width?: number, height?: number): Promise<string> {
    const p = this.project;
    if (!p) throw new Error("Sin proyecto");
    await this.settle(t);
    const w = width ?? p.canvas.width;
    const h = height ?? p.canvas.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const r = new Renderer(canvas);
    try {
      const f = this.frameDraw();
      if (!f) throw new Error("Sin cuadro");
      if (f.transition && !f.b) f.transition = null;
      f.layers = this.resolver.layers?.(this.time, w, h) ?? [];
      r.render(f, w, h);
      return canvas.toDataURL("image/png");
    } finally {
      r.dispose();
    }
  }

  dispose() {
    this.pause();
    this.renderer?.dispose();
    for (const s of this.slots) {
      s.el.pause();
      s.el.removeAttribute("src");
      s.el.load();
    }
    for (const m of this.music.values()) m.pause();
    this.host.remove();
  }
}
