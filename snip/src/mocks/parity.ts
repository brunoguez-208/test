// Arnés de paridad (solo en modo mock): renderiza cuadros del proyecto con el
// mismo reproductor y compositor WebGL del preview, sobre videos reales, para
// compararlos (SSIM) con lo que exporta FFmpeg. Lo usa e2e/parity.spec.ts.

import type { Project } from "../project/model";
import { canvasFps } from "../project/model";
import { Player } from "../engine/player";
import { ImageCache, renderDecorSequence, renderZoneAssets } from "../engine/raster";

export interface ParityApi {
  /** `urls`: ruta del medio → URL servida. Devuelve un PNG (data URL) por cuadro pedido. */
  render(project: Project, urls: Record<string, string>, frames: number[]): Promise<string[]>;
  /** Capas rasterizadas, como las arma la app al exportar (PNG en base64). */
  raster(project: Project, urls: Record<string, string>): Promise<ParityRaster>;
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
  };
  (window as unknown as { __snipParity: ParityApi }).__snipParity = api;
}
