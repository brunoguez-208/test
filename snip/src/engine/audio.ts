// Audio del preview con WebAudio: cada elemento de video/audio pasa por un
// GainNode (así el volumen puede superar el 100%, y hay fades y ducking) y,
// si tiene "Mejorar voz", por la misma cadena de filtros que la exportación.

import type { VoiceParams } from "./audioFx";

interface Route {
  src: MediaElementAudioSourceNode;
  gain: GainNode;
  /** Cadena de "Mejorar voz" entre la fuente y la ganancia (vacía = directo). */
  chain: AudioNode[];
  key: string;
}

const sources = new WeakMap<HTMLMediaElement, GainNode | null>();
const routes = new WeakMap<HTMLMediaElement, Route>();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Hay que llamarlo desde un gesto del usuario (play) para que el audio arranque. */
export function resumeAudio() {
  const c = context();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

function gainFor(el: HTMLMediaElement): GainNode | null {
  if (sources.has(el)) return sources.get(el) ?? null;
  const c = context();
  let g: GainNode | null = null;
  if (c && master) {
    try {
      const src = c.createMediaElementSource(el);
      g = c.createGain();
      src.connect(g);
      g.connect(master);
      routes.set(el, { src, gain: g, chain: [], key: "" });
    } catch {
      g = null; // sin WebAudio: se usa el volumen del elemento (máximo 100%)
    }
  }
  sources.set(el, g);
  return g;
}

/** Fija la ganancia de un elemento (0..4) con una rampa corta para evitar clics. */
export function setGain(el: HTMLMediaElement, gain: number) {
  const v = Number.isFinite(gain) ? Math.max(0, Math.min(4, gain)) : 0;
  const g = gainFor(el);
  if (g && ctx) {
    el.muted = false;
    el.volume = 1;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(v, now, 0.015);
  } else {
    el.muted = v <= 0;
    el.volume = Math.min(1, v);
  }
}

/** Volumen general del preview (el del control de volumen). */
export function setMasterVolume(v: number) {
  context();
  if (master && ctx) master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.02);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Nodos de WebAudio de "Mejorar voz" (los mismos biquads RBJ que los filtros
 * de FFmpeg; el compresor es el de WebAudio con los mismos parámetros).
 */
export function buildVoiceChain(c: BaseAudioContext, v: VoiceParams): AudioNode[] {
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = v.highpassHz;
  // En WebAudio el Q de highpass va en dB: 20·log10(0,7071) ≈ −3 dB.
  hp.Q.value = 20 * Math.log10(v.highpassQ);
  const mud = c.createBiquadFilter();
  mud.type = "peaking";
  mud.frequency.value = v.mudHz;
  mud.Q.value = v.mudQ;
  mud.gain.value = v.mudDb;
  const pres = c.createBiquadFilter();
  pres.type = "peaking";
  pres.frequency.value = v.presenceHz;
  pres.Q.value = v.presenceQ;
  pres.gain.value = v.presenceDb;
  const air = c.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = v.airHz;
  air.gain.value = v.airDb;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = v.thresholdDb;
  comp.ratio.value = Math.min(20, v.ratio);
  comp.knee.value = v.kneeDb;
  comp.attack.value = v.attackMs / 1000;
  comp.release.value = v.releaseMs / 1000;
  // El compresor de WebAudio agrega su propia ganancia de compensación (el de
  // FFmpeg, con makeup=1, no): se descuenta con lo medido para estos parámetros.
  const makeup = c.createGain();
  const known = trimCache.get(compKey(v));
  makeup.gain.value = dbToGain(v.makeupDb) / (known ?? 1);
  if (known === undefined) void compressorTrim(v).then((t) => (makeup.gain.value = dbToGain(v.makeupDb) / t));
  const nodes: AudioNode[] = [hp, mud, pres, air, comp, makeup];
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes;
}

/** Activa / cambia / saca "Mejorar voz" en un elemento (null = sin procesar). */
export function setVoice(el: HTMLMediaElement, v: VoiceParams | null) {
  gainFor(el);
  const r = routes.get(el);
  if (!r || !ctx) return;
  const key = v ? JSON.stringify(v) : "";
  if (r.key === key) return;
  r.src.disconnect();
  for (const n of r.chain) n.disconnect();
  r.chain = v ? buildVoiceChain(ctx, v) : [];
  if (r.chain.length) {
    r.src.connect(r.chain[0]);
    r.chain[r.chain.length - 1].connect(r.gain);
  } else r.src.connect(r.gain);
  r.key = key;
}

const trimCache = new Map<string, number>();
const compKey = (v: VoiceParams) => `${v.thresholdDb}|${v.ratio}|${v.kneeDb}|${v.attackMs}|${v.releaseMs}`;

/**
 * Ganancia que el DynamicsCompressorNode aplica por su cuenta a una señal
 * muy por debajo del umbral (su "makeup" automático). Se mide una vez por
 * configuración con un OfflineAudioContext y queda en caché.
 */
export async function compressorTrim(v: VoiceParams): Promise<number> {
  const key = compKey(v);
  const hit = trimCache.get(key);
  if (hit !== undefined) return hit;
  const rate = 48000;
  const n = rate / 2;
  const c = new OfflineAudioContext(1, n, rate);
  const buf = c.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  const amp = dbToGain(v.thresholdDb - v.kneeDb - 30);
  for (let i = 0; i < n; i++) d[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / rate);
  const src = c.createBufferSource();
  src.buffer = buf;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = v.thresholdDb;
  comp.ratio.value = Math.min(20, v.ratio);
  comp.knee.value = v.kneeDb;
  comp.attack.value = v.attackMs / 1000;
  comp.release.value = v.releaseMs / 1000;
  src.connect(comp);
  comp.connect(c.destination);
  src.start();
  const out = (await c.startRendering()).getChannelData(0);
  let a = 0;
  let b = 0;
  for (let i = n / 2; i < n; i++) {
    a += out[i] * out[i];
    b += d[i] * d[i];
  }
  const trim = b > 0 && a > 0 ? Math.sqrt(a / b) : 1;
  trimCache.set(key, trim);
  return trim;
}
