import { expect, test, type Page } from "@playwright/test";
import { open, seek } from "./helpers";

// "Agregar imagen" como capa normal, marca de agua y arrastrar archivos a una pista.
const project = (page: Page) => page.evaluate(() => window.__snipTest.project());

async function dropOn(page: Page, testId: string, paths: string[], fx = 0.5) {
  // Se mide y se suelta en el mismo instante (el timeline puede reacomodarse).
  await page.evaluate(
    async ([id, p, f]) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      const pos = { x: r.left + r.width * (f as number), y: r.top + 4 };
      await window.__snipMock.dragEnter(p as string[]);
      await window.__snipMock.dragOver(pos);
      await window.__snipMock.drop(p as string[], pos);
    },
    [testId, paths, fx] as const,
  );
}

test("imagen como capa: varias veces, rotación, animación y marca de agua", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-video").click();
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Pictures\\sticker.png"]));
  await seek(page, 2);
  await page.getByTestId("add-logo").click();
  await expect(page.getByTestId("image-editor")).toBeVisible();
  await seek(page, 3);
  await page.getByTestId("add-logo").click();
  await expect(page.getByTestId("overlay-item")).toHaveCount(2);
  let p = (await project(page))!;
  expect(p.overlays.map((o) => [o.start, o.duration])).toEqual([[2, 5], [3, 5]]);

  // Rotación y animación de entrada.
  const slider = page.getByTestId("image-rotation");
  await slider.focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("image-anim-in").click();
  await page.getByRole("option", { name: "Pop" }).click();
  p = (await project(page))!;
  const img = p.overlays.find((o) => o.start === 3)!;
  expect(img.type === "image" && img.rotation).toBeGreaterThan(0);
  expect(img.type === "image" && img.animIn?.kind).toBe("pop");
  await seek(page, 4);
  await page.screenshot({ path: "e2e/screenshots/a4-imagen-capa.png" });

  // Marca de agua: todo el video, abajo a la derecha, un solo paso de deshacer.
  await page.getByTestId("image-watermark").click();
  p = (await project(page))!;
  const wm = p.overlays.find((o) => o.type === "image" && o.watermark)!;
  expect(wm).toMatchObject({ start: 0, duration: 12 });
  expect(wm.type === "image" && wm.x).toBeGreaterThan(0.7);
  expect(page.getByTestId("image-duration")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  p = (await project(page))!;
  expect(p.overlays.some((o) => o.type === "image" && o.watermark)).toBe(false);
});

test("arrastrar del Explorador a la pista elegida", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__snipTest.addText(1));
  await expect(page.getByTestId("overlay-item")).toHaveCount(1);
  // Imagen sobre la fila de capas, cerca del final.
  await dropOn(page, "overlay-track", ["C:\\Users\\Bruno\\Pictures\\logo.png"], 0.75);
  await expect(page.getByTestId("overlay-item")).toHaveCount(2);
  let p = (await project(page))!;
  const img = p.overlays.find((o) => o.type === "image")!;
  expect(img.lane).toBe(0);
  expect(img.start).toBeGreaterThan(6);
  // Video sobre las capas → picture-in-picture.
  await dropOn(page, "overlay-track", ["C:\\Users\\Bruno\\Videos\\facecam 6s.mp4"], 0.1);
  await expect(page.locator(".tl-overlay-video")).toHaveCount(1);
  // Audio sobre la pista de audio del clip → una pista de audio en ese tiempo.
  await dropOn(page, "audio-track", ["C:\\Users\\Bruno\\Music\\tema.mp3"], 0.5);
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  p = (await project(page))!;
  expect(p.music[0].start).toBeGreaterThan(4);
  expect(p.music[0].start).toBeLessThan(8);
  // Otro audio sobre la misma fila en el mismo lugar → otra pista (no se pisan).
  await dropOn(page, "music-track", ["C:\\Users\\Bruno\\Music\\efecto.wav"], 0.5);
  await expect(page.getByTestId("music-clip")).toHaveCount(2);
  p = (await project(page))!;
  expect(p.music.map((m) => m.track ?? 0).sort(), JSON.stringify(p.music.map((m) => [m.start, m.outPoint - m.inPoint, m.track]))).toEqual([0, 1]);
  // Video sobre la pista principal → se inserta ahí.
  await dropOn(page, "video-track", ["C:\\Users\\Bruno\\Videos\\Otro 4s.mp4"], 0.02);
  await expect(page.getByTestId("clip")).toHaveCount(2);
  p = (await project(page))!;
  expect(p.media.find((m) => m.id === p.clips[0].mediaId)!.path).toContain("Otro 4s");
});
