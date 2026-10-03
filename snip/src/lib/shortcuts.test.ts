import { describe, expect, it } from "vitest";
import { isTypingTarget, nextShuttleRate, shortcutFor } from "./shortcuts";

const k = (key: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; code: string }> = {}) => ({ key, ...extra });

describe("atajos", () => {
  it("mapea las teclas del editor", () => {
    expect(shortcutFor(k(" ", { code: "Space" }))).toEqual({ type: "togglePlay" });
    expect(shortcutFor(k("i"))).toEqual({ type: "markIn" });
    expect(shortcutFor(k("I", { shiftKey: true }))).toEqual({ type: "markIn" });
    expect(shortcutFor(k("o"))).toEqual({ type: "markOut" });
    expect(shortcutFor(k("ArrowLeft"))).toEqual({ type: "stepFrames", frames: -1 });
    expect(shortcutFor(k("ArrowRight"))).toEqual({ type: "stepFrames", frames: 1 });
    expect(shortcutFor(k("ArrowLeft", { shiftKey: true }))).toEqual({ type: "stepSeconds", seconds: -1 });
    expect(shortcutFor(k("ArrowRight", { shiftKey: true }))).toEqual({ type: "stepSeconds", seconds: 1 });
    expect(shortcutFor(k("j"))).toEqual({ type: "shuttle", key: "j" });
    expect(shortcutFor(k("K"))).toEqual({ type: "shuttle", key: "k" });
    expect(shortcutFor(k("l"))).toEqual({ type: "shuttle", key: "l" });
  });

  it("Ctrl+E exporta y Ctrl+O abre (también con Cmd)", () => {
    expect(shortcutFor(k("e", { ctrlKey: true }))).toEqual({ type: "export" });
    expect(shortcutFor(k("E", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "export" });
    expect(shortcutFor(k("o", { ctrlKey: true }))).toEqual({ type: "open" });
    expect(shortcutFor(k("o", { metaKey: true }))).toEqual({ type: "open" });
    // Ctrl + otra letra no es nada; Alt tampoco.
    expect(shortcutFor(k("i", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(k("i", { altKey: true }))).toBeNull();
    expect(shortcutFor(k("x"))).toBeNull();
  });

  it("se ignoran mientras se escribe en un input", () => {
    const input = { tagName: "INPUT", type: "text" };
    expect(shortcutFor(k("i"), input)).toBeNull();
    expect(shortcutFor(k(" "), input)).toBeNull();
    expect(shortcutFor(k("e", { ctrlKey: true }), input)).toBeNull();
    expect(shortcutFor(k("i"), { tagName: "TEXTAREA" })).toBeNull();
    expect(shortcutFor(k("i"), { tagName: "DIV", isContentEditable: true })).toBeNull();
    // Un checkbox o un botón no cuentan como escribir.
    expect(shortcutFor(k("i"), { tagName: "INPUT", type: "checkbox" })).toEqual({ type: "markIn" });
    expect(shortcutFor(k(" "), { tagName: "BUTTON" })).toEqual({ type: "togglePlay" });
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });

  it("J/K/L acelera, invierte y frena", () => {
    expect(nextShuttleRate(0, "l")).toBe(1);
    expect(nextShuttleRate(1, "l")).toBe(2);
    expect(nextShuttleRate(4, "l")).toBe(8);
    expect(nextShuttleRate(8, "l")).toBe(8);
    expect(nextShuttleRate(2, "j")).toBe(-1);
    expect(nextShuttleRate(-1, "j")).toBe(-2);
    expect(nextShuttleRate(-8, "j")).toBe(-8);
    expect(nextShuttleRate(-4, "l")).toBe(1);
    expect(nextShuttleRate(4, "k")).toBe(0);
  });
});

describe("atajos nuevos del editor", () => {
  it("edición: S, Supr, M y marcadores", () => {
    expect(shortcutFor(k("s"))).toEqual({ type: "split" });
    expect(shortcutFor(k("Delete"))).toEqual({ type: "delete" });
    expect(shortcutFor(k("Backspace"))).toEqual({ type: "delete" });
    expect(shortcutFor(k("m"))).toEqual({ type: "marker" });
    expect(shortcutFor(k("M", { shiftKey: true }))).toEqual({ type: "nextMarker" });
    expect(shortcutFor(k("M", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "prevMarker" });
  });

  it("deshacer, rehacer, guardar, zoom, pestañas y ayuda", () => {
    expect(shortcutFor(k("z", { ctrlKey: true }))).toEqual({ type: "undo" });
    expect(shortcutFor(k("y", { ctrlKey: true }))).toEqual({ type: "redo" });
    expect(shortcutFor(k("Z", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "redo" });
    expect(shortcutFor(k("s", { ctrlKey: true }))).toEqual({ type: "save" });
    expect(shortcutFor(k("+"))).toEqual({ type: "zoomIn" });
    expect(shortcutFor(k("-"))).toEqual({ type: "zoomOut" });
    expect(shortcutFor(k("=", { ctrlKey: true }))).toEqual({ type: "zoomIn" });
    expect(shortcutFor(k("Tab", { ctrlKey: true }))).toEqual({ type: "nextTab" });
    expect(shortcutFor(k("Tab", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "prevTab" });
    expect(shortcutFor(k("w", { ctrlKey: true }))).toEqual({ type: "closeTab" });
    expect(shortcutFor(k("?", { shiftKey: true }))).toEqual({ type: "help" });
    expect(shortcutFor(k("Home"))).toEqual({ type: "home" });
  });

  it("los nuevos también se ignoran escribiendo", () => {
    const input = { tagName: "INPUT", type: "text" };
    for (const e of [k("s"), k("Delete"), k("m"), k("z", { ctrlKey: true }), k("s", { ctrlKey: true })]) {
      expect(shortcutFor(e, input)).toBeNull();
    }
  });
});
