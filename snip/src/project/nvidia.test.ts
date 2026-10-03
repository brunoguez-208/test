import { describe, expect, it } from "vitest";
import { canvasFps, canvasFpsExpr, standardFps } from "./model";
import { insertMedia, newProject } from "./ops";
import { isFastEligible } from "./exportPlan";
import { media } from "./testutil";
import { basename, extension, stem } from "../lib/files";

// Grabaciones de NVIDIA ShadowPlay (VFR, base de tiempo 90000, 2 pistas).

describe("fps estándar (espejo de probe::standard_fps)", () => {
  it("lleva promedios raros a la frecuencia más cercana", () => {
    expect(standardFps(1300000, 21667)).toEqual([60, 1]);
    expect(standardFps(30000, 1001)).toEqual([30000, 1001]);
    expect(standardFps(2997, 100)).toEqual([30000, 1001]);
    expect(standardFps(143900, 1000)).toEqual([144, 1]);
    expect(standardFps(90000, 1)).toEqual([240, 1]);
    expect(standardFps(37, 1)).toEqual([37, 1]);
    expect(standardFps(3733, 100)).toEqual([37, 1]);
    expect(standardFps(0, 0)).toEqual([30, 1]);
  });

  it("el lienzo de un proyecto viejo con 90000/1 se ve a 240", () => {
    const c = { width: 1920, height: 1080, fpsNum: 90000, fpsDen: 1, auto: true };
    expect(canvasFps(c)).toBe(240);
    expect(canvasFpsExpr(c)).toBe("240");
  });

  it("el lienzo automático toma fps normalizados del clip", () => {
    const m = { ...media("m1", 20), path: "C:\\v\\Desktop 2026.10.03 - 04.28.16.07.mp4", fps: 59.99, fpsNum: 1300000, fpsDen: 21667 };
    const p = insertMedia(newProject(1), [m]);
    expect([p.canvas.fpsNum, p.canvas.fpsDen]).toEqual([60, 1]);
  });
});

describe("dos pistas de audio", () => {
  it("nunca van por el modo rápido (se mezclan)", () => {
    const m = media("m1", 20);
    const p = insertMedia(newProject(1), [m]);
    expect(isFastEligible(p)).toBe(true);
    const two = { ...p, media: [{ ...m, audioTracks: 2 }] };
    expect(isFastEligible(two)).toBe(false);
  });
});

describe("nombres con varios puntos", () => {
  const f = "C:\\Videos\\Desktop 2026.10.03 - 04.28.16.07.mp4";
  it("la extensión es solo lo último", () => {
    expect(stem(f)).toBe("Desktop 2026.10.03 - 04.28.16.07");
    expect(extension(f)).toBe("mp4");
    expect(basename(f)).toBe("Desktop 2026.10.03 - 04.28.16.07.mp4");
    expect(extension("C:\\Videos\\Desktop 2026.10.03 - 04.28.16.07")).toBe("07");
  });
});
