import { describe, expect, it } from "vitest";
import { addZoomKey, clampCrop, cropForAspect, flipClip, kenBurns, removeZoomKey, rotateClip, setCrop, setCropAspect, updateZoomKey } from "./imageOps";
import { fitCanvas, splitAt } from "./ops";
import { splitZoomKeys, zoomAt } from "./zoom";
import { projectWith } from "./testutil";

const id0 = (p: ReturnType<typeof projectWith>) => p.clips[0].id;

describe("recorte", () => {
  it("proporción centrada dentro del cuadro", () => {
    const r = cropForAspect(9 / 16, 1920, 1080);
    expect(r.h).toBe(1);
    expect((r.w * 1920) / (r.h * 1080)).toBeCloseTo(9 / 16, 9);
    expect(r.x).toBeCloseTo((1 - r.w) / 2, 9);
    // Centro pegado al borde: el rectángulo no sale del cuadro.
    expect(cropForAspect(1, 1920, 1080, 0.99, 0.5).x).toBeCloseTo(1 - 1080 / 1920, 9);
  });

  it("elegir proporción, libre y original", () => {
    let p = projectWith(10);
    p = setCropAspect(p, id0(p), "1:1");
    expect(p.clips[0].video.crop).toMatchObject({ aspect: "1:1", h: 1 });
    p = setCropAspect(p, id0(p), "free");
    expect(p.clips[0].video.crop?.aspect).toBe("free");
    p = setCropAspect(p, id0(p), "original");
    expect(p.clips[0].video.crop).toBeNull();
  });

  it("el lienzo automático sigue al recorte del primer clip", () => {
    let p = projectWith(10, 5);
    p = fitCanvas(setCropAspect(p, id0(p), "9:16"));
    expect(p.canvas.width).toBeLessThan(p.canvas.height);
    expect(p.canvas.height).toBe(1080);
  });

  it("acota tamaño mínimo y bordes; recorte completo sin proporción = sin recorte", () => {
    expect(clampCrop({ x: 0.98, y: -1, w: 0.001, h: 2 })).toMatchObject({ x: 0.95, y: 0, w: 0.05, h: 1 });
    const p = projectWith(10);
    expect(setCrop(p, id0(p), { x: 0, y: 0, w: 1, h: 1 }).clips[0].video.crop).toBeNull();
  });
});

describe("rotar y voltear", () => {
  it("rotar 4 veces vuelve al principio, con el recorte", () => {
    let p = projectWith(10);
    p = setCrop(p, id0(p), { x: 0.1, y: 0.2, w: 0.3, h: 0.4, aspect: "16:9" });
    const before = p.clips[0].video.crop;
    p = rotateClip(p, id0(p), 1);
    expect(p.clips[0].video.rotate).toBe(90);
    expect(p.clips[0].video.crop).toMatchObject({ x: 0.4, y: 0.1, w: 0.4, h: 0.3, aspect: "9:16" });
    for (let i = 0; i < 3; i++) p = rotateClip(p, id0(p), 1);
    expect(p.clips[0].video.rotate).toBe(0);
    const c = p.clips[0].video.crop!;
    expect([c.x, c.y, c.w, c.h].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([before!.x, before!.y, before!.w, before!.h]);
    p = rotateClip(p, id0(p), -1);
    expect(p.clips[0].video.rotate).toBe(270);
  });

  it("voltear refleja el recorte", () => {
    let p = projectWith(10);
    p = setCrop(p, id0(p), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    p = flipClip(p, id0(p), "h");
    expect(p.clips[0].video.flipH).toBe(true);
    expect(p.clips[0].video.crop!.x).toBeCloseTo(0.6, 9);
    p = flipClip(p, id0(p), "v");
    expect(p.clips[0].video.crop!.y).toBeCloseTo(0.4, 9);
  });
});

describe("keyframes de zoom", () => {
  it("agregar, editar, mover y borrar", () => {
    let p = projectWith(10);
    let k1: number;
    [p, k1] = addZoomKey(p, id0(p), 1);
    expect(p.clips[0].video.zoom).toEqual([{ id: 1, t: 1, zoom: 1, cx: 0.5, cy: 0.5, easing: "easeInOut" }]);
    // Mismo cuadro: devuelve el existente.
    const [p2, again] = addZoomKey(p, id0(p), 1.001);
    expect(again).toBe(k1);
    expect(p2).toBe(p);
    let k2: number;
    [p, k2] = addZoomKey(p, id0(p), 3);
    p = updateZoomKey(p, id0(p), k2, { zoom: 9, cx: 2 });
    expect(p.clips[0].video.zoom[1]).toMatchObject({ zoom: 4, cx: 1 });
    p = updateZoomKey(p, id0(p), k2, { t: 0.5 });
    expect(p.clips[0].video.zoom.map((k) => k.id)).toEqual([k2, k1]);
    p = updateZoomKey(p, id0(p), k2, { t: 99 });
    expect(p.clips[0].video.zoom[1].t).toBe(10);
    p = removeZoomKey(p, id0(p), k1);
    expect(p.clips[0].video.zoom).toHaveLength(1);
  });

  it("acercamiento lento de 1× a 1,3×", () => {
    let p = projectWith(8);
    p = kenBurns(p, id0(p));
    expect(zoomAt(p.clips[0].video.zoom, 0).zoom).toBe(1);
    expect(zoomAt(p.clips[0].video.zoom, 8).zoom).toBeCloseTo(1.3, 9);
  });

  it("dividir conserva el zoom en el corte", () => {
    const keys = [
      { id: 1, t: 0, zoom: 1, cx: 0.5, cy: 0.5, easing: "linear" as const },
      { id: 2, t: 4, zoom: 3, cx: 0.5, cy: 0.5, easing: "linear" as const },
    ];
    const [a, b] = splitZoomKeys(keys, 2, 2);
    expect(zoomAt(a, 2).zoom).toBeCloseTo(2, 9);
    expect(zoomAt(b, 0).zoom).toBeCloseTo(2, 9);
    expect(zoomAt(b, 2).zoom).toBeCloseTo(3, 9);
    let p = projectWith(10);
    p = kenBurns(p, id0(p));
    p = splitAt(p, 5);
    expect(zoomAt(p.clips[0].video.zoom, 5).zoom).toBeCloseTo(zoomAt(p.clips[1].video.zoom, 0).zoom, 9);
  });
});
