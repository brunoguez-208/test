import { describe, expect, it } from "vitest";
import { cornerAlpha, defaultMask, maskPx, pipMaskPixels, shapeAlpha } from "./mask";
import { addMaskKey, addPip, removeMaskKeys, setMaskRectAt, setPipMask } from "../project/overlayOps";
import { media, projectWith } from "../project/testutil";
import type { LayerMask } from "../project/model";

const circle: LayerMask = { shape: "circle", rect: { x: 0.25, y: 0, w: 0.5, h: 1 }, radius: 0, feather: 0, invert: false, keys: [] };

describe("máscaras del PiP (mismas fórmulas que el shader)", () => {
  it("círculo: adentro 1, afuera 0, borde a mitad; invertir da el complemento", () => {
    const m = maskPx(circle, 200, 100, 0);
    expect(shapeAlpha(100, 50, m)).toBe(1);
    expect(shapeAlpha(5, 5, m)).toBe(0);
    expect(shapeAlpha(150, 50, m)).toBeCloseTo(0.5, 1);
    const inv = maskPx({ ...circle, invert: true }, 200, 100, 0);
    expect(shapeAlpha(100, 50, inv)).toBe(0);
    expect(shapeAlpha(5, 5, inv)).toBe(1);
  });

  it("borde suave: la transición se ensancha", () => {
    const hard = maskPx({ ...circle, feather: 0 }, 200, 100, 0);
    const soft = maskPx({ ...circle, feather: 1 }, 200, 100, 0);
    expect(soft.feather).toBeGreaterThan(hard.feather);
    expect(shapeAlpha(146, 50, hard)).toBe(1);
    expect(shapeAlpha(146, 50, soft)).toBeLessThan(1);
    expect(shapeAlpha(146, 50, soft)).toBeGreaterThan(0.5);
  });

  it("redondeado y esquinas del PiP", () => {
    const m = maskPx({ ...circle, shape: "rounded", rect: { x: 0, y: 0, w: 1, h: 1 }, radius: 0.5 }, 100, 100, 0);
    expect(shapeAlpha(1, 1, m)).toBe(0);
    expect(shapeAlpha(50, 1, m)).toBeGreaterThan(0.9);
    expect(cornerAlpha(0.5, 0.5, 100, 100, 20)).toBe(0);
    expect(cornerAlpha(50.5, 50.5, 100, 100, 20)).toBe(1);
    const px = pipMaskPixels(4, 4, 0, null);
    expect(Array.from(px.filter((_, i) => i % 4 === 0))).toEqual(Array(16).fill(255));
  });

  it("un círculo nuevo es redondo en píxeles", () => {
    const d = defaultMask("circle", 320, 180);
    expect(d.rect.w * 320).toBeCloseTo(d.rect.h * 180);
    expect(d.rect.x + d.rect.w / 2).toBeCloseTo(0.5);
  });

  it("keyframes: acomodar con y sin seguimiento", () => {
    let [p, id] = addPip(projectWith(10), media("cam", 8), 0);
    p = setPipMask(p, id, defaultMask("circle", 320, 180));
    p = setMaskRectAt(p, id, 1, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    const pip = () => p.overlays.find((o) => o.id === id) as { mask: LayerMask };
    expect(pip().mask.rect.x).toBe(0.1);
    p = addMaskKey(p, id, 1);
    p = setMaskRectAt(p, id, 3, { x: 0.4, y: 0.2, w: 0.3, h: 0.3 });
    expect(pip().mask.keys.map((k) => k.t)).toEqual([1, 3]);
    expect(maskPx(pip().mask, 100, 100, 2).rect[0]).toBeCloseTo(25);
    p = removeMaskKeys(p, id, 2);
    expect(pip().mask.keys).toEqual([]);
    expect(pip().mask.rect.x).toBeCloseTo(0.25);
  });
});
