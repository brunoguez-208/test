import { describe, expect, it } from "vitest";
import { addToLibrary, libraryItems, mediaUsage, placeMedia } from "./library";
import { insertMedia, newProject } from "./ops";
import { media } from "./testutil";
import type { MediaRef } from "./model";

const v = (id: string, name: string, d: number): MediaRef => ({ ...media(id, d), path: `C:\\v\\${name}` });
const song: MediaRef = { ...media("s", 60), kind: "audio", path: "C:\\m\\Tema.mp3", width: 0, height: 0 };
const logo: MediaRef = { ...media("l", 0, 200, 100, 30, false), kind: "image", path: "C:\\i\\logo.png" };

describe("biblioteca", () => {
  it("busca, ordena y marca lo que está en uso", () => {
    let p = insertMedia(newProject(1), [v("a", "Partida 2.mp4", 30)]);
    p = addToLibrary(p, [v("b", "partida 10.mp4", 5), song, logo]);
    expect(p.media).toHaveLength(4);
    expect(p.clips).toHaveLength(1);
    expect(libraryItems(p, "", "added").map((m) => m.id)).toEqual(["l", "s", "b", "a"]);
    expect(libraryItems(p, "", "name").map((m) => m.id)).toEqual(["l", "a", "b", "s"]);
    expect(libraryItems(p, "", "duration").map((m) => m.id)).toEqual(["s", "a", "b", "l"]);
    expect(libraryItems(p, "", "type").map((m) => m.kind)).toEqual(["video", "video", "audio", "image"]);
    expect(libraryItems(p, "PARTIDA", "name").map((m) => m.id)).toEqual(["a", "b"]);
    expect(mediaUsage(p).get("a")).toBe(1);
    expect(mediaUsage(p).get("b")).toBeUndefined();
    // Volver a sumar el mismo archivo no lo duplica.
    expect(addToLibrary(p, [v("z", "Partida 2.mp4", 30)]).media).toHaveLength(4);
  });

  it("ubica un medio en la pista elegida (o solo un tramo)", () => {
    let p = insertMedia(newProject(1), [v("a", "a.mp4", 30)]);
    p = addToLibrary(p, [v("b", "b.mp4", 20), song]);
    const [q, ids] = placeMedia(p, [p.media[1]], 30, { kind: "main", row: -1, time: 30 }, [4, 9]);
    expect(q.clips).toHaveLength(2);
    expect(q.clips[1]).toMatchObject({ id: ids[0], inPoint: 4, outPoint: 9 });
    const [r] = placeMedia(q, [p.media[1]], 3, { kind: "overlay", row: 0, time: 3 });
    expect(r.overlays[0].type).toBe("video");
    const [s] = placeMedia(r, [song], 2, { kind: "audio", row: 2, time: 2 }, [10, 15]);
    expect(s.music[0]).toMatchObject({ start: 2, inPoint: 10, outPoint: 15, track: 2 });
  });
});
