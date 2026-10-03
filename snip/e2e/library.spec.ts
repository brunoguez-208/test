import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers";

// Biblioteca de medios: importar, buscar, ordenar, scrub, "en uso", arrastrar
// a una pista, soltar del Explorador sobre el panel y archivos que faltan.
const project = (page: Page) => page.evaluate(() => window.__snipTest.project());

test("importar, buscar, ordenar, scrub y arrastrar a una pista", async ({ page }) => {
  await open(page);
  await page.getByTestId("toggle-library").click();
  await expect(page.getByTestId("library")).toBeVisible();
  // El video abierto ya está y se marca como "en uso".
  await expect(page.getByTestId("lib-item")).toHaveCount(1);
  await expect(page.getByTestId("lib-item").first()).toHaveAttribute("data-used", "true");

  // Importar con el botón: no toca el timeline.
  await page.evaluate(() => {
    window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\Gol 8s.mp4", "C:\\Users\\Bruno\\Music\\tema.mp3", "C:\\Users\\Bruno\\Pictures\\logo.png"];
  });
  await page.getByTestId("lib-import").click();
  await expect(page.getByTestId("lib-item")).toHaveCount(4);
  await expect(page.getByTestId("clip")).toHaveCount(1);
  await expect(page.locator("[data-testid='lib-item'][data-used='false']")).toHaveCount(3);

  // Buscar y ordenar.
  await page.getByTestId("lib-search").fill("gol");
  await expect(page.getByTestId("lib-item")).toHaveCount(1);
  await page.getByTestId("lib-search").fill("");
  await page.getByTestId("lib-sort").click();
  await page.getByRole("option", { name: "Duración" }).click();
  await expect(page.getByTestId("lib-item").first()).toContainText("tema.mp3");
  await page.waitForTimeout(500); // termina la animación de reordenar

  // Scrub: el momento de la miniatura sigue al mouse.
  const gol = page.locator("[data-testid='lib-item']", { hasText: "Gol 8s" });
  const thumb = gol.getByTestId("lib-thumb");
  const b = (await thumb.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height / 2);
  const t1 = Number(await thumb.getAttribute("data-time"));
  await page.mouse.move(b.x + b.width * 0.9, b.y + b.height / 2);
  const t2 = Number(await thumb.getAttribute("data-time"));
  expect(t2).toBeGreaterThan(t1 + 4);
  await page.screenshot({ path: "e2e/screenshots/b1-biblioteca.png" });

  // Arrastrar el video a la pista principal (al final) y el audio a la de audio.
  const vt = (await page.getByTestId("video-track").boundingBox())!;
  await gol.dragTo(page.getByTestId("video-track"), { targetPosition: { x: vt.width - 10, y: 20 } });
  await expect(page.getByTestId("clip")).toHaveCount(2);
  await expect(gol).toHaveAttribute("data-used", "true");
  const tema = page.locator("[data-testid='lib-item']", { hasText: "tema.mp3" });
  await tema.dragTo(page.getByTestId("audio-track"), { targetPosition: { x: Math.min(200, vt.width / 3), y: 10 } });
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  const p = (await project(page))!;
  expect(p.music[0].start).toBeGreaterThan(1);
});

test("soltar del Explorador sobre la biblioteca y vincular un archivo que falta", async ({ page }) => {
  await open(page);
  await page.getByTestId("toggle-library").click();
  await page.waitForTimeout(500); // el panel termina de entrar
  await page.evaluate(async () => {
    const r = document.querySelector("[data-testid='lib-list']")!.getBoundingClientRect();
    const pos = { x: r.left + 40, y: r.top + 40 };
    await window.__snipMock.dragEnter(["C:\\Users\\Bruno\\Videos\\Clip 5s.mp4"]);
    await window.__snipMock.dragOver(pos);
    await window.__snipMock.drop(["C:\\Users\\Bruno\\Videos\\Clip 5s.mp4"], pos);
  });
  await expect(page.getByTestId("lib-item")).toHaveCount(2);
  await expect(page.getByTestId("clip")).toHaveCount(1);
});
