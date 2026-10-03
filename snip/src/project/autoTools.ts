// Herramientas automáticas (todo local): detectar jugadas por picos de audio,
// cortar silencios y marcar los beats de la música. Trabajan sobre el análisis
// que hace Rust (nivel en dB y ataques cada 10 ms) llevado al timeline.

import type { Marker, MarkerKind, Project } from "./model";
import { addRange, deleteRange, makeId } from "./ops";
import { layout, sourceTime, totalDuration } from "./timeline";

export const FLOOR_DB = -90;

export interface Analysis {
  rate: number;
  /** dB por cuadro. */
  level: Float32Array;
  /** Ataque 0..1 por cuadro. */
  onset: Float32Array;
}

/** Del formato de Rust (u8 en base64) a números. */
export function decodeAnalysis(a: { rate: number; level: string; onset: string }): Analysis {
  const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const lv = bytes(a.level);
  const on = bytes(a.onset);
  return { rate: a.rate, level: Float32Array.from(lv, (v) => v / 2 - 100), onset: Float32Array.from(on, (v) => v / 255) };
}

/** Nivel (dB) del audio de la pista principal en el timeline, cuadro a cuadro. */
export function timelineLevel(p: Project, get: (mediaId: string) => Analysis | undefined, rate = 100): Float32Array {
  const n = Math.ceil(totalDuration(p) * rate);
  const out = new Float32Array(n).fill(FLOOR_DB);
  const spans = layout(p.clips);
  p.clips.forEach((c, i) => {
    const a = get(c.mediaId);
    const silent = c.kind === "freeze" || c.audio.muted || c.audio.removed || c.audio.detached;
    if (!a || silent) return;
    const s = spans[i];
    for (let k = Math.ceil(s.start * rate); k < Math.min(n, Math.ceil(s.end * rate)); k++) {
      const src = sourceTime(c, k / rate - s.start);
      const j = Math.min(a.level.length - 1, Math.max(0, Math.round(src * a.rate)));
      out[k] = a.level[j];
    }
  });
  return out;
}

const toPow = (db: number) => Math.pow(10, db / 10);
const toDb = (p: number) => (p > 1e-12 ? Math.max(FLOOR_DB, 10 * Math.log10(p)) : FLOOR_DB);

/** Promedio móvil (en potencia) de `win` cuadros, centrado. */
export function smoothDb(level: Float32Array, win: number): Float32Array {
  const n = level.length;
  const pw = Float64Array.from(level, toPow);
  const acc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) acc[i + 1] = acc[i] + pw[i];
  const h = Math.floor(win / 2);
  return Float32Array.from({ length: n }, (_, i) => {
    const a = Math.max(0, i - h);
    const b = Math.min(n, i + h + 1);
    return toDb((acc[b] - acc[a]) / (b - a));
  });
}

function median(v: number[]): number {
  if (!v.length) return FLOOR_DB;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Jugadas: momentos bastante más fuertes que lo normal del video.
 * `sensitivity` 0..1 (más alta = más jugadas). Devuelve tiempos del pico.
 */
export function detectPlays(level: Float32Array, rate: number, sensitivity: number, minGap = 4): number[] {
  const sm = smoothDb(level, Math.round(0.2 * rate));
  const sound = Array.from(sm).filter((v) => v > FLOOR_DB + 1);
  if (!sound.length) return [];
  const thr = median(sound) + (16 - 12 * Math.min(1, Math.max(0, sensitivity)));
  const peaks: { t: number; v: number }[] = [];
  let best = -1;
  for (let i = 0; i <= sm.length; i++) {
    const above = i < sm.length && sm[i] >= thr;
    if (above && (best < 0 || sm[i] > sm[best])) best = i;
    if (!above && best >= 0) {
      peaks.push({ t: best / rate, v: sm[best] });
      best = -1;
    }
  }
  const kept: { t: number; v: number }[] = [];
  for (const pk of peaks.sort((a, b) => b.v - a.v)) if (kept.every((k) => Math.abs(k.t - pk.t) >= minGap)) kept.push(pk);
  return kept.map((k) => k.t).sort((a, b) => a - b);
}

/**
 * Silencios: tramos más bajos que `thresholdDb` de al menos `minDuration`,
 * achicados `margin` de cada lado (queda un poco de aire). [desde, hasta).
 */
export function findSilences(level: Float32Array, rate: number, thresholdDb: number, minDuration: number, margin: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= level.length; i++) {
    const quiet = i < level.length && level[i] < thresholdDb;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      const a = start / rate;
      const b = i / rate;
      if (b - a >= minDuration) {
        const x = a + margin;
        const y = b - margin;
        if (y - x > 0.05) out.push([x, y]);
      }
      start = -1;
    }
  }
  return out;
}

/** Saca los silencios del timeline (de atrás para adelante; una sola edición). */
export function cutSilences(p: Project, silences: [number, number][]): Project {
  let q = p;
  for (const [a, b] of [...silences].sort((x, y) => y[0] - x[0])) {
    try {
      q = deleteRange(q, a, b);
    } catch {
      /* tramo que ya no existe o demasiado corto */
    }
  }
  return q;
}

/** Período (en cuadros, con decimales) más probable entre 60 y 200 BPM. */
export function estimatePeriod(onset: Float32Array, rate: number): number {
  const n = onset.length;
  const mean = onset.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const x = Float32Array.from(onset, (v) => v - mean);
  const lo = Math.round((60 / 200) * rate);
  const hi = Math.round((60 / 60) * rate);
  const ac = new Float64Array(hi + 2);
  for (let L = lo - 1; L <= hi + 1; L++) {
    let s = 0;
    for (let i = 0; i + L < n; i++) s += x[i] * x[i + L];
    ac[L] = s / Math.max(1, n - L);
  }
  let best = lo;
  let bestScore = -Infinity;
  for (let L = lo; L <= hi; L++) {
    // Preferencia suave por tempos cerca de 120 BPM.
    const w = Math.exp(-0.5 * Math.log2(L / (rate / 2)) ** 2);
    const sc = ac[L] * w;
    if (sc > bestScore) {
      bestScore = sc;
      best = L;
    }
  }
  // Interpolación parabólica para el período fraccionario.
  const [a, b, c] = [ac[best - 1], ac[best], ac[best + 1]];
  const d = a - 2 * b + c;
  return d < 0 ? best + (0.5 * (a - c)) / d : best;
}

/** Beats (segundos del archivo) entre `from` y `to`. */
export function detectBeats(a: Analysis, from = 0, to = a.onset.length / a.rate): number[] {
  const i0 = Math.max(0, Math.floor(from * a.rate));
  const i1 = Math.min(a.onset.length, Math.ceil(to * a.rate));
  const on = a.onset.subarray(i0, i1);
  if (on.length < a.rate * 2) return [];
  const period = estimatePeriod(on, a.rate);
  // Fase: la que más ataques junta (cerca de cada beat) en los primeros 8 s;
  // de ahí en adelante cada beat se ajusta al ataque más cercano.
  const win = Math.max(1, Math.round(0.04 * a.rate));
  const near = (c: number) => {
    let m = 0;
    for (let j = Math.max(0, c - win); j <= Math.min(on.length - 1, c + win); j++) m = Math.max(m, on[j]);
    return m;
  };
  const head = Math.min(on.length, 8 * a.rate);
  let phase = 0;
  let best = -1;
  for (let ph = 0; ph < period; ph++) {
    let s = 0;
    for (let t = ph; t < head; t += period) s += near(Math.round(t));
    if (s > best + 1e-9) {
      best = s;
      phase = ph;
    }
  }
  const mean = on.reduce((s, v) => s + v, 0) / on.length;
  const beats: number[] = [];
  for (let t = phase; t < on.length; ) {
    // Ajusta cada beat al ataque más fuerte cerca (sigue al tempo si deriva).
    const c = Math.round(t);
    let k = c;
    for (let j = Math.max(0, c - win); j <= Math.min(on.length - 1, c + win); j++) if (on[j] > on[k]) k = j;
    const at = on[k] > mean * 1.5 ? k : t;
    beats.push((i0 + at) / a.rate);
    t = at + period;
  }
  return beats;
}

/** Agrega marcadores de un tipo (reemplaza los de ese tipo que ya había). */
export function setAutoMarkers(p: Project, kind: MarkerKind, times: number[], name: (i: number) => string): Project {
  const total = totalDuration(p);
  const keep = p.markers.filter((m) => m.kind !== kind);
  const added: Marker[] = times.filter((t) => t >= 0 && t <= total).map((t, i) => ({ id: makeId("k"), time: t, name: name(i), kind }));
  return { ...p, markers: [...keep, ...added].sort((a, b) => a.time - b.time) };
}

/** Un fragmento (rango exportable) de ±pad alrededor de cada jugada. */
export function playRanges(p: Project, times: number[], pad: number): Project {
  let q = p;
  times.forEach((t, i) => {
    try {
      q = addRange(q, t - pad, t + pad, `Jugada ${i + 1}`);
    } catch {
      /* fuera del timeline */
    }
  });
  return q;
}

/** Beats de los clips de música (o del que se elija), en tiempo del timeline. */
export function musicBeats(p: Project, get: (mediaId: string) => Analysis | undefined, onlyId?: string): number[] {
  const out: number[] = [];
  for (const m of p.music) {
    if (onlyId && m.id !== onlyId) continue;
    const a = get(m.mediaId);
    if (!a) continue;
    for (const b of detectBeats(a, m.inPoint, m.outPoint)) out.push(m.start + (b - m.inPoint));
  }
  return out.sort((x, y) => x - y);
}
