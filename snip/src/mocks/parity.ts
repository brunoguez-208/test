// Arnés de paridad (solo en modo mock): renderiza cuadros del proyecto con el
// mismo reproductor y compositor WebGL del preview, sobre videos reales, para
// compararlos (SSIM) con lo que exporta FFmpeg. Lo usa e2e/parity.spec.ts.

import type { Project, VoiceEnhance } from "../project/model";
import { buildVoiceChain, compressorTrim } from "../engine/audio";
import { voiceParams } from "../engine/audioFx";
import { canvasFps } from "../project/model";
import { Player } from "../engine/player";
import { ImageCache, renderDecorSequence, renderZoneAssets } from "../engine/raster";

export interface ParityApi {
  /** `urls`: ruta del medio → URL servida. Devuelve un PNG (data URL) por cuadro pedido. */
  render(project: Project, urls: Record<string, string>, frames: number[]): Promise<string[]>;
  /** Capas rasterizadas, como las arma la app al exportar (PNG en base64). */
  raster(project: Project, urls: Record<string, string>): Promise<ParityRaster>;
  /**
   * "Mejorar voz" del preview sobre una suma de senos (amplitud `amp` cada uno):
   * renderiza con OfflineAudioContext y devuelve el nivel (dB) de cada tono.
   */
  voice(enhance: VoiceEnhance | null, freqs: number[], amp: number, seconds: number): Promise<number[]>;
}

/** Nivel (dB RMS) de una frecuencia en una señal (Goertzel). Igual en el test de Node. */
export function goertzelDb(x: Float32Array, rate: number, f: number): number {
  const w = (2 * Math.PI * f) / rate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2;
  const amp = (2 * Math.sqrt(Math.max(0, power))) / x.length;
  return 20 * Math.log10(Math.max(1e-9, amp / Math.SQRT2));
}

export interface ParityRaster {
  files: { name: string; data: string }[];
  decor: string | null;
  masks: Record<string, string>;
  pips: Record<string, { mask: string; shadow: string | null; width: number; height: number; x: number; y: number }>;
}

async function b64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function blobUrls(urls: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(urls)) out[path] = URL.createObjectURL(await (await fetch(url)).blob());
  return out;
}

export function installParity() {
  const api: ParityApi = {
    async render(project, urls, frames) {
      // Blob URLs: el <video> puede buscar cualquier cuadro sin depender de rangos HTTP.
      const blobs = await blobUrls(urls);
      const player = new Player({
        clipSource: (_c, m) => (blobs[m.path] ? { url: blobs[m.path], processed: false } : null),
        mediaUrl: (m) => blobs[m.path] ?? null,
        peaks: () => null,
      });
      try {
        player.muted = true;
        player.setProject(project);
        await player.images.ready(project);
        const fps = canvasFps(project.canvas);
        const out: string[] = [];
        for (const k of frames) out.push(await player.capture(k / fps));
        return out;
      } finally {
        player.dispose();
        Object.values(blobs).forEach((u) => URL.revokeObjectURL(u));
      }
    },
    async raster(project, urls) {
      const blobs = await blobUrls(urls);
      const images = new ImageCache((m) => blobs[m.path] ?? null);
      await images.ready(project);
      const out: ParityRaster = { files: [], decor: null, masks: {}, pips: {} };
      const seq = await renderDecorSequence(project, images);
      if (seq) {
        for (const f of seq.frames) out.files.push({ name: f.name, data: await b64(f.png) });
        out.decor = seq.list;
      }
      const zones = await renderZoneAssets(project);
      for (const [id, ms] of Object.entries(zones?.masks ?? {})) {
        for (const f of ms.frames) out.files.push({ name: f.name, data: await b64(f.png) });
        out.masks[id] = ms.list;
      }
      for (const [i, [id, a]] of Object.entries(zones?.pips ?? {}).entries()) {
        out.files.push({ name: `pipmask${i}.png`, data: await b64(a.mask) });
        if (a.shadow) out.files.push({ name: `pipshadow${i}.png`, data: await b64(a.shadow) });
        out.pips[id] = { mask: `pipmask${i}.png`, shadow: a.shadow ? `pipshadow${i}.png` : null, width: a.rect.w, height: a.rect.h, x: a.rect.x, y: a.rect.y };
      }
      return out;
    },
    async voice(enhance, freqs, amp, seconds) {
      const rate = 48000;
      const n = Math.round(rate * seconds);
      const ctx = new OfflineAudioContext(1, n, rate);
      const buf = ctx.createBuffer(1, n, rate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (const f of freqs) v += amp * Math.sin((2 * Math.PI * f * i) / rate);
        d[i] = v;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // La compensación del compresor se mide antes (en la app se aplica apenas está).
      if (enhance) await compressorTrim(voiceParams(enhance));
      const chain = enhance ? buildVoiceChain(ctx, voiceParams(enhance)) : [];
      if (chain.length) {
        src.connect(chain[0]);
        chain[chain.length - 1].connect(ctx.destination);
      } else src.connect(ctx.destination);
      src.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      // Se mide de 1 s a 1 s antes del final (sin transitorios).
      const win = out.subarray(rate, n - rate);
      return freqs.map((f) => goertzelDb(win, rate, f));
    },
  };
  (window as unknown as { __snipParity: ParityApi }).__snipParity = api;
}
