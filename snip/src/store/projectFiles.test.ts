import { describe, expect, it } from "vitest";
import { projectFromTemplate, templateFrom, templateSummary } from "./projectFiles";
import { addText } from "../project/overlayOps";
import { media, projectWith } from "../project/testutil";

describe("plantillas", () => {
  it("guarda intro, outro, textos y exportación, y arma un proyecto nuevo con otros videos", () => {
    // Tres clips: intro (m1), contenido (m2), outro (m3).
    let p = projectWith(3, 20, 4);
    [p] = addText(p, "title", 3.5);
    p = { ...p, export: { ...p.export, format: "webm", sizeTarget: { preset: "discord", megabytes: 20 } } };
    const d = templateFrom(p, { name: "Canal", intro: true, outro: true, texts: true, exportPreset: true });
    expect(d.intro?.mediaId).toBe("m1");
    expect(d.outro?.mediaId).toBe("m3");
    expect(d.media.map((m) => m.id).sort()).toEqual(["m1", "m3"]);
    expect(d.overlays).toHaveLength(1);
    expect(templateSummary(d)).toBe("intro · outro · 1 texto · exporta WEBM ≤ 20 MB");

    const nuevo = { ...media("x", 30), path: "C:\\v\\partida.mp4" };
    const q = projectFromTemplate(d, [nuevo], 5);
    expect(q.clips).toHaveLength(3);
    const path = (id: string) => q.media.find((m) => m.id === q.clips.find((c) => c.id === id)!.mediaId)!.path;
    expect(path(q.clips[0].id)).toBe("C:\\v\\m1.mp4");
    expect(path(q.clips[1].id)).toBe("C:\\v\\partida.mp4");
    expect(path(q.clips[2].id)).toBe("C:\\v\\m3.mp4");
    expect(q.overlays[0].type).toBe("text");
    expect(q.overlays[0].id).not.toBe(p.overlays[0].id);
    expect(q.export.format).toBe("webm");
  });

  it("sin elegir nada: solo estilos, y no hay intro con un solo clip", () => {
    const p = projectWith(10);
    const d = templateFrom(p, { name: "", intro: true, outro: true, texts: false, exportPreset: false });
    expect(d.intro).toBeNull();
    expect(templateSummary(d)).toBe("estilos");
  });
});
