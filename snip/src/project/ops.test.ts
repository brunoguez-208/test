import { describe, expect, it } from "vitest";
import {
  EditError,
  addMarker,
  addMusic,
  addRange,
  adjacentMarker,
  deleteClips,
  deleteRange,
  fitCanvas,
  freezeAt,
  insertMedia,
  moveClip,
  newProject,
  setTransition,
  snap,
  snapPoints,
  splitAt,
  trimClip,
  trimMusic,
  updateClip,
} from "./ops";
import { layout, totalDuration } from "./timeline";
import { media, projectWith } from "./testutil";

describe("agregar y unir clips", () => {
  it("agrega videos enteros y ajusta el lienzo y el nombre al primero", () => {
    const p = insertMedia(newProject(), [media("a", 10, 1280, 720, 60), media("b", 5)]);
    expect(p.clips.map((c) => [c.inPoint, c.outPoint])).toEqual([[0, 10], [0, 5]]);
    expect(p.canvas).toMatchObject({ width: 1280, height: 720, fpsNum: 60 });
    expect(p.name).toBe("a");
    expect(totalDuration(p)).toBeCloseTo(15);
    // El mismo archivo no se duplica en la lista de medios.
    const q = insertMedia(p, [media("a", 10, 1280, 720, 60)], 0);
    expect(q.media).toHaveLength(2);
    expect(q.clips).toHaveLength(3);
    expect(q.clips[0].mediaId).toBe(p.clips[0].mediaId);
  });

  it("lienzo con medidas pares y solo si es automático", () => {
    const odd = { ...media("o", 4, 1921, 1081), fpsNum: 30000, fpsDen: 1001 };
    const p = insertMedia(newProject(), [odd]);
    expect(p.canvas).toMatchObject({ width: 1920, height: 1080, fpsNum: 30000, fpsDen: 1001 });
    const manual = { ...p, canvas: { ...p.canvas, auto: false, width: 1080, height: 1920 } };
    expect(fitCanvas(manual).canvas.width).toBe(1080);
  });

  it("reordena arrastrando y la primera transición se cae", () => {
    let p = projectWith(4, 3, 5);
    p = setTransition(p, p.clips[1].id, { kind: "fade", duration: 1 });
    const id = p.clips[1].id;
    p = moveClip(p, id, 0);
    expect(p.clips[0].id).toBe(id);
    expect(p.clips[0].transition).toBeNull();
    expect(setTransition(p, p.clips[0].id, { kind: "fade", duration: 1 })).toBe(p);
  });
});

describe("dividir y borrar", () => {
  it("divide en el playhead en el cuadro exacto", () => {
    const p = projectWith(10);
    const q = splitAt(p, 4.01);
    expect(q.clips).toHaveLength(2);
    expect(q.clips[0].outPoint).toBeCloseTo(4);
    expect(q.clips[1].inPoint).toBeCloseTo(4);
    expect(q.clips[0].id).not.toBe(q.clips[1].id);
    expect(totalDuration(q)).toBeCloseTo(10);
  });

  it("divide clips acelerados e invertidos mapeando bien el original", () => {
    let p = projectWith(10);
    p = updateClip(p, p.clips[0].id, (c) => ({ ...c, speed: 2 }));
    const q = splitAt(p, 1); // 1 s del timeline = 2 s del original
    expect(q.clips[0].outPoint).toBeCloseTo(2);
    p = updateClip(p, p.clips[0].id, (c) => ({ ...c, reverse: true, speed: 1 }));
    const r = splitAt(p, 3); // invertido: los primeros 3 s son 10→7
    expect([r.clips[0].inPoint, r.clips[0].outPoint]).toEqual([7, 10]);
    expect([r.clips[1].inPoint, r.clips[1].outPoint]).toEqual([0, 7]);
  });

  it("no divide en los bordes ni clips con loop", () => {
    const p = projectWith(10);
    expect(() => splitAt(p, 0)).toThrow(EditError);
    expect(() => splitAt(p, 50)).toThrow(EditError);
    const l = updateClip(p, p.clips[0].id, (c) => ({ ...c, loopMode: "loop", loopCount: 2 }));
    expect(() => splitAt(l, 5)).toThrow(/loop/);
  });

  it("borrar del medio cierra el hueco", () => {
    const p = projectWith(4, 3, 5);
    const q = deleteClips(p, [p.clips[1].id]);
    expect(q.clips).toHaveLength(2);
    expect(layout(q.clips)[1].start).toBeCloseTo(4);
    expect(totalDuration(q)).toBeCloseTo(9);
  });

  it("borra un fragmento marcado con I/O", () => {
    const p = projectWith(10);
    const q = deleteRange(p, 3, 6);
    expect(q.clips.map((c) => [c.inPoint, c.outPoint])).toEqual([[0, 3], [6, 10]]);
    expect(totalDuration(q)).toBeCloseTo(7);
    expect(() => deleteRange(p, 2, 2)).toThrow(EditError);
  });

  it("recorta bordes sin pasarse del archivo ni de un cuadro", () => {
    const p = projectWith(10);
    const id = p.clips[0].id;
    expect(trimClip(p, id, "in", 2.51).clips[0].inPoint).toBeCloseTo(2.5);
    expect(trimClip(p, id, "in", 2.52).clips[0].inPoint).toBeCloseTo(2.5333, 3);
    expect(trimClip(p, id, "out", 99).clips[0].outPoint).toBe(10);
    expect(trimClip(p, id, "in", 50).clips[0].inPoint).toBeCloseTo(10 - 1 / 30);
    const rev = updateClip(p, id, (c) => ({ ...c, reverse: true }));
    expect(trimClip(rev, id, "in", 8).clips[0].outPoint).toBe(8);
  });
});

describe("congelar, marcadores, rangos, música y snap", () => {
  it("congela el cuadro del playhead", () => {
    const p = projectWith(10);
    const q = freezeAt(p, 4, 2);
    expect(q.clips.map((c) => c.kind)).toEqual(["video", "freeze", "video"]);
    expect(q.clips[1].inPoint).toBeCloseTo(4);
    expect(totalDuration(q)).toBeCloseTo(12);
    const atStart = freezeAt(p, 0, 1);
    expect(atStart.clips[0].kind).toBe("freeze");
  });

  it("marcadores ordenados, sin duplicados, con salto entre ellos", () => {
    let p = projectWith(10);
    p = addMarker(p, 5);
    p = addMarker(p, 2, "Inicio");
    p = addMarker(p, 5);
    expect(p.markers.map((m) => m.time)).toEqual([2, 5]);
    expect(adjacentMarker(p, 3, 1)).toBe(5);
    expect(adjacentMarker(p, 3, -1)).toBe(2);
    expect(adjacentMarker(p, 5, 1)).toBeNull();
  });

  it("rangos para exportar fragmentos", () => {
    let p = projectWith(10);
    p = addRange(p, 6, 2);
    p = addRange(p, 0, 1);
    expect(p.ranges.map((r) => [r.start, r.end, r.name])).toEqual([[0, 1, "Fragmento 2"], [2, 6, "Fragmento 1"]]);
    expect(() => addRange(p, 3, 3)).toThrow(EditError);
  });

  it("música: agregar y recortar el borde izquierdo mueve el inicio", () => {
    let p = projectWith(10);
    p = addMusic(p, { ...media("tema", 120), kind: "audio" }, 1);
    const mu = p.music[0];
    expect(mu).toMatchObject({ start: 1, inPoint: 0, outPoint: 120 });
    p = trimMusic(p, mu.id, "in", 3);
    expect(p.music[0]).toMatchObject({ start: 3, inPoint: 2 });
    p = trimMusic(p, mu.id, "out", 10);
    expect(p.music[0].outPoint).toBeCloseTo(9);
    expect(() => addMusic(p, { ...media("mudo", 3, 10, 10, 30, false) }, 0)).toThrow(EditError);
  });

  it("snap magnético a bordes, playhead y marcadores", () => {
    let p = projectWith(4, 6);
    p = addMarker(p, 7);
    const pts = snapPoints(p, 2.5);
    expect(snap(3.97, pts, 0.1)).toEqual({ time: 4, snapped: true });
    expect(snap(2.45, pts, 0.1).time).toBe(2.5);
    expect(snap(7.05, pts, 0.1).time).toBe(7);
    expect(snap(5.5, pts, 0.1)).toEqual({ time: 5.5, snapped: false });
  });
});
