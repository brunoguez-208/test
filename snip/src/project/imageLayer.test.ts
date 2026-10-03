import { describe, expect, it } from "vitest";
import { addImageAt, setWatermark, syncWatermarks, updateOverlay } from "./overlayOps";
import { decorKey, drawImageOverlay, imageRect } from "../engine/raster";
import { deleteClips } from "./ops";
import { media, projectWith } from "./testutil";
import type { ImageLayer, MediaRef, Overlay } from "./model";

const logo: MediaRef = { ...media("img", 0, 400, 200, 30, false), kind: "image", path: "C:\\i\\logo.png" };

describe("imagen como capa normal", () => {
  it("se agrega en el playhead, centrada, por 5 s, y se puede repetir", () => {
    let p = projectWith(20);
    let a = "";
    let b = "";
    [p, a] = addImageAt(p, logo, 3);
    [p, b] = addImageAt(p, logo, 4);
    const oa = p.overlays.find((o) => o.id === a)!;
    expect(oa).toMatchObject({ type: "image", start: 3, duration: 5, x: 0.5, y: 0.5 });
    expect(p.overlays.find((o) => o.id === b)!.lane).not.toBe(oa.lane);
    // Un solo medio aunque se use dos veces.
    expect(p.media.filter((m) => m.path === logo.path)).toHaveLength(1);
  });

  it("marca de agua: todo el video y sigue el largo si cambia", () => {
    let p = projectWith(10, 10);
    let id = "";
    [p, id] = addImageAt(p, logo, 2);
    p = setWatermark(p, id, true);
    expect(p.overlays[0]).toMatchObject({ start: 0, duration: 20, watermark: true });
    p = syncWatermarks(deleteClips(p, [p.clips[1].id]));
    expect(p.overlays[0].duration).toBe(10);
    p = setWatermark(p, id, false);
    expect(p.overlays[0]).toMatchObject({ watermark: false, duration: 5 });
  });

  it("la animación de entrada cambia el estado cuadro a cuadro (export = preview)", () => {
    let p = projectWith(10);
    let id = "";
    [p, id] = addImageAt(p, logo, 1);
    p = updateOverlay(p, id, (o) => ({ ...o, animIn: { kind: "pop", duration: 0.4 } }) as Overlay);
    expect(decorKey(p, 1)).toBe(`${id}:in0`);
    expect(decorKey(p, 1 + 1 / 30)).toBe(`${id}:in1`);
    expect(decorKey(p, 2)).toBe(id);
  });

  it("rotación y opacidad se aplican al dibujar", () => {
    let p = projectWith(10);
    let id = "";
    [p, id] = addImageAt(p, logo, 0);
    p = updateOverlay(p, id, (o) => ({ ...o, rotation: 90, opacity: 0.5 }) as Overlay);
    const o = p.overlays[0] as Overlay & ImageLayer;
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => calls.push(`${k}(${args.map((a) => (typeof a === "number" ? a.toFixed(2) : "x")).join(",")})`)),
      set: (t, k: string, v) => ((t[k] = v), calls.push(`${k}=${typeof v === "number" ? v.toFixed(2) : v}`), true),
    });
    drawImageOverlay(ctx as unknown as CanvasRenderingContext2D, p, o, 1920, 1080, { get: () => ({}) as HTMLImageElement }, 5);
    expect(calls).toContain("globalAlpha=0.50");
    expect(calls).toContain("rotate(1.57)");
    const r = imageRect(o, logo, 1920, 1080);
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });
});
