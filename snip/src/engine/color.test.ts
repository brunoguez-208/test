import { describe, expect, it } from "vitest";
import { adjustAffine, apply, colorPipeline, curveTable, isIdentity, lookAffine, lookDef, LOOKS, sharpenWeight } from "./color";
import { zoomAt } from "./effects";
import { clipGeometry, cropPixels } from "../project/geometry";
import { DEFAULT_VIDEO } from "../project/model";

const zero = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, exposure: 0 };

describe("color (espejo de color.rs)", () => {
  it("sin ajustes ni look no hay pipeline", () => {
    expect(isIdentity(adjustAffine(zero))).toBe(true);
    expect(colorPipeline(zero, null)).toBeNull();
    expect(colorPipeline(zero, { id: "bw", intensity: 0 })).toBeNull();
  });

  it("brillo, contraste, saturación, temperatura y exposición", () => {
    const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    close(apply(adjustAffine({ ...zero, brightness: 0.4 }), [0.5, 0.5, 0.5]), [0.6, 0.6, 0.6]);
    close(apply(adjustAffine({ ...zero, contrast: 1 }), [0.75, 0.25, 0.5]), [1, 0, 0.5]);
    const l = 0.2126 * 0.8 + 0.7152 * 0.2 + 0.0722 * 0.1;
    close(apply(adjustAffine({ ...zero, saturation: -1 }), [0.8, 0.2, 0.1]), [l, l, l]);
    const t = apply(adjustAffine({ ...zero, temperature: 1 }), [0.5, 0.5, 0.5]);
    expect(t[0]).toBeGreaterThan(0.5);
    expect(t[2]).toBeLessThan(0.5);
    expect(apply(adjustAffine({ ...zero, exposure: 1 }), [0.1, 0.1, 0.1])[0]).toBeCloseTo(0.1 * Math.pow(2, 1.5), 9);
  });

  it("looks: blanco y negro deja los canales iguales; intensidad 0 = identidad", () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(8);
    const bw = lookDef("bw")!;
    const out = apply(lookAffine(bw, 1), [0.3, 0.6, 0.9]);
    expect(out[0]).toBeCloseTo(out[1], 9);
    expect(isIdentity(lookAffine(bw, 0))).toBe(true);
  });

  it("curvas: mismos valores que la tabla de Rust", () => {
    const t = curveTable([[0, 0.1], [0.5, 0.5], [1, 0.9]], 1);
    expect([t[0], t[128], t[255]]).toEqual([26, 128, 230]);
    const id = curveTable([[0, 0.1], [1, 0.9]], 0);
    expect(Array.from(id).every((v, i) => v === i)).toBe(true);
    expect(colorPipeline(zero, { id: "cinema", intensity: 1 })!.hasCurves).toBe(true);
  });

  it("nitidez en 1/64 como sharpen_weight", () => {
    expect(sharpenWeight(0.5)).toBe(19);
    expect(sharpenWeight(0)).toBe(0);
  });
});

describe("geometría y zoom (espejo de filters.rs)", () => {
  it("recorte en píxeles pares dentro del cuadro", () => {
    const [x, y, w, h] = cropPixels({ x: 0.999, y: 0, w: 0.5, h: 1 }, 641, 361);
    expect([x % 2, y % 2, w % 2, h % 2]).toEqual([0, 0, 0, 0]);
    expect(x + w).toBeLessThanOrEqual(641);
    const g = clipGeometry({ ...DEFAULT_VIDEO, rotate: 90, crop: { x: 0.1, y: 0.25, w: 0.5, h: 0.5 } }, { width: 1920, height: 1080 });
    expect([g.width, g.height, g.fullWidth, g.fullHeight]).toEqual([540, 960, 1080, 1920]);
  });

  it("zoom interpolado con easing y centro acotado", () => {
    expect(zoomAt([], 1)).toEqual({ zoom: 1, cx: 0.5, cy: 0.5 });
    const keys = [
      { id: 2, t: 2, zoom: 2, cx: 1, cy: 0, easing: "linear" as const },
      { id: 1, t: 0, zoom: 1, cx: 0.5, cy: 0.5, easing: "linear" as const },
    ];
    expect(zoomAt(keys, 1).zoom).toBeCloseTo(1.5, 9);
    // En t=2 la ventana mide 0.5: el centro no puede pasar de 0.75 ni bajar de 0.25.
    expect(zoomAt(keys, 3)).toEqual({ zoom: 2, cx: 0.75, cy: 0.25 });
  });
});
