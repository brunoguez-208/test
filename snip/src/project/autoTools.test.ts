import { describe, expect, it } from "vitest";
import { cutSilences, detectBeats, detectPlays, estimatePeriod, findSilences, musicBeats, playRanges, setAutoMarkers, smoothDb, timelineLevel, type Analysis } from "./autoTools";
import { addMusic, updateClip } from "./ops";
import { media, projectWith } from "./testutil";
import { totalDuration } from "./timeline";

const RATE = 100;
function levels(secs: number, f: (t: number) => number): Float32Array {
  return Float32Array.from({ length: secs * RATE }, (_, i) => f(i / RATE));
}
function analysis(secs: number, lv: (t: number) => number, on: (i: number) => number = () => 0): Analysis {
  return { rate: RATE, level: levels(secs, lv), onset: Float32Array.from({ length: secs * RATE }, (_, i) => on(i)) };
}

describe("jugadas (picos de audio)", () => {
  const lv = levels(30, (t) => ((t >= 5 && t < 5.5) || (t >= 6 && t < 6.3) ? -6 : t >= 20 && t < 20.4 ? -15 : -30));

  it("encuentra los picos y respeta la separación mínima", () => {
    const p = detectPlays(lv, RATE, 0.5);
    // 5 y 6 están a menos de 4 s: queda el más fuerte (o el primero si empatan).
    expect(p.length).toBe(2);
    expect(p[0]).toBeGreaterThanOrEqual(4.9);
    expect(p[0]).toBeLessThan(6.4);
    expect(p[1]).toBeCloseTo(20.1, 0);
  });

  it("la sensibilidad decide cuánto más fuerte tiene que ser", () => {
    expect(detectPlays(lv, RATE, 0).length).toBe(1);
    expect(detectPlays(lv, RATE, 1).length).toBe(2);
    expect(detectPlays(levels(10, () => -90), RATE, 1)).toEqual([]);
  });

  it("promedio en potencia", () => {
    const s = smoothDb(Float32Array.from([-90, 0, -90]), 3);
    expect(s[1]).toBeCloseTo(10 * Math.log10(1 / 3), 3);
  });
});

describe("silencios", () => {
  const lv = levels(20, (t) => ((t >= 4 && t < 6) || (t >= 10 && t < 10.3) ? -70 : -25));

  it("tramos largos, con margen, los cortos no", () => {
    const s = findSilences(lv, RATE, -45, 0.5, 0.15);
    expect(s).toHaveLength(1);
    expect(s[0][0]).toBeCloseTo(4.15);
    expect(s[0][1]).toBeCloseTo(5.85);
    expect(findSilences(lv, RATE, -45, 0.2, 0.05)).toHaveLength(2);
    expect(findSilences(lv, RATE, -80, 0.2, 0)).toHaveLength(0);
  });

  it("cortarlos acorta el timeline lo justo", () => {
    const p = projectWith(10, 10);
    const q = cutSilences(p, [[2, 3], [12, 14.5]]);
    expect(totalDuration(q)).toBeCloseTo(20 - 1 - 2.5, 3);
    // Bordes fuera de la grilla de cuadros (los cortes caen al cuadro más cercano).
    expect(totalDuration(cutSilences(projectWith(12), [[5.15, 6.05]]))).toBeCloseTo(12 - 0.9, 1);
  });

  it("nivel del timeline: sigue los clips y los silenciados no suenan", () => {
    let p = projectWith(10, 10);
    p = updateClip(p, p.clips[1].id, (c) => ({ ...c, inPoint: 2, outPoint: 8 }));
    const a = analysis(10, (t) => (t < 5 ? -20 : -40));
    const tl = timelineLevel(p, () => a);
    expect(tl.length).toBe(1600);
    expect(tl[1050]).toBe(-20); // 10,5 s del timeline = 2,5 s del clip 2
    expect(tl[1500]).toBe(-40);
    const muted = updateClip(p, p.clips[0].id, (c) => ({ ...c, audio: { ...c.audio, muted: true } }));
    expect(timelineLevel(muted, () => a)[100]).toBe(-90);
  });
});

describe("beats", () => {
  const beatsAt = (bpm: number, offset: number) => (i: number) => {
    const per = (60 / bpm) * RATE;
    const k = Math.round((i - offset) / per);
    return Math.abs(i - offset - k * per) < 0.5 && i >= offset ? 1 : 0.05;
  };

  it("estima el tempo (también fraccionario)", () => {
    expect(estimatePeriod(analysis(30, () => -10, beatsAt(120, 25)).onset, RATE)).toBeCloseTo(50, 0);
    expect(estimatePeriod(analysis(30, () => -10, beatsAt(128, 10)).onset, RATE)).toBeCloseTo(46.875, 0);
  });

  it("sigue los beats sin derivar", () => {
    const b = detectBeats(analysis(30, () => -10, beatsAt(128, 10)));
    expect(b.length).toBeGreaterThan(60);
    const per = 60 / 128;
    for (const t of b) {
      const k = Math.round((t - 0.1) / per);
      expect(Math.abs(t - 0.1 - k * per)).toBeLessThan(0.02);
    }
  });

  it("beats de la música en el timeline y marcadores que se reemplazan", () => {
    let p = projectWith(20);
    p = addMusic(p, { ...media("song", 30), kind: "audio", path: "C:\\m\\tema.mp3" }, 2);
    const a = analysis(30, () => -10, beatsAt(120, 25));
    const beats = musicBeats(p, () => a);
    expect(beats[0]).toBeCloseTo(2.25, 1);
    p = setAutoMarkers(p, "beat", beats, () => "");
    const n = p.markers.length;
    expect(n).toBeGreaterThan(30);
    p = setAutoMarkers(p, "beat", beats.slice(0, 3), () => "");
    expect(p.markers.filter((m) => m.kind === "beat")).toHaveLength(3);
  });

  it("jugadas como fragmentos de ±X s", () => {
    const p = playRanges(projectWith(30), [5, 20], 3);
    expect(p.ranges.map((r) => [r.start, r.end, r.name])).toEqual([
      [2, 8, "Jugada 1"],
      [17, 23, "Jugada 2"],
    ]);
  });
});
