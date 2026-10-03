import { describe, expect, it } from "vitest";
import { beginGesture, canRedo, canUndo, cancelGesture, commit, createHistory, endGesture, redo, replace, undo } from "./history";
import { addMarker, deleteClips, splitAt, trimClip } from "./ops";
import { projectWith } from "./testutil";

describe("deshacer / rehacer", () => {
  it("cada acción es un paso, ilimitado", () => {
    let h = createHistory(projectWith(10));
    for (let i = 1; i <= 50; i++) h = commit(h, addMarker(h.present, i * 0.1));
    expect(h.past).toHaveLength(50);
    for (let i = 0; i < 50; i++) h = undo(h);
    expect(h.present.markers).toHaveLength(0);
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(h.present.markers).toHaveLength(2);
    expect(canRedo(h)).toBe(true);
    // Una acción nueva borra el futuro.
    h = commit(h, splitAt(h.present, 5));
    expect(canRedo(h)).toBe(false);
  });

  it("un gesto (arrastrar) es un solo paso; Esc lo cancela", () => {
    const p = projectWith(10);
    const id = p.clips[0].id;
    let h = beginGesture(createHistory(p));
    for (let t = 0.1; t < 2; t += 0.1) h = commit(h, trimClip(h.present, id, "in", t));
    h = endGesture(h);
    expect(h.past).toHaveLength(1);
    expect(h.present.clips[0].inPoint).toBeGreaterThan(1.8);
    h = undo(h);
    expect(h.present.clips[0].inPoint).toBe(0);

    let g = beginGesture(createHistory(p));
    g = commit(g, trimClip(g.present, id, "out", 5));
    g = cancelGesture(g);
    expect(g.present.clips[0].outPoint).toBe(10);
    expect(g.past).toHaveLength(0);
  });

  it("cambios de vista no son pasos y viajan con el presente", () => {
    const p = projectWith(10);
    let h = commit(createHistory(p), deleteClips(p, []));
    expect(h.past).toHaveLength(0);
    h = commit(h, addMarker(h.present, 1));
    h = replace(h, { ...h.present, view: { playhead: 7, zoom: 50, scroll: 3 } });
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present.view.playhead).toBe(7);
  });
});
