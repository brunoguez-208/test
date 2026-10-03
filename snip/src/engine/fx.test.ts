import { describe, expect, it } from "vitest";
import { effectDraws, effectWindow, firstFrame, flashAlpha, glitchShift, glitchStep, vignetteAt, vignetteLevel } from "./fx";
import { addEffect, updateOverlay } from "../project/overlayOps";
import { projectWith } from "../project/testutil";

describe("efectos de un clic (espejo de fx.rs)", () => {
  it("τ empieza en el primer cuadro del bloque", () => {
    expect(firstFrame(1, 30)).toBeCloseTo(1);
    expect(firstFrame(1.01, 30)).toBeCloseTo(31 / 30);
  });

  it("temblor: sube y baja en los bordes, nunca muestra fuera del cuadro", () => {
    expect(effectWindow("shake", 0, 0.6, 1)).toEqual({ cx: 0.5, cy: 0.5, z: 1 });
    for (let t = 0; t <= 0.6; t += 0.01) {
      const w = effectWindow("shake", t, 0.6, 1)!;
      expect(w.cx - 0.5 / w.z).toBeGreaterThanOrEqual(-1e-9);
      expect(w.cx + 0.5 / w.z).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(effectWindow("shake", 0.3, 0.6, 1)!.z).toBeCloseTo(1 + 2.5 * 0.03);
  });

  it("zoom punch: pico rápido y vuelve a 1", () => {
    const z = (t: number) => effectWindow("zoomPunch", t, 0.5, 1)!.z;
    expect(z(0)).toBeCloseTo(1);
    expect(z(0.1)).toBeCloseTo(1.35);
    expect(z(0.5)).toBeCloseTo(1);
    expect(z(0.3)).toBeLessThan(1.35);
  });

  it("flash y viñeta", () => {
    expect(flashAlpha(0, 0.4, 1)).toBe(0);
    expect(flashAlpha(0.08, 0.4, 1)).toBeCloseTo(1);
    expect(flashAlpha(0.4, 0.4, 1)).toBeCloseTo(0);
    expect(flashAlpha(0.08, 0.4, 0.5)).toBeCloseTo(0.5);
    expect(vignetteLevel(1, 2, 1)).toBeCloseTo(0.9);
    expect(vignetteLevel(0, 2, 1)).toBe(0);
    expect(vignetteAt(0.5, 0.5, 1)).toBe(0);
    expect(vignetteAt(0, 0, 1)).toBeCloseTo(1);
  });

  it("glitch: determinista, en enteros", () => {
    expect(glitchStep(0.5333333333)).toBe(8);
    const a = glitchShift(100, 360, 640, 3, 1);
    expect(a).toEqual(glitchShift(100, 360, 640, 3, 1));
    expect(Number.isInteger(a.shift) && Number.isInteger(a.split)).toBe(true);
    // Algunas bandas se corren y otras no.
    const shifts = Array.from({ length: 18 }, (_, b) => glitchShift(b * 20, 360, 640, 5, 1).shift);
    expect(shifts.some((s) => s !== 0)).toBe(true);
    expect(shifts.some((s) => s === 0)).toBe(true);
  });

  it("efectos activos en orden de fila e inicio, ocultos no", () => {
    let p = projectWith(10);
    let a: string, b: string;
    [p, a] = addEffect(p, "flash", 1, 1);
    [p, b] = addEffect(p, "shake", 1.5, 1);
    expect(p.overlays.find((o) => o.id === a)!.lane).not.toBe(p.overlays.find((o) => o.id === b)!.lane);
    expect(effectDraws(p, 1.6).map((d) => d.mode)).toEqual(["tint", "window"]);
    expect(effectDraws(p, 0.5)).toEqual([]);
    p = updateOverlay(p, a, (o) => (o.type === "effect" ? { ...o, intensity: 0 } : o));
    expect(effectDraws(p, 1.05)[0]).toMatchObject({ mode: "tint", alpha: 0 });
    p = { ...p, tracks: { ...p.tracks!, overlays: [{ hidden: true }] } } as typeof p;
    expect(effectDraws(p, 1.6).map((d) => d.mode)).toEqual(["window"]);
  });
});
