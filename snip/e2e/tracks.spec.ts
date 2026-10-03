import { expect, test, type Page } from "@playwright/test";
import { focusBody, open, seek } from "./helpers";

// Cabeceras de pista (ojo, silenciar, solo, candado), Q/W y el panel de atajos.
const project = (page: Page) => page.evaluate(() => window.__snipTest.project());

test("ojo, candado y silenciar por pista", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__snipTest.addText(1));
  // Ojo en la fila de capas: la capa se ve apagada y no se dibuja.
  await page.getByTestId("track-eye-overlay-0").click();
  await expect(page.locator(".tl-overlay.is-hidden")).toHaveCount(1);
  let p = (await project(page))!;
  expect(p.tracks!.overlays![0].hidden).toBe(true);
  // Ojo en el video.
  await page.getByTestId("track-eye-video").click();
  await expect(page.getByTestId("video-track")).toHaveAttribute("data-hidden", "true");
  await page.screenshot({ path: "e2e/screenshots/a6-pistas.png" });
  await page.getByTestId("track-eye-video").click();

  // Candado: el clip no se borra ni se divide.
  await page.getByTestId("track-lock-video").click();
  await page.getByTestId("clip").first().click();
  await focusBody(page);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("toast-caution")).toContainText("bloqueada");
  await seek(page, 5);
  await page.keyboard.press("s");
  await expect(page.getByTestId("clip")).toHaveCount(1);
  // Arrastrar el borde no recorta.
  const trim = page.getByTestId("trim-out").first();
  const tb = (await trim.boundingBox())!;
  await page.mouse.move(tb.x + 2, tb.y + 10);
  await page.mouse.down();
  await page.mouse.move(tb.x - 120, tb.y + 10, { steps: 5 });
  await page.mouse.up();
  p = (await project(page))!;
  expect(p.clips[0].outPoint).toBe(12);
  await page.getByTestId("track-lock-video").click();

  // Silenciar el audio del video.
  await page.getByTestId("track-mute-video-audio").click();
  await expect(page.getByTestId("audio-track")).toHaveAttribute("data-muted", "true");
});

test("Q y W recortan hasta el playhead; el panel ? los muestra", async ({ page }) => {
  await open(page);
  await seek(page, 3);
  await page.keyboard.press("q");
  await expect(page.getByTestId("total-tc")).toContainText("00:00:09:00");
  await expect(page.getByTestId("current-tc")).toHaveValue(/00:00:00:00/);
  await seek(page, 6);
  await page.keyboard.press("w");
  await expect(page.getByTestId("total-tc")).toContainText("00:00:06:00");
  const p = (await project(page))!;
  expect(p.clips[0].inPoint).toBeCloseTo(3, 1);
  expect(p.clips[0].outPoint).toBeCloseTo(9, 1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("total-tc")).toContainText("00:00:09:00");
  // Panel de atajos con los nuevos.
  await page.keyboard.press("?");
  const panel = page.getByRole("dialog");
  for (const t of ["Q / W", "Ctrl + C / X", "Ctrl + D", "Ctrl + Alt + V", "Ctrl + G", "Ctrl + Shift + G", "Ojo / M / S / candado"]) await expect(panel).toContainText(t);
  await page.screenshot({ path: "e2e/screenshots/a6-atajos.png" });
});
