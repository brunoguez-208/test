import { describe, expect, it } from "vitest";
import { chromaUniforms, keyUV, parseColor, spillOf, toHex } from "./chroma";

describe("chroma key (espejo de chroma.rs)", () => {
  it("colores y reflejo", () => {
    expect(parseColor("#00b140")).toEqual([0, 177, 64]);
    expect(parseColor("00B140")).toEqual([0, 177, 64]);
    expect(parseColor("#00b14")).toBeNull();
    expect(toHex([0, 177.4, 64])).toBe("#00b140");
    expect(spillOf([0, 177, 64])).toBe(0);
    expect(spillOf([10, 60, 220])).toBe(1);
    expect(spillOf([200, 30, 30])).toBe(-1);
  });

  it("UV como FFmpeg (BT.601, rango limitado)", () => {
    const [u, v] = keyUV([0, 177, 64]);
    expect(u).toBeCloseTo(104.6, 1);
    expect(v).toBeCloseTo(58.33, 1);
    // Gris: sin croma.
    const [gu, gv] = keyUV([128, 128, 128]);
    expect(gu).toBeCloseTo(128, 3);
    expect(gv).toBeCloseTo(128, 3);
  });

  it("uniforms: límites iguales a los de la exportación", () => {
    expect(chromaUniforms(null)).toBeNull();
    expect(chromaUniforms({ color: "nada", similarity: 0.1, smoothness: 0.1, despill: 0 })).toBeNull();
    const k = chromaUniforms({ color: "#00ff00", similarity: 5, smoothness: -1, despill: 0.0001 })!;
    expect(k.similarity).toBe(0.6);
    expect(k.smoothness).toBe(0);
    expect(k.despill).toBe(0);
    expect(k.spill).toBe(0);
  });
});
