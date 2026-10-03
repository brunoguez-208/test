import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useSnip } from "../store/snip";
import type { MediaInfo } from "../lib/types";

const startExport = vi.fn();
const openWithDialog = vi.fn();
vi.mock("../store/controller", () => ({ startExport: () => startExport(), openWithDialog: () => openWithDialog() }));
const togglePlay = vi.fn();
const stepFrames = vi.fn();
const stepSeconds = vi.fn();
const shuttle = vi.fn();
vi.mock("../lib/playback", () => ({
  togglePlay: () => togglePlay(),
  stepFrames: (n: number) => stepFrames(n),
  stepSeconds: (n: number) => stepSeconds(n),
  shuttle: (k: string) => shuttle(k),
}));

const { useShortcuts } = await import("./useShortcuts");

function Host() {
  useShortcuts();
  return <input data-testid="tc" />;
}

const MEDIA = { path: "a.mp4", duration: 10, width: 1920, height: 1080, fps: 30 } as MediaInfo;

const press = (key: string, opts: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));

describe("useShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSnip.getState().reset();
    useSnip.getState().setMediaLoaded(MEDIA, "x", 1);
  });
  afterEach(cleanup);

  it("dispara las acciones en el editor", () => {
    render(<Host />);
    press(" ", { code: "Space" });
    press("ArrowRight");
    press("ArrowLeft", { shiftKey: true });
    press("l");
    press("e", { ctrlKey: true });
    press("o", { ctrlKey: true });
    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(stepFrames).toHaveBeenCalledWith(1);
    expect(stepSeconds).toHaveBeenCalledWith(-1);
    expect(shuttle).toHaveBeenCalledWith("l");
    expect(startExport).toHaveBeenCalledTimes(1);
    expect(openWithDialog).toHaveBeenCalledTimes(1);
  });

  it("I y O marcan el rango", () => {
    render(<Host />);
    useSnip.getState().setCurrent(2);
    press("i");
    useSnip.getState().setCurrent(5);
    press("o");
    expect(useSnip.getState().start).toBeCloseTo(2);
    expect(useSnip.getState().end).toBeCloseTo(5 + 1 / 30);
  });

  it("se ignoran mientras se escribe en un input", () => {
    const { getByTestId } = render(<Host />);
    const input = getByTestId("tc");
    input.focus();
    press("i", {}, input);
    press(" ", {}, input);
    press("e", { ctrlKey: true }, input);
    expect(useSnip.getState().start).toBe(0);
    expect(togglePlay).not.toHaveBeenCalled();
    expect(startExport).not.toHaveBeenCalled();
  });

  it("no hacen nada con un diálogo de confirmación abierto ni sin video", () => {
    render(<Host />);
    useSnip.setState({ confirmation: { kind: "fps", fps: "fps60", from: "30", to: "60" } });
    press(" ");
    expect(togglePlay).not.toHaveBeenCalled();
    useSnip.setState({ confirmation: null });
    useSnip.getState().reset();
    press(" ");
    press("e", { ctrlKey: true });
    expect(togglePlay).not.toHaveBeenCalled();
    expect(startExport).not.toHaveBeenCalled();
    // Ctrl+O sí funciona en la bienvenida.
    press("o", { ctrlKey: true });
    expect(openWithDialog).toHaveBeenCalledTimes(1);
  });

  it("durante la exportación no se puede mover el rango ni re-exportar", () => {
    render(<Host />);
    useSnip.setState({ exportState: { status: "running", progress: { percent: 1, speed: null, etaSecs: null, outTime: 0 }, startedAt: 0, cancelling: false } });
    useSnip.getState().setCurrent(3);
    press("i");
    press("e", { ctrlKey: true });
    expect(useSnip.getState().start).toBe(0);
    expect(startExport).not.toHaveBeenCalled();
  });
});
