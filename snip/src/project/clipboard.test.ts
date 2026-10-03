import { describe, expect, it } from "vitest";
import { copySelection, duplicate, effectsOf, groupItems, parseClipboard, pasteAt, pasteEffects, shiftGroup, ungroupItems, expandGroups } from "./clipboard";
import { addMusic, deleteClips, updateClip } from "./ops";
import { addBlur, addText, setBlurRectAt } from "./overlayOps";
import { addZoomKey } from "./imageOps";
import { layout, totalDuration } from "./timeline";
import { media, projectWith } from "./testutil";
import type { MediaRef, Project } from "./model";

const song: MediaRef = { ...media("song", 60), kind: "audio", path: "C:\\m\\tema.mp3", width: 0, height: 0 };

function base(): Project {
  // Dos clips de 10 s (m1, m2).
  return projectWith(10, 10);
}

describe("copiar y pegar", () => {
  it("pega clips en el playhead dividiendo el clip, con efectos y keyframes", () => {
    let p = base();
    p = updateClip(p, p.clips[0].id, (c) => ({ ...c, speed: 2, video: { ...c.video, color: { ...c.video.color, saturation: 0.5 } } }));
    [p] = addZoomKey(p, p.clips[0].id, 1);
    const data = copySelection(p, [p.clips[0].id])!;
    expect(data.clips).toHaveLength(1);
    const [q, ids] = pasteAt(p, data, 12);
    expect(q.clips).toHaveLength(4); // el segundo se dividió en 12 s
    const pasted = q.clips.find((c) => c.id === ids[0])!;
    expect(layout(q.clips)[q.clips.indexOf(pasted)].start).toBeCloseTo(12, 5);
    expect(pasted.speed).toBe(2);
    expect(pasted.video.color.saturation).toBe(0.5);
    expect(pasted.video.zoom).toHaveLength(1);
    expect(pasted.id).not.toBe(p.clips[0].id);
    expect(totalDuration(q)).toBeCloseTo(totalDuration(p) + 5, 5);
  });

  it("capas, audio y subtítulos conservan distancias y no pisan otras filas", () => {
    let p = base();
    let t1 = "";
    [p, t1] = addText(p, "title", 2);
    let b = "";
    [p, b] = addBlur(p, 3);
    p = setBlurRectAt(p, b, 0.5, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    p = addMusic(p, song, 1);
    const mu = p.music[0].id;
    const data = copySelection(p, [t1, b, mu])!;
    expect(data.span).toBeGreaterThan(0);
    const [q, ids] = pasteAt(p, data, 2.5);
    expect(ids).toHaveLength(3);
    const text = q.overlays.find((o) => ids.includes(o.id) && o.type === "text")!;
    const blur = q.overlays.find((o) => ids.includes(o.id) && o.type === "blur")!;
    // El ancla (lo primero copiado) es la música en 1 s: el texto queda a +1 s de 2,5.
    expect(text.start).toBeCloseTo(3.5, 5);
    expect(blur.start).toBeCloseTo(4.5, 5);
    // Se superpondrían en sus filas originales: van a otra.
    expect(text.lane).not.toBe(p.overlays.find((o) => o.id === t1)!.lane);
    const music = q.music.find((m) => ids.includes(m.id))!;
    expect(music.start).toBeCloseTo(2.5, 5);
    expect(music.track).toBe(1);
    // El rectángulo de la zona viaja con ella.
    expect(blur.type === "blur" && blur.rect.w).toBeCloseTo(0.2, 5);
  });

  it("viaja como texto JSON (otra pestaña) y trae sus medios", () => {
    const p = base();
    const data = copySelection(p, [p.clips[1].id])!;
    const back = parseClipboard(JSON.stringify(data))!;
    expect(back.clips[0].mediaId).toBe("m2");
    const other = projectWith(5);
    const [q] = pasteAt(other, back, 0);
    expect(q.media.map((m) => m.path)).toContain("C:\\v\\m2.mp4");
    expect(parseClipboard("hola")).toBeNull();
  });

  it("duplicar pone la copia justo después", () => {
    const p = base();
    const [q, ids] = duplicate(p, [p.clips[0].id]);
    expect(q.clips.map((c) => c.mediaId)).toEqual(["m1", "m1", "m2"]);
    expect(q.clips[1].id).toBe(ids[0]);
    let r = base();
    let t = "";
    [r, t] = addText(r, "title", 1);
    const [s, tids] = duplicate(r, [t]);
    const orig = s.overlays.find((o) => o.id === t)!;
    const copy = s.overlays.find((o) => o.id === tids[0])!;
    expect(copy.start).toBeCloseTo(orig.start + orig.duration, 5);
  });

  it("pegar efectos aplica color, filtros, velocidad y volumen", () => {
    let p = base();
    p = updateClip(p, p.clips[0].id, (c) => ({ ...c, speed: 1.5, audio: { ...c.audio, volume: 0.4 }, video: { ...c.video, sharpen: 0.3, look: { id: "teal", intensity: 0.7 }, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } } }));
    const q = pasteEffects(p, effectsOf(p.clips[0]), [p.clips[1].id]);
    const c = q.clips[1];
    expect(c.speed).toBe(1.5);
    expect(c.audio.volume).toBe(0.4);
    expect(c.video.sharpen).toBe(0.3);
    expect(c.video.look?.id).toBe("teal");
    expect(c.video.crop).toBeNull(); // el encuadre no se copia
  });
});

describe("grupos", () => {
  it("agrupar, expandir la selección, mover juntos, borrar y desagrupar", () => {
    let p = base();
    let a = "";
    let b = "";
    [p, a] = addText(p, "title", 1);
    [p, b] = addText(p, "title", 4);
    p = groupItems(p, [a, b]);
    expect(expandGroups(p, [a])).toEqual(expect.arrayContaining([a, b]));
    const moved = shiftGroup(p, [a, b], 2);
    expect(moved.overlays.find((o) => o.id === b)!.start).toBeCloseTo(6, 5);
    // Copiar uno copia el grupo entero y el pegado queda agrupado.
    const data = copySelection(p, [a])!;
    expect(data.overlays).toHaveLength(2);
    const [q, ids] = pasteAt(p, data, 5);
    expect(q.groups).toHaveLength(2);
    expect(q.groups![1].sort()).toEqual([...ids].sort());
    // Borrar limpia los grupos.
    const r = deleteClips(p, [a, b]);
    expect(r.groups).toEqual([]);
    expect(ungroupItems(p, [a]).groups).toEqual([]);
    expect(() => groupItems(base(), [])).toThrow();
  });
});
