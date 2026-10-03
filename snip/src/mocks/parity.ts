// Arnés de paridad (solo en modo mock): renderiza cuadros del proyecto con el
// mismo reproductor y compositor WebGL del preview, sobre videos reales, para
// compararlos (SSIM) con lo que exporta FFmpeg. Lo usa e2e/parity.spec.ts.

import type { Project } from "../project/model";
import { canvasFps } from "../project/model";
import { Player } from "../engine/player";
import { ImageCache, renderDecorSequence } from "../engine/raster";

export interface ParityApi {
  /** `urls`: ruta del medio → URL servida. Devuelve un PNG (data URL) por cuadro pedido. */
  render(project: Project, urls: Record<string, string>, frames: number[]): Promise<string[]>;
  /** Secuencia de la capa de decoración, como la arma la app al exportar (PNG en base64). */
  raster(project: Project, urls: Record<string, string>): Promise<{ files: { name: string; data: string }[]; list: string } | null>;
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
      const seq = await renderDecorSequence(project, images);
      if (!seq) return null;
      const files = await Promise.all(
        seq.frames.map(async (f) => {
          const bytes = new Uint8Array(await f.png.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return { name: f.name, data: btoa(bin) };
        }),
      );
      return { files, list: seq.list };
    },
  };
  (window as unknown as { __snipParity: ParityApi }).__snipParity = api;
}
