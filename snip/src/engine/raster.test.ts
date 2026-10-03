import { describe, expect, it } from "vitest";
import { cueAt, decorKey, decorRuns, hasDecor, wordIndexAt } from "./raster";
import { addText, setCues } from "../project/overlayOps";
import { projectWith } from "../project/testutil";

describe("capa de decoración", () => {
  it("sin textos ni subtítulos no hay capa", () => {
    const p = projectWith(5);
    expect(hasDecor(p)).toBe(false);
    expect(decorKey(p, 1)).toBe("");
  });

  it("la clave cambia en cada cuadro de una animación y queda fija después", () => {
    let p = projectWith(10);
    let id: string;
    [p, id] = addText(p, "title", 1); // pop 0,45 s de entrada, fundido 0,35 s de salida
    expect(decorKey(p, 0.5)).toBe("");
    expect(decorKey(p, 1)).toBe(`${id}:in0`);
    expect(decorKey(p, 1 + 1 / 30)).toBe(`${id}:in1`);
    expect(decorKey(p, 2)).toBe(id);
    expect(decorKey(p, 2.5)).toBe(id);
    expect(decorKey(p, 3.9)).toMatch(new RegExp(`^${id}:out`));
  });

  it("tramos: un PNG por estado, medio cuadro antes del cambio", () => {
    let p = projectWith(6);
    [p] = addText(p, "quote", 2); // fundido 0,6 s de entrada y de salida
    const runs = decorRuns(p);
    expect(runs[0]).toMatchObject({ key: "", start: 0 });
    // El primer cuadro con texto es el 60 (2 s a 30 fps): el tramo arranca en 59,5/30.
    expect(runs[1].start).toBeCloseTo(59.5 / 30, 9);
    // Entrada animada (18 cuadros), quieto, salida animada (18), vacío.
    expect(runs.length).toBe(1 + 18 + 1 + 18 + 1);
    expect(runs[runs.length - 1].key).toBe("");
    // Tramos contiguos.
    for (let i = 1; i < runs.length; i++) expect(runs[i].start).toBeCloseTo(runs[i - 1].end, 9);
  });

  it("subtítulos y palabra por palabra", () => {
    let p = projectWith(10);
    p = setCues(p, [{ id: "c1", start: 1, end: 3, text: "hola que tal", words: [{ start: 1, end: 1.5, text: "hola" }, { start: 1.5, end: 2, text: "que" }, { start: 2, end: 3, text: "tal" }] }]);
    expect(cueAt(p.subtitles.cues, 3)).toBeNull();
    expect(wordIndexAt(p.subtitles.cues[0], 1.7)).toBe(1);
    expect(decorKey(p, 1.7)).toBe("c1");
    p = { ...p, subtitles: { ...p.subtitles, wordByWord: true } };
    expect(decorKey(p, 1.7)).toBe("c1:w1");
    expect(decorKey(p, 2.2)).toBe("c1:w2");
  });
});
