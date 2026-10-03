import { describe, expect, it } from "vitest";
import { addCue, addImage, addText, freeLane, moveOverlay, removeCue, shiftCues, trimOverlay, updateCue } from "./overlayOps";
import { formatSrt, parseSrt } from "./srt";
import { deleteClips } from "./ops";
import { projectWith } from "./testutil";
import type { MediaRef } from "./model";

const logo: MediaRef = { id: "logo", path: "C:\\img\\logo.png", kind: "image", duration: 0, width: 400, height: 200, fps: 0, fpsNum: 0, fpsDen: 1, hasAudio: false, rotation: 0 };

describe("superposiciones", () => {
  it("textos nuevos ocupan la primera fila libre", () => {
    let p = projectWith(10);
    let a: string, b: string, c: string;
    [p, a] = addText(p, "title", 1);
    [p, b] = addText(p, "lowerThird", 2);
    [p, c] = addText(p, "quote", 5);
    const lane = (id: string) => p.overlays.find((o) => o.id === id)!.lane;
    expect([lane(a), lane(b), lane(c)]).toEqual([0, 1, 0]);
    expect(freeLane(p, 1.5, 2.5)).toBe(2);
    expect(p.overlays[0]).toMatchObject({ type: "text", template: "title", start: 1, duration: 3 });
  });

  it("no pasa del final del proyecto", () => {
    let p = projectWith(4);
    let id: string;
    [p, id] = addText(p, "title", 3.5);
    const o = p.overlays.find((x) => x.id === id)!;
    expect(o.start + o.duration).toBeLessThanOrEqual(4 + 1e-9);
    p = moveOverlay(p, id, 99, 3);
    expect(p.overlays[0].start + p.overlays[0].duration).toBeLessThanOrEqual(4 + 1e-9);
    expect(p.overlays[0].lane).toBe(3);
  });

  it("recortar bordes respeta la duración mínima", () => {
    let p = projectWith(10);
    let id: string;
    [p, id] = addText(p, "title", 2);
    p = trimOverlay(p, id, "in", 4.95);
    expect(p.overlays[0]).toMatchObject({ start: 4.8 });
    p = trimOverlay(p, id, "out", 9);
    expect(p.overlays[0].start + p.overlays[0].duration).toBeCloseTo(9, 9);
  });

  it("logo arriba a la derecha durante todo el video, sin salirse", () => {
    let p = projectWith(8);
    [p] = addImage(p, logo);
    const o = p.overlays[0];
    expect(o).toMatchObject({ type: "image", start: 0, duration: 8 });
    expect(p.media.some((m) => m.id === "logo")).toBe(true);
    if (o.type !== "image") throw new Error();
    expect(o.x + o.width / 2).toBeLessThan(1);
    expect(o.y).toBeGreaterThan(0);
  });
});

describe("subtítulos", () => {
  const srt = "\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hola</i> mundo\r\n\r\n2\r\n00:00:03.2 --> 00:00:04,000\r\nSegunda\r\nlínea\r\n\r\n3\r\n00:00:05,000 --> 00:00:04,000\r\nmal\r\n";

  it("lee SRT con BOM, CRLF, punto o coma y etiquetas", () => {
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 2.5, text: "Hola mundo" });
    expect(cues[1]).toMatchObject({ start: 3.2, end: 4, text: "Segunda\nlínea" });
  });

  it("escribe y vuelve a leer igual", () => {
    const cues = parseSrt(srt);
    const out = formatSrt(cues);
    expect(out).toContain("00:00:01,000 --> 00:00:02,500");
    expect(parseSrt(out).map((c) => [c.start, c.end, c.text])).toEqual(cues.map((c) => [c.start, c.end, c.text]));
  });

  it("agregar, editar, correr y borrar", () => {
    let p = projectWith(20);
    let id: string;
    [p, id] = addCue(p, 5);
    expect(p.subtitles.cues[0]).toMatchObject({ start: 5, end: 7 });
    p = updateCue(p, id, { end: 5.05, text: "Hola" });
    expect(p.subtitles.cues[0].end).toBeCloseTo(5.2, 9);
    p = shiftCues(p, -6);
    expect(p.subtitles.cues).toHaveLength(0);
    [p, id] = addCue(p, 3);
    p = deleteClips(p, [id]);
    expect(p.subtitles.cues).toHaveLength(0);
    [p, id] = addCue(p, 3);
    expect(removeCue(p, id).subtitles.cues).toHaveLength(0);
  });

  it("al editar el texto se descartan las palabras de la transcripción", () => {
    let p = projectWith(20);
    p = { ...p, subtitles: { ...p.subtitles, cues: [{ id: "a", start: 1, end: 3, text: "hola mundo", words: [{ start: 1, end: 2, text: "hola" }, { start: 2, end: 3, text: "mundo" }] }] } };
    expect(updateCue(p, "a", { end: 2.5 }).subtitles.cues[0].words).toHaveLength(1);
    expect(updateCue(p, "a", { text: "chau" }).subtitles.cues[0].words).toHaveLength(0);
  });
});
