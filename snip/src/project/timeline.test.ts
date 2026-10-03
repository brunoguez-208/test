import { describe, expect, it } from "vitest";
import { activeAt, clipDuration, effectiveTransition, layout, sourceTime } from "./timeline";
import { newClip } from "./ops";
import { media } from "./testutil";
import type { Clip } from "./model";

const clip = (a: number, b: number, patch: Partial<Clip> = {}): Clip => ({ ...newClip(media("m1"), a, b), ...patch });

describe("timeline (espejo de timeline.rs)", () => {
  it("duraciones con velocidad, loop, boomerang y congelado", () => {
    expect(clipDuration(clip(2, 6))).toBeCloseTo(4);
    expect(clipDuration(clip(2, 6, { speed: 2 }))).toBeCloseTo(2);
    expect(clipDuration(clip(2, 6, { speed: 0.5 }))).toBeCloseTo(8);
    expect(clipDuration(clip(2, 6, { loopMode: "loop", loopCount: 3 }))).toBeCloseTo(12);
    expect(clipDuration(clip(2, 6, { loopMode: "boomerang", loopCount: 2 }))).toBeCloseTo(16);
    expect(clipDuration(clip(3, 3, { kind: "freeze", freezeDuration: 2.5, loopMode: "loop", loopCount: 4 }))).toBeCloseTo(2.5);
  });

  it("layout magnético con transiciones que solapan", () => {
    const clips = [clip(0, 4), clip(0, 3, { transition: { kind: "fade", duration: 1 } }), clip(1, 5)];
    const l = layout(clips);
    expect(l.map((s) => s.start)).toEqual([0, 3, 6]);
    expect(l[2].end).toBeCloseTo(10);
    expect(l[1].transitionIn).toBeCloseTo(1);
    // La transición nunca supera la mitad de un clip.
    expect(effectiveTransition([clip(0, 1), clip(0, 10, { transition: { kind: "slideLeft", duration: 3 } })], 1)).toBeCloseTo(0.5);
  });

  it("mapea tiempo del timeline a tiempo del original", () => {
    expect(sourceTime(clip(2, 6), 1)).toBeCloseTo(3);
    expect(sourceTime(clip(2, 6, { speed: 2 }), 1)).toBeCloseTo(4);
    expect(sourceTime(clip(2, 6, { speed: 2, reverse: true }), 1)).toBeCloseTo(4);
    expect(sourceTime(clip(2, 6, { reverse: true }), 0)).toBeCloseTo(6);
    const boom = clip(2, 6, { loopMode: "boomerang", loopCount: 1 });
    expect(sourceTime(boom, 1)).toBeCloseTo(3);
    expect(sourceTime(boom, 5)).toBeCloseTo(5);
    expect(sourceTime(clip(2, 6, { loopMode: "loop", loopCount: 2 }), 5)).toBeCloseTo(3);
  });

  it("qué se ve en cada instante (con el progreso de xfade)", () => {
    const clips = [clip(0, 4), clip(0, 4, { transition: { kind: "fade", duration: 1 } })];
    const l = layout(clips);
    expect(activeAt(l, 1)).toEqual({ a: 0, b: null, progress: 0 });
    const mid = activeAt(l, 3.25)!;
    expect(mid.a).toBe(0);
    expect(mid.b).toBe(1);
    expect(mid.progress).toBeCloseTo(0.75);
    expect(activeAt(l, 5)).toEqual({ a: 1, b: null, progress: 0 });
    expect(activeAt(l, 99)!.a).toBe(1);
    expect(activeAt([], 0)).toBeNull();
  });
});
