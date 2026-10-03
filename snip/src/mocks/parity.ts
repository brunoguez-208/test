// Arnés de paridad (solo en modo mock): renderiza cuadros del proyecto con el
// mismo reproductor y compositor WebGL del preview, sobre videos reales, para
// compararlos (SSIM) con lo que exporta FFmpeg. Lo usa e2e/parity.spec.ts.

import type { Project } from "../project/model";
import { canvasFps } from "../project/model";
import { Player } from "../engine/player";

export interface ParityApi {
  /** `urls`: ruta del medio → URL servida. Devuelve un PNG (data URL) por cuadro pedido. */
  render(project: Project, urls: Record<string, string>, frames: number[]): Promise<string[]>;
}

export function installParity() {
  const api: ParityApi = {
    async render(project, urls, frames) {
      // Blob URLs: el <video> puede buscar cualquier cuadro sin depender de rangos HTTP.
      const blobs: Record<string, string> = {};
      for (const [path, url] of Object.entries(urls)) {
        blobs[path] = URL.createObjectURL(await (await fetch(url)).blob());
      }
      const player = new Player({
        clipSource: (_c, m) => (blobs[m.path] ? { url: blobs[m.path], processed: false } : null),
        mediaUrl: (m) => blobs[m.path] ?? null,
        peaks: () => null,
      });
      try {
        player.muted = true;
        player.setProject(project);
        const fps = canvasFps(project.canvas);
        const out: string[] = [];
        for (const k of frames) out.push(await player.capture(k / fps));
        return out;
      } finally {
        player.dispose();
        Object.values(blobs).forEach((u) => URL.revokeObjectURL(u));
      }
    },
  };
  (window as unknown as { __snipParity: ParityApi }).__snipParity = api;
}
