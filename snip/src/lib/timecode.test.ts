import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatFps,
  frameToSeconds,
  frameToTimecode,
  parseTimecode,
  secondsToFrame,
  secondsToTimecode,
  snapToFrame,
} from "./timecode";

describe("cuadros ↔ segundos", () => {
  it("convierte en ambas direcciones", () => {
    expect(secondsToFrame(1, 30)).toBe(30);
    expect(secondsToFrame(1.03, 30)).toBe(30);
    expect(secondsToFrame(1.034, 30)).toBe(31);
    expect(frameToSeconds(45, 30)).toBe(1.5);
    expect(secondsToFrame(-3, 30)).toBe(0);
    expect(secondsToFrame(NaN, 30)).toBe(0);
  });

  it("tolera timestamps redondeados por el contenedor (WebM en ms)", () => {
    // Cuadro 79 a 30 fps = 2,6333… s, pero WebM lo guarda como 2,633 s.
    expect(secondsToFrame(2.633, 30)).toBe(79);
    expect(secondsToFrame(0.033, 30)).toBe(1);
  });

  it("es exacto en el borde de cada cuadro para fps comunes", () => {
    for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]) {
      for (let f = 0; f < 5000; f += 7) {
        expect(secondsToFrame(frameToSeconds(f, fps), fps)).toBe(f);
      }
    }
  });

  it("snapToFrame redondea al borde más cercano", () => {
    expect(snapToFrame(1.01, 30)).toBeCloseTo(30 / 30);
    expect(snapToFrame(1.02, 30)).toBeCloseTo(31 / 30);
  });
});

describe("timecode HH:MM:SS:FF", () => {
  it("formatea", () => {
    expect(frameToTimecode(0, 30)).toBe("00:00:00:00");
    expect(frameToTimecode(29, 30)).toBe("00:00:00:29");
    expect(frameToTimecode(30, 30)).toBe("00:00:01:00");
    expect(frameToTimecode(30 * 3661 + 12, 30)).toBe("01:01:01:12");
    expect(frameToTimecode(24 * 59 + 23, 24)).toBe("00:00:59:23");
    expect(secondsToTimecode(12.5, 60)).toBe("00:00:12:30");
  });

  it("maneja 29,97 y 59,94 sin cuadros fuera de rango", () => {
    expect(frameToTimecode(30, 29.97)).toBe("00:00:01:00");
    expect(frameToTimecode(29, 29.97)).toBe("00:00:00:29");
    expect(frameToTimecode(60, 59.94)).toBe("00:00:01:00");
    for (let f = 0; f < 20000; f += 13) {
      const ff = Number(frameToTimecode(f, 29.97).split(":")[3]);
      expect(ff).toBeGreaterThanOrEqual(0);
      expect(ff).toBeLessThan(30);
    }
  });

  it("ida y vuelta cuadro → texto → cuadro", () => {
    for (const fps of [24, 25, 29.97, 30, 59.94, 60, 120]) {
      for (let f = 0; f < 100000; f += 97) {
        expect(parseTimecode(frameToTimecode(f, fps), fps)).toBe(f);
      }
    }
  });

  it("parsea formatos cortos", () => {
    expect(parseTimecode("00:00:02:15", 30)).toBe(75);
    expect(parseTimecode("1:30", 30)).toBe(90 * 30);
    expect(parseTimecode("01:02:03", 25)).toBe((3600 + 120 + 3) * 25);
    expect(parseTimecode("12.5", 30)).toBe(375);
    expect(parseTimecode("12,5", 30)).toBe(375);
    expect(parseTimecode("00;00;01;00", 30)).toBe(30);
    expect(parseTimecode("  7 ", 24)).toBe(168);
  });

  it("rechaza basura y valores fuera de rango", () => {
    for (const bad of ["", "abc", "1:2:3:4:5", "00:61:00", "00:00:60:00", "00:00:01:30", "::", "1:-2", "00:00:01:1.5"]) {
      expect(parseTimecode(bad, 30), bad).toBeNull();
    }
  });
});

describe("formatos legibles", () => {
  it("duraciones", () => {
    expect(formatDuration(5.83)).toBe("5,8 s");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(-1)).toBe("0,0 s");
  });
  it("fps", () => {
    expect(formatFps(30)).toBe("30");
    expect(formatFps(29.97002997)).toBe("29,97");
    expect(formatFps(59.94)).toBe("59,94");
  });
});
