// Timecode con precisión de cuadro: cuadros ↔ segundos ↔ HH:MM:SS:FF.
// Para fps fraccionarios (29.97, 59.94) se usa timecode "non-drop": los
// segundos son reales y FF cuenta los cuadros dentro de ese segundo.

const EPS = 1e-6;
/**
 * Tolerancia en fracción de cuadro: los contenedores redondean los timestamps
 * (WebM a milisegundos, por ejemplo), así que 2,633 s a 30 fps tiene que ser el
 * cuadro 79 y no el 78.
 */
const FRAME_TOLERANCE = 0.02;

/** Cuadro (índice desde 0) que se ve en el segundo `t`. */
export function secondsToFrame(t: number, fps: number): number {
  if (!(fps > 0) || !Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor(t * fps + FRAME_TOLERANCE));
}

/** Segundo en el que empieza el cuadro `frame`. */
export function frameToSeconds(frame: number, fps: number): number {
  if (!(fps > 0)) return 0;
  return Math.max(0, frame) / fps;
}

/** Redondea un tiempo al borde de cuadro más cercano. */
export function snapToFrame(t: number, fps: number): number {
  if (!(fps > 0)) return t;
  return Math.round(t * fps) / fps;
}

function pad(n: number, w = 2): string {
  return String(Math.max(0, Math.trunc(n))).padStart(w, "0");
}

/** Primer cuadro cuyo inicio cae dentro del segundo `whole`. */
function firstFrameOfSecond(whole: number, fps: number): number {
  return Math.ceil(whole * fps - 1e-7);
}

/** Cuadro → "HH:MM:SS:FF". */
export function frameToTimecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const secs = f / fps;
  const whole = Math.floor(secs + EPS);
  let ff = f - firstFrameOfSecond(whole, fps);
  if (ff < 0) ff = 0;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(ff)}`;
}

/** Segundos → "HH:MM:SS:FF" (usa el cuadro que se ve en ese instante). */
export function secondsToTimecode(t: number, fps: number): string {
  return frameToTimecode(secondsToFrame(t, fps), fps);
}

/**
 * Texto → cuadro. Acepta:
 *  - "HH:MM:SS:FF"
 *  - "HH:MM:SS" o "MM:SS" (los segundos pueden tener decimales)
 *  - "SS" o "SS.mmm"
 * Separadores ":" o ";". Devuelve null si no se entiende.
 */
export function parseTimecode(text: string, fps: number): number | null {
  const s = text.trim().replace(/;/g, ":").replace(",", ".");
  if (!s) return null;
  if (!/^[0-9:.]+$/.test(s)) return null;
  const parts = s.split(":");
  if (parts.some((p) => p === "") || parts.length > 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  if (parts.length === 4) {
    const [h, m, sec, ff] = nums;
    if (!Number.isInteger(ff) || parts[3].includes(".")) return null;
    if (m >= 60 || sec >= 60 || ff >= Math.ceil(fps)) return null;
    return firstFrameOfSecond(h * 3600 + m * 60 + Math.floor(sec), fps) + ff;
  }
  let total = 0;
  if (parts.length === 3) {
    const [h, m, sec] = nums;
    if (m >= 60 || sec >= 60) return null;
    total = h * 3600 + m * 60 + sec;
  } else if (parts.length === 2) {
    const [m, sec] = nums;
    if (sec >= 60) return null;
    total = m * 60 + sec;
  } else {
    total = nums[0];
  }
  return Math.round(total * fps);
}

/** Duración legible y corta: "1:05", "12,4 s", "1:02:03". */
export function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  if (secs < 10) return `${secs.toFixed(1).replace(".", ",")} s`;
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Fps legibles: 30, 29,97, 59,94. */
export function formatFps(fps: number): string {
  const r = Math.round(fps * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(".", ",");
}
