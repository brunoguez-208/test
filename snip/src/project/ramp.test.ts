import { describe, expect, it } from "vitest";
import { cutKeys, rampDuration, rampPreset, segments, sourceOffset, speedAt, timelineOffset } from "./ramp";
import { addSpeedKey, clearRamp, moveSpeedKey, removeSpeedKey, setRampAudio, setRampPreset } from "./rampOps";
import { splitAt, trimClip, updateClip } from "./ops";
import { effectsOf, pasteEffects } from "./clipboard";
import { needsHeavy, heavySignature } from "./heavy";
import { clipDuration, layout, sourceTime } from "./timeline";
import { projectWith } from "./testutil";

describe("rampa de velocidad (espejo de ramp.rs)", () => {
  it("curva suave entre puntos y mismo largo que Rust", () => {
    const k = rampPreset("slowmo-middle", 4);
    expect(speedAt(k, 0)).toBe(1);
    expect(speedAt(k, 2)).toBeCloseTo(0.25);
    expect(speedAt(k, 0.7)).toBeGreaterThan(0.25);
    expect(speedAt(k, 0.7)).toBeLessThan(1);
    // Valor calculado por snip_core::ramp::duration (tests de integración).
    expect(rampDuration(k, 4)).toBeCloseTo(10.363320466022763, 9);
    expect(segments(k, 4)).toHaveLength(64);
  });

  it("source/timeline offsets son inversas y monótonas", () => {
    const k = rampPreset("speed-up", 4);
    const d = rampDuration(k, 4);
    let last = -1;
    for (let i = 0; i <= 50; i++) {
      const u = (d * i) / 50;
      const o = sourceOffset(k, 4, u);
      expect(o).toBeGreaterThanOrEqual(last - 1e-9);
      expect(timelineOffset(k, 4, o)).toBeCloseTo(u, 6);
      last = o;
    }
    expect(sourceOffset(k, 4, d)).toBeCloseTo(4, 6);
  });

  it("presets: lenta en el medio alarga, aceleración acorta, frenada", () => {
    expect(rampDuration(rampPreset("slowmo-middle", 4), 4)).toBeGreaterThan(6);
    expect(rampDuration(rampPreset("speed-up", 4), 4)).toBeLessThan(2.5);
    const sd = rampPreset("slow-down", 3);
    expect(speedAt(sd, 0)).toBe(3);
    expect(speedAt(sd, 3)).toBeCloseTo(0.3);
  });

  it("cutKeys conserva la curva al recortar", () => {
    const k = rampPreset("slowmo-middle", 4);
    const c = cutKeys(k, 1, 3)!;
    expect(c[0].t).toBe(0);
    expect(c[c.length - 1].t).toBeCloseTo(2);
    for (const t of [0, 0.5, 1, 1.5, 2]) expect(speedAt(c, t)).toBeCloseTo(speedAt(k, t + 1), 1);
  });
});

describe("rampa en el proyecto", () => {
  const ramped = () => {
    const p = projectWith(10, 6);
    return setRampPreset(p, p.clips[0].id, "slowmo-middle");
  };

  it("preset → el clip dura lo de la rampa, pasa a la etapa pesada y la firma cambia", () => {
    const base = projectWith(10, 6);
    const p = ramped();
    const c = p.clips[0];
    expect(clipDuration(c)).toBeCloseTo(rampDuration(c.speedKeys!, 10));
    expect(layout(p.clips)[1].start).toBeCloseTo(clipDuration(c));
    expect(needsHeavy(c)).toBe(true);
    expect(heavySignature(c, p)).not.toBe(heavySignature(base.clips[0], base));
    const q = setRampAudio(p, c.id, "pitch");
    expect(heavySignature(q.clips[0], q)).not.toBe(heavySignature(c, p));
    expect(sourceTime(c, clipDuration(c) / 2)).toBeCloseTo(5, 1);
  });

  it("puntos: agregar, mover (limitado a 0,1×–10×), borrar hasta volver a constante", () => {
    let p = ramped();
    const id = p.clips[0].id;
    const [q, kid] = addSpeedKey(p, id, 5);
    expect(q.clips[0].speedKeys).toHaveLength(5);
    p = moveSpeedKey(q, id, kid, 5, 50);
    expect(p.clips[0].speedKeys!.find((k) => k.id === kid)!.v).toBe(10);
    for (const k of [...p.clips[0].speedKeys!].slice(1)) p = removeSpeedKey(p, id, k.id);
    expect(p.clips[0].speedKeys).toBeUndefined();
    expect(needsHeavy(p.clips[0])).toBe(false);
    const r = ramped();
    expect(clearRamp(r, r.clips[0].id).clips[0].speedKeys).toBeUndefined();
  });

  it("dividir reparte la curva: la suma dura lo mismo", () => {
    const p = ramped();
    const total = clipDuration(p.clips[0]);
    const q = splitAt(p, total / 3);
    expect(clipDuration(q.clips[0]) + clipDuration(q.clips[1])).toBeCloseTo(total, 1);
    expect(q.clips[1].speedKeys![0].t).toBe(0);
  });

  it("recortar el inicio corre los puntos", () => {
    const p = ramped();
    const id = p.clips[0].id;
    const q = trimClip(p, id, "in", 2);
    expect(q.clips[0].inPoint).toBeCloseTo(2);
    const keys = q.clips[0].speedKeys!;
    expect(keys[0].t).toBe(0);
    expect(speedAt(keys, 3)).toBeCloseTo(speedAt(p.clips[0].speedKeys!, 5), 1);
  });

  it("pegar efectos lleva la rampa escalada al largo del destino", () => {
    let p = ramped();
    p = updateClip(p, p.clips[1].id, (c) => ({ ...c, inPoint: 0, outPoint: 5 }));
    const q = pasteEffects(p, effectsOf(p.clips[0]), [p.clips[1].id]);
    const k = q.clips[1].speedKeys!;
    expect(k[k.length - 1].t).toBeCloseTo(5);
    expect(rampDuration(k, 5)).toBeCloseTo(rampDuration(p.clips[0].speedKeys!, 10) / 2, 1);
  });
});
