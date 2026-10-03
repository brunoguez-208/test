import { describe, expect, it } from "vitest";
import { isFpsIncrease, planScale } from "./scale";

// Mismos casos que los tests de Rust (snip_core::scale): el espejo de la UI tiene que coincidir.
describe("planScale (espejo de Rust)", () => {
  const plan = (w: number, h: number, c: Parameters<typeof planScale>[1]) => {
    const p = planScale({ width: w, height: h }, c);
    return [p.width, p.height, p.needsScale, p.upscale];
  };
  it("presets", () => {
    expect(plan(3840, 2160, { kind: "p1080" })).toEqual([1920, 1080, true, false]);
    expect(plan(1920, 1080, { kind: "p2160" })).toEqual([3840, 2160, true, true]);
    expect(plan(1080, 1920, { kind: "p720" })).toEqual([720, 1280, true, false]);
    expect(plan(1440, 1080, { kind: "p720" })).toEqual([960, 720, true, false]);
    expect(plan(1366, 768, { kind: "p720" })).toEqual([1280, 720, true, false]);
  });
  it("personalizada y original", () => {
    expect(plan(1920, 1080, { kind: "custom", width: 1000 })).toEqual([1000, 562, true, false]);
    expect(plan(1920, 1080, { kind: "custom", width: 1001 })).toEqual([1002, 564, true, false]);
    expect(plan(1280, 720, { kind: "custom", width: 1921 })).toEqual([1922, 1082, true, true]);
    expect(plan(1921, 1081, { kind: "original" })).toEqual([1920, 1080, true, false]);
  });
  it("fps con tolerancia NTSC", () => {
    expect(isFpsIncrease(30, 29.97)).toBe(false);
    expect(isFpsIncrease(60, 30)).toBe(true);
  });
});
