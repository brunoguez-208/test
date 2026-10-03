import { describe, expect, it } from "vitest";
import { basename, dirname, formatBytes, isMp4, middleEllipsis } from "./files";
import { keyframeAtOrBefore } from "./keyframes";

describe("archivos", () => {
  it("solo MP4", () => {
    expect(isMp4("C:\\v\\clip.mp4")).toBe(true);
    expect(isMp4("C:\\v\\CLIP.MP4")).toBe(true);
    for (const p of ["a.mov", "a.mkv", "a.webm", "mp4", "a.mp4.txt", "a.mp3"]) expect(isMp4(p), p).toBe(false);
  });
  it("rutas", () => {
    expect(basename("C:\\Users\\B\\Videos\\clip.mp4")).toBe("clip.mp4");
    expect(dirname("C:\\Users\\B\\Videos\\clip.mp4")).toBe("C:\\Users\\B\\Videos");
    expect(basename("/home/b/x.mp4")).toBe("x.mp4");
    expect(middleEllipsis("x".repeat(100), 20)).toHaveLength(20);
  });
  it("tamaños", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(1536)).toBe("1,50 KB");
    expect(formatBytes(21_450_000)).toBe("20,5 MB");
  });
  it("keyframe anterior al inicio", () => {
    expect(keyframeAtOrBefore([0, 2, 4], 3.5)).toBe(2);
    expect(keyframeAtOrBefore([0, 2, 4], 2)).toBe(2);
    expect(keyframeAtOrBefore([1, 2], 0.5)).toBeNull();
  });
});
