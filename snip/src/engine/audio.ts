// Audio del preview con WebAudio: cada elemento de video/audio pasa por un
// GainNode (así el volumen puede superar el 100%, y hay fades y ducking).

const sources = new WeakMap<HTMLMediaElement, GainNode | null>();
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
