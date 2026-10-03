// Genera el pack de sonidos de Snip: todo sintetizado acá (osciladores, ruido
// con semilla fija y envolventes), sin muestras de terceros. El resultado es
// determinista y se publica como CC0 (ver src-tauri/sfx/LICENSE.txt).
//
//   node scripts/make-sfx.mjs
//
// Escribe WAV 48 kHz, 16 bits, estéreo en src-tauri/sfx/.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const RATE = 48000;
const OUT = new URL("../src-tauri/sfx/", import.meta.url).pathname;

// Ruido blanco con semilla (mulberry32): mismo archivo en cada corrida.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (secs) => Math.round(secs * RATE);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Filtro de estado variable (pasabanda/pasabajos) con frecuencia variable. */
function svf(input, freqAt, q, mode) {
  const out = new Float32Array(input.length);
  let low = 0;
  let band = 0;
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * clamp(freqAt(i / RATE), 20, RATE / 4)) / RATE);
    const high = input[i] - low - q * band;
    band += f * high;
    low += f * band;
    out[i] = mode === "band" ? band : mode === "high" ? high : low;
  }
  return out;
}

function noise(secs, seed) {
  const r = rng(seed);
  return Float32Array.from({ length: n(secs) }, () => r() * 2 - 1);
}

function env(len, attack, release, curve = 2) {
  return Float32Array.from({ length: len }, (_, i) => {
    const t = i / RATE;
    const total = len / RATE;
    const a = attack > 0 ? smooth(t / attack) : 1;
    const r = Math.pow(clamp((total - t) / release, 0, 1), curve);
    return a * r;
  });
}

function mul(a, b) {
  return a.map((v, i) => v * (b[i] ?? 0));
}

function mix(...xs) {
  const len = Math.max(...xs.map((x) => x.length));
  const out = new Float32Array(len);
  for (const x of xs) for (let i = 0; i < x.length; i++) out[i] += x[i];
  return out;
}

function tone(secs, freqAt, shape = "sine") {
  const out = new Float32Array(n(secs));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    ph += (2 * Math.PI * freqAt(i / RATE)) / RATE;
    const s = Math.sin(ph);
    out[i] = shape === "square" ? Math.sign(s) * 0.6 : shape === "tri" ? (2 / Math.PI) * Math.asin(s) : s;
  }
  return out;
}

/** Normaliza al pico pedido (dBFS). */
function normalize(x, peakDb = -1) {
  const m = x.reduce((a, v) => Math.max(a, Math.abs(v)), 1e-9);
  const g = Math.pow(10, peakDb / 20) / m;
  return x.map((v) => v * g);
}

/** Estéreo con un paneo que puede moverse (−1..1). */
function stereo(x, panAt = () => 0) {
  const out = new Float32Array(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    const p = (clamp(panAt(i / RATE), -1, 1) + 1) * (Math.PI / 4);
    out[i * 2] = x[i] * Math.cos(p) * Math.SQRT2;
    out[i * 2 + 1] = x[i] * Math.sin(p) * Math.SQRT2;
  }
  return out;
}

function wav(name, inter) {
  const frames = inter.length / 2;
  const buf = Buffer.alloc(44 + frames * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + frames * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < inter.length; i++) buf.writeInt16LE(Math.round(clamp(inter[i], -1, 1) * 32767), 44 + i * 2);
  writeFileSync(join(OUT, name), buf);
  return name;
}

const SOUNDS = {
  // Ruido filtrado que barre de grave a agudo y vuelve, cruzando de izquierda a derecha.
  "whoosh.wav": () => {
    const d = 0.7;
    const x = svf(noise(d, 1), (t) => 300 + 2600 * Math.sin((Math.PI * t) / d), 0.7, "band");
    return stereo(normalize(mul(x, env(x.length, 0.3, 0.35, 1.5)), -3), (t) => -0.8 + (1.6 * t) / d);
  },
  // Más corto y agudo, para cortes rápidos.
  "swish.wav": () => {
    const d = 0.35;
    const x = svf(noise(d, 2), (t) => 1500 + 5000 * (t / d), 0.5, "band");
    return stereo(normalize(mul(x, env(x.length, 0.12, 0.2, 2)), -4), (t) => 0.6 - (1.2 * t) / d);
  },
  // Burbuja: seno que sube rápido con caída corta.
  "pop.wav": () => {
    const d = 0.16;
    const x = tone(d, (t) => 380 + 900 * Math.min(1, t / 0.03));
    return stereo(normalize(mul(x, env(x.length, 0.004, 0.13, 3)), -2));
  },
  // Clic seco de interfaz.
  "click.wav": () => {
    const d = 0.05;
    const x = mix(mul(svf(noise(d, 3), () => 4000, 0.4, "band"), env(n(d), 0.0005, 0.03, 4)), mul(tone(d, () => 2200), env(n(d), 0.0005, 0.02, 4)));
    return stereo(normalize(x, -4));
  },
  // Golpe: grave que baja + ruido corto encima.
  "impact.wav": () => {
    const d = 0.9;
    const body = mul(tone(d, (t) => 45 + 110 * Math.exp(-t * 18)), env(n(d), 0.002, 0.85, 2.5));
    const crack = mul(svf(noise(d, 4), () => 2500, 0.8, "low"), env(n(d), 0.001, 0.12, 3));
    return stereo(normalize(mix(body, crack.map((v) => v * 0.6)), -1));
  },
  // Explosión grave y larga.
  "boom.wav": () => {
    const d = 1.6;
    const rumble = mul(svf(noise(d, 5), (t) => 900 * Math.exp(-t * 3) + 60, 0.9, "low"), env(n(d), 0.004, 1.5, 2));
    const sub = mul(tone(d, (t) => 38 + 40 * Math.exp(-t * 6)), env(n(d), 0.003, 1.4, 2));
    return stereo(normalize(mix(rumble.map((v) => v * 1.4), sub), -1));
  },
  // Transición: ruido y tono que suben y se cortan (para antes de un corte).
  "riser.wav": () => {
    const d = 2;
    const air = mul(svf(noise(d, 6), (t) => 400 + 6000 * Math.pow(t / d, 2), 0.6, "band"), env(n(d), 1.8, 0.04, 1));
    const sweep = mul(tone(d, (t) => 200 + 900 * Math.pow(t / d, 2), "tri"), env(n(d), 1.9, 0.04, 1));
    return stereo(normalize(mix(air, sweep.map((v) => v * 0.25)), -3));
  },
  // Campanita: dos parciales inarmónicos con caída larga.
  "ding.wav": () => {
    const d = 1.2;
    const x = mix(tone(d, () => 1318.5), tone(d, () => 2637).map((v) => v * 0.4), tone(d, () => 3950).map((v) => v * 0.15));
    return stereo(normalize(mul(x, env(n(d), 0.002, 1.15, 3)), -4));
  },
  // Notificación: dos notas ascendentes.
  "notification.wav": () => {
    const note = (f, d) => mul(mix(tone(d, () => f), tone(d, () => f * 2).map((v) => v * 0.3)), env(n(d), 0.004, d - 0.01, 2.5));
    const a = note(880, 0.18);
    const b = note(1318.5, 0.4);
    const out = new Float32Array(n(0.14) + b.length);
    out.set(a, 0);
    for (let i = 0; i < b.length; i++) out[n(0.14) + i] += b[i];
    return stereo(normalize(out, -4));
  },
  // Glitch digital: tramos cortos de onda cuadrada y ruido que saltan.
  "glitch.wav": () => {
    const d = 0.45;
    const r = rng(7);
    const out = new Float32Array(n(d));
    const seg = n(0.025);
    for (let s = 0; s < out.length; s += seg) {
      const kind = r();
      const f = 200 + r() * 2000;
      for (let i = s; i < Math.min(out.length, s + seg); i++) {
        const t = i / RATE;
        out[i] = kind < 0.45 ? Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.5 : kind < 0.8 ? (r() * 2 - 1) * 0.6 : 0;
      }
    }
    return stereo(normalize(mul(out, env(out.length, 0.002, 0.05, 1)), -7), () => (r() - 0.5) * 0.6);
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(SOUNDS)) console.log(wav(name, make()));
