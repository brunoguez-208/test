import { beforeEach, describe, expect, it } from "vitest";
import { buildExportRequest, effectiveMode, useSnip } from "./snip";
import type { MediaInfo } from "../lib/types";

const MEDIA: MediaInfo = {
  path: "C:\\v\\clip.mp4",
  duration: 10,
  width: 1920,
  height: 1080,
  codedWidth: 1920,
  codedHeight: 1080,
  rotation: 0,
  fps: 30,
  fpsNum: 30,
  fpsDen: 1,
  frameCount: 300,
  videoCodec: "h264",
  hasAudio: true,
  audioCodec: "aac",
};

const st = () => useSnip.getState();

beforeEach(() => {
  st().reset();
  st().setMediaLoaded(MEDIA, "asset://clip", 1);
});

describe("carga de un video", () => {
  it("pasa al editor con el rango completo", () => {
    expect(st().phase).toBe("editor");
    expect(st().start).toBe(0);
    expect(st().end).toBe(10);
    expect(st().thumbs).toHaveLength(20);
    expect(st().settings.resolution).toEqual({ kind: "original" });
  });

  it("al abrir otro video se resetean rango, export y confirmaciones", () => {
    st().setRange(2, 5);
    useSnip.setState({ exportState: { status: "error", error: { kind: "unknown", message: "x" } } });
    st().requestResolution({ kind: "p1080" });
    st().setMediaLoaded({ ...MEDIA, path: "C:\\v\\otro.mp4", duration: 4 }, "asset://otro", 2);
    expect([st().start, st().end]).toEqual([0, 4]);
    expect(st().exportState.status).toBe("idle");
    expect(st().settings.resolution.kind).toBe("original");
    expect(st().session).toBe(2);
  });
});

describe("rango de recorte", () => {
  it("cuantiza a cuadros y recorta a la duración", () => {
    st().setRange(1.01, 20);
    expect(st().start).toBeCloseTo(30 / 30);
    expect(st().end).toBe(10);
    st().setRange(-5, 3.017);
    expect(st().start).toBe(0);
    expect(st().end).toBeCloseTo(90 / 30);
  });

  it("el inicio nunca pasa al fin (mínimo un cuadro)", () => {
    st().setRange(2, 4);
    st().setStart(9);
    expect(st().start).toBeCloseTo(4 - 1 / 30);
    st().setEnd(0);
    expect(st().end).toBeCloseTo(st().start + 1 / 30);
  });

  it("I marca el cuadro visible y O incluye el cuadro visible", () => {
    st().setCurrent(2.5);
    st().markIn();
    expect(st().start).toBeCloseTo(2.5);
    st().setCurrent(6);
    st().markOut();
    expect(st().end).toBeCloseTo(6 + 1 / 30);
    // O en el último cuadro llega exacto a la duración.
    st().setCurrent(10 - 1 / 30);
    st().markOut();
    expect(st().end).toBe(10);
  });

  it("O antes del inicio no invierte el rango", () => {
    st().setRange(5, 8);
    st().setCurrent(1);
    st().markOut();
    expect(st().end).toBeGreaterThan(st().start);
  });
});

describe("modo de exportación", () => {
  it("por defecto es rápido sin pérdida", () => {
    expect(effectiveMode(st().settings)).toBe("fast");
    expect(buildExportRequest(st())!.mode).toBe("fast");
  });

  it("cambiar resolución o fps, o pedir corte exacto, pasa a preciso", () => {
    st().requestResolution({ kind: "p720" });
    expect(st().settings.mode).toBe("precise");
    expect(effectiveMode(st().settings)).toBe("precise");

    st().setMode("fast");
    expect(st().settings.resolution.kind).toBe("original");
    st().requestFps("fps24");
    expect(effectiveMode(st().settings)).toBe("precise");

    st().setMode("fast");
    st().setFrameExact(true);
    expect(effectiveMode(st().settings)).toBe("precise");
  });

  it("volver a rápido deja todo en original", () => {
    st().requestResolution({ kind: "p720" });
    st().requestFps("fps24");
    st().setFrameExact(true);
    st().setMode("fast");
    const s = st().settings;
    expect([s.mode, s.resolution.kind, s.fps, s.frameExact]).toEqual(["fast", "original", "original", false]);
  });

  it("agrandar pide confirmación; cancelar no cambia nada", () => {
    st().requestResolution({ kind: "p2160" });
    expect(st().confirmation?.kind).toBe("upscale");
    expect(st().settings.resolution.kind).toBe("original");
    st().resolveConfirmation(false);
    expect(st().confirmation).toBeNull();
    expect(st().settings.resolution.kind).toBe("original");

    st().requestResolution({ kind: "p2160" });
    st().resolveConfirmation(true);
    expect(st().settings.resolution.kind).toBe("p2160");
    expect(st().settings.allowUpscale).toBe(true);
    expect(buildExportRequest(st())!.allowUpscale).toBe(true);
  });

  it("subir fps pide confirmación; 30 desde 29,97 no", () => {
    st().requestFps("fps60");
    expect(st().confirmation?.kind).toBe("fps");
    st().resolveConfirmation(true);
    expect(st().settings.fps).toBe("fps60");
    expect(st().settings.allowFpsIncrease).toBe(true);

    st().setMediaLoaded({ ...MEDIA, fps: 29.97 }, "x", 3);
    st().requestFps("fps30");
    expect(st().confirmation).toBeNull();
    expect(st().settings.fps).toBe("fps30");
  });
});

describe("pedido tipado para Rust", () => {
  it("lleva todo lo necesario y nunca un string de comando", () => {
    st().setRange(1, 4);
    st().requestResolution({ kind: "custom", width: 1280 });
    st().setOutputPath("C:\\out\\final.mp4");
    const req = buildExportRequest(st())!;
    expect(req).toEqual({
      input: "C:\\v\\clip.mp4",
      output: "C:\\out\\final.mp4",
      start: 1,
      end: 4,
      mode: "precise",
      resolution: { kind: "custom", width: 1280 },
      fps: "original",
      frameExact: false,
      allowUpscale: false,
      allowFpsIncrease: false,
    });
  });

  it("sin video no hay pedido", () => {
    st().reset();
    expect(buildExportRequest(st())).toBeNull();
  });
});

describe("avisos y volumen", () => {
  it("no duplica avisos iguales y guarda como máximo 3", () => {
    st().pushToast({ severity: "caution", title: "Por ahora solo MP4" });
    st().pushToast({ severity: "caution", title: "Por ahora solo MP4" });
    expect(st().toasts).toHaveLength(1);
    for (let i = 0; i < 5; i++) st().pushToast({ severity: "info", title: `t${i}` });
    expect(st().toasts).toHaveLength(3);
    st().dismissToast(st().toasts[0].id);
    expect(st().toasts).toHaveLength(2);
  });

  it("volumen 0 silencia y se recuerda", () => {
    st().setVolume(0);
    expect(st().muted).toBe(true);
    st().toggleMute();
    expect(st().muted).toBe(false);
    expect(st().volume).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem("snip.volume")!).muted).toBe(false);
  });
});
