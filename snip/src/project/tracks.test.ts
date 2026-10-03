import { describe, expect, it } from "vitest";
import { trimToPlayhead } from "./trimOps";
import { isLocked, unlockedOnly } from "./tracks";
import { setTrackState } from "./audioOps";
import { addMusic } from "./ops";
import { addText } from "./overlayOps";
import { layout, totalDuration } from "./timeline";
import { media, projectWith } from "./testutil";
import { shortcutFor } from "../lib/shortcuts";
import { decorKey } from "../engine/raster";
import type { MediaRef } from "./model";

const song: MediaRef = { ...media("song", 60), kind: "audio", path: "C:\\m\\tema.mp3", width: 0, height: 0 };

describe("Q / W", () => {
  it("Q saca el principio del clip hasta el playhead (ripple) y W el final", () => {
    const p = projectWith(10, 10);
    const [q, to] = trimToPlayhead(p, 13, "start", []);
    expect(q.clips[1].inPoint).toBeCloseTo(3, 5);
    expect(totalDuration(q)).toBeCloseTo(17, 5);
    expect(to).toBe(10);
    const [r, at] = trimToPlayhead(p, 4, "end", []);
    expect(r.clips[0].outPoint).toBeCloseTo(4, 5);
    expect(layout(r.clips)[1].start).toBeCloseTo(4, 5);
    expect(at).toBe(4);
  });

  it("con audio o capas elegidos bajo el playhead, recorta esos", () => {
    let p = addMusic(projectWith(20), song, 2);
    let t = "";
    [p, t] = addText(p, "title", 1);
    const mu = p.music[0].id;
    const [q] = trimToPlayhead(p, 5, "start", [mu, t]);
    expect(q.music[0].start).toBeCloseTo(5, 5);
    expect(q.music[0].inPoint).toBeCloseTo(3, 5);
    expect(q.overlays[0].start).toBeCloseTo(1, 5); // el texto (1–4 s) no está bajo el playhead
    expect(q.clips[0].outPoint).toBe(20);
  });

  it("los atajos Q/W, Ctrl+C/X/D/G y Ctrl+Alt+V", () => {
    expect(shortcutFor({ key: "q" })).toEqual({ type: "trimStart" });
    expect(shortcutFor({ key: "w" })).toEqual({ type: "trimEnd" });
    expect(shortcutFor({ key: "c", ctrlKey: true })).toEqual({ type: "copy" });
    expect(shortcutFor({ key: "x", ctrlKey: true })).toEqual({ type: "cut" });
    expect(shortcutFor({ key: "d", ctrlKey: true })).toEqual({ type: "duplicate" });
    expect(shortcutFor({ key: "g", ctrlKey: true })).toEqual({ type: "group" });
    expect(shortcutFor({ key: "G", ctrlKey: true, shiftKey: true })).toEqual({ type: "ungroup" });
    expect(shortcutFor({ key: "v", ctrlKey: true, altKey: true })).toEqual({ type: "pasteEffects" });
    expect(shortcutFor({ key: "q" }, { tagName: "INPUT", type: "text" })).toBeNull();
  });
});

describe("ojo y candado", () => {
  it("pistas bloqueadas: no se cortan ni se borran sus elementos", () => {
    let p = addMusic(projectWith(10), song, 0);
    p = setTrackState(p, { kind: "video" }, { locked: true });
    expect(isLocked(p, p.clips[0].id)).toBe(true);
    expect(isLocked(p, p.music[0].id)).toBe(false);
    expect(unlockedOnly(p, [p.clips[0].id, p.music[0].id])).toEqual([p.music[0].id]);
    expect(() => unlockedOnly(p, [p.clips[0].id])).toThrow();
    expect(() => trimToPlayhead(p, 4, "end", [])).toThrow(/bloqueada/);
  });

  it("una fila de capas oculta no se dibuja (preview y exportación)", () => {
    let p = projectWith(10);
    let id = "";
    [p, id] = addText(p, "title", 0);
    expect(decorKey(p, 2)).toBe(id);
    p = setTrackState(p, { kind: "overlay", index: 0 }, { hidden: true });
    expect(decorKey(p, 2)).toBe("");
  });
});
