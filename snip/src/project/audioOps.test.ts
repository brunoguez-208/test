import { describe, expect, it } from "vitest";
import { addVolumeKey, audioUnder, canJoin, canSeparate, joinAudio, moveVolumeKey, removeVolumeKey, separateAudio, setEnhance, setTrackState, splitMusicAt, trackState } from "./audioOps";
import { effectiveFades, keyGain, smooth, trackGain, voiceParams } from "../engine/audioFx";
import { addMusic, updateClip } from "./ops";
import { media, projectWith } from "./testutil";
import type { MediaRef, MusicClip, Project } from "./model";

const song: MediaRef = { ...media("song", 60), kind: "audio", path: "C:\\m\\tema.mp3", width: 0, height: 0 };

describe("separar y unir audio", () => {
  it("el audio pasa a su pista (mismo tramo y lugar) y vuelve", () => {
    let p = projectWith(10, 10);
    p = updateClip(p, p.clips[1].id, (c) => ({ ...c, inPoint: 2, outPoint: 8, audio: { ...c.audio, volume: 0.7 } }));
    const id = p.clips[1].id;
    expect(canSeparate(p, id)).toBe(true);
    const [q, [mu]] = separateAudio(p, [id]);
    const m = q.music.find((x) => x.id === mu)!;
    expect(m).toMatchObject({ start: 10, inPoint: 2, outPoint: 8, volume: 0.7, linkedClip: id, mediaId: p.clips[1].mediaId });
    expect(q.clips[1].audio.detached).toBe(true);
    expect(canSeparate(q, id)).toBe(false);
    expect(canJoin(q, [id])).toBe(true);
    const r = joinAudio(q, [mu]);
    expect(r.music).toHaveLength(0);
    expect(r.clips[1].audio.detached).toBe(false);
  });

  it("no separa clips con velocidad o sin audio", () => {
    let p = projectWith(10);
    p = updateClip(p, p.clips[0].id, (c) => ({ ...c, speed: 2 }));
    expect(() => separateAudio(p, [p.clips[0].id])).toThrow();
  });
});

describe("clips de audio", () => {
  function withSong(): [Project, MusicClip] {
    const p = addMusic(projectWith(30), song, 2);
    return [p, p.music[0]];
  }

  it("S divide el audio elegido y reparte la curva de volumen", () => {
    let [p, mu] = withSong();
    [p] = addVolumeKey(p, mu.id, 1, 1);
    [p] = addVolumeKey(p, mu.id, 6, 0.3);
    expect(audioUnder(p, [mu.id], 5)).toEqual([mu.id]);
    const q = splitMusicAt(p, mu.id, 5);
    expect(q.music).toHaveLength(2);
    const [a, b] = q.music;
    expect(a.outPoint - a.inPoint).toBeCloseTo(3, 9);
    expect(b.start).toBe(5);
    expect(b.inPoint).toBeCloseTo(3, 9);
    expect(a.volumeKeys!.map((k) => k.t)).toEqual([1]);
    expect(b.volumeKeys!.map((k) => k.t)).toEqual([3]);
    expect(() => splitMusicAt(p, mu.id, 2.05)).toThrow();
  });

  it("puntos de volumen: agregar, mover (con tope) y borrar", () => {
    let [p, mu] = withSong();
    let k = 0;
    [p, k] = addVolumeKey(p, mu.id, 4, 0.5);
    p = moveVolumeKey(p, mu.id, k, 5, 9);
    expect(p.music[0].volumeKeys![0]).toMatchObject({ t: 5, v: 2 });
    p = removeVolumeKey(p, mu.id, k);
    expect(p.music[0].volumeKeys).toEqual([]);
  });
});

describe("espejo de audio_fx.rs", () => {
  it("curva suave igual que key_gain", () => {
    const keys = [
      { id: 1, t: 1, v: 1 },
      { id: 2, t: 3, v: 0.2 },
    ];
    expect(keyGain(keys, 0)).toBe(1);
    expect(keyGain(keys, 2)).toBeCloseTo(0.6, 12);
    expect(keyGain(keys, 1.5)).toBeCloseTo(1 - 0.8 * smooth(0.25), 12);
    expect(keyGain(keys, 9)).toBe(0.2);
  });

  it("parámetros de Mejorar voz iguales a los de Rust", () => {
    const v = voiceParams({ amount: 0.6, loudness: null });
    expect(v.highpassHz).toBe(100);
    expect(v.presenceDb).toBeCloseTo(3, 9);
    expect(v.makeupDb).toBe(0);
    const l = { inputI: -30, inputTp: -10, inputLra: 5, inputThresh: -40, targetOffset: 0 };
    expect(voiceParams({ amount: 0.5, loudness: l }).makeupDb).toBe(14);
    expect(voiceParams({ amount: 0.5, loudness: { ...l, inputI: 0 } }).makeupDb).toBe(-12);
  });

  it("crossfade automático y ganancia de pista con solo", () => {
    let p = projectWith(30);
    p = addMusic(p, song, 0);
    p = addMusic(p, song, 4);
    p = { ...p, music: [{ ...p.music[0], outPoint: 4, fadeOut: 0, fadeIn: 0 }, { ...p.music[1], outPoint: 3, fadeIn: 0, fadeOut: 0 }] };
    expect(effectiveFades(p, p.music[0])).toEqual([0, 0.03]);
    expect(effectiveFades(p, p.music[1])).toEqual([0.03, 0]);
    p = setTrackState(p, { kind: "audio", index: 1 }, { volume: 0.5 });
    expect(trackState(p, { kind: "audio", index: 1 }).volume).toBe(0.5);
    expect(trackGain(p.tracks, p.tracks!.audio![1])).toBe(0.5);
    p = setTrackState(p, { kind: "audio", index: 0 }, { solo: true });
    expect(trackGain(p.tracks, p.tracks!.audio![1])).toBe(0);
    expect(trackGain(p.tracks, p.tracks!.videoAudio)).toBe(0);
    expect(trackGain(p.tracks, p.tracks!.audio![0])).toBe(1);
  });

  it("Mejorar voz se aplica a clips y a audios", () => {
    let p = addMusic(projectWith(10), song, 0);
    p = setEnhance(p, [p.clips[0].id, p.music[0].id], { amount: 0.4 });
    expect(p.clips[0].audio.enhance?.amount).toBe(0.4);
    expect(p.music[0].enhance?.amount).toBe(0.4);
  });
});
