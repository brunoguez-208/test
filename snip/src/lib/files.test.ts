import { describe, expect, it } from "vitest";
import { basename, dirname, extension, formatBytes, isAudio, isImage, isMp4, isProjectFile, isVideo, middleEllipsis, stem, timeAgo } from "./files";
import { keyframeAtOrBefore } from "./keyframes";

describe("archivos", () => {
  it("videos que abre Snip 2: MP4, MOV, MKV y WebM", () => {
    for (const p of ["C:\\v\\clip.mp4", "C:\\v\\CLIP.MOV", "a.mkv", "a.WebM"]) expect(isVideo(p), p).toBe(true);
    for (const p of ["a.avi", "mp4", "a.mp4.txt", "a.mp3", "a.snip"]) expect(isVideo(p), p).toBe(false);
    expect(isProjectFile("C:\\p\\viaje_snip.snip")).toBe(true);
    expect(isAudio("tema.MP3") && isAudio("voz.wav")).toBe(true);
    expect(isImage("logo.png") && !isImage("logo.svg")).toBe(true);
    expect(isMp4("a.Mp4") && !isMp4("a.mov")).toBe(true);
    expect(extension("C:\\x.y\\z")).toBe("");
  });
  it("rutas", () => {
    expect(basename("C:\\Users\\B\\Videos\\clip.mp4")).toBe("clip.mp4");
    expect(stem("C:\\Users\\B\\Videos\\mi.clip.mp4")).toBe("mi.clip");
    expect(dirname("C:\\Users\\B\\Videos\\clip.mp4")).toBe("C:\\Users\\B\\Videos");
    expect(basename("/home/b/x.mp4")).toBe("x.mp4");
    expect(middleEllipsis("x".repeat(100), 20)).toHaveLength(20);
  });
  it("tamaños", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(1536)).toBe("1,50 KB");
    expect(formatBytes(21_450_000)).toBe("20,5 MB");
  });
  it("editado hace X", () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe("recién");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("hace 5 minutos");
    expect(timeAgo(now - 60 * 60_000, now)).toBe("hace 1 hora");
    expect(timeAgo(now - 26 * 3600_000, now)).toBe("ayer");
    expect(timeAgo(now - 5 * 86400_000, now)).toBe("hace 5 días");
  });
  it("keyframe anterior al inicio", () => {
    expect(keyframeAtOrBefore([0, 2, 4], 3.5)).toBe(2);
    expect(keyframeAtOrBefore([0, 2, 4], 2)).toBe(2);
    expect(keyframeAtOrBefore([1, 2], 0.5)).toBeNull();
  });
});
