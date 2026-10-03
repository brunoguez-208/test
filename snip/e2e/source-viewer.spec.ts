import { expect, test, type Page } from "@playwright/test";
import { open, seek, settled } from "./helpers";

// Visor de origen: doble clic en la biblioteca, I/O en su mini timeline,
// "Insertar en el playhead" y arrastrar el fragmento a una pista.
const project = (page: Page) => page.evaluate(() => window.__snipTest.project());

async function openViewer(page: Page) {
  await page.getByTestId("toggle-library").click();
  await settled(page, "library");
  await page.getByTestId("lib-item").first().dblclick();
  await expect(page.getByTestId("source-viewer")).toBeVisible();
  await settled(page, "source-viewer");
}

async function clickBar(page: Page, f: number) {
  const b = (await page.getByTestId("source-bar").boundingBox())!;
  await page.mouse.click(b.x + b.width * f, b.y + b.height / 2);
}

test("marcar entrada y salida e insertar en el playhead", async ({ page }) => {
  await open(page);
  await seek(page, 12);
  await openViewer(page);
  await clickBar(page, 0.25);
  await page.keyboard.press("i");
  await clickBar(page, 0.75);
  await page.keyboard.press("o");
  await expect(page.getByTestId("source-in")).toContainText("00:00:03");
  await expect(page.getByTestId("source-out")).toContainText("00:00:09");
  await page.screenshot({ path: "e2e/screenshots/b2-visor.png" });
  // Los atajos del visor no tocan el proyecto (I/O del editor siguen vacíos).
  await page.getByTestId("source-insert").click();
  await expect(page.getByTestId("source-viewer")).toHaveCount(0);
  await expect(page.getByTestId("clip")).toHaveCount(2);
  const p = (await project(page))!;
  expect(Math.abs(p.clips[1].inPoint - 3)).toBeLessThan(0.15);
  expect(Math.abs(p.clips[1].outPoint - 9)).toBeLessThan(0.15);
  // Cuadros exactos.
  expect(Math.abs(p.clips[1].inPoint * 30 - Math.round(p.clips[1].inPoint * 30))).toBeLessThan(1e-6);
  await expect(page.getByTestId("total-tc")).toContainText("00:00:1");
});

test("arrastrar el fragmento a la pista de audio y cerrar con Esc", async ({ page }) => {
  await open(page);
  await openViewer(page);
  await clickBar(page, 0.5);
  await page.keyboard.press("i");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o");
  const at = (await page.getByTestId("audio-track").boundingBox())!;
  await page.getByTestId("source-drag").dragTo(page.getByTestId("audio-track"), { targetPosition: { x: at.width * 0.25, y: 10 } });
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  const p = (await project(page))!;
  expect(p.music[0].inPoint).toBeCloseTo(6, 1);
  expect(p.music[0].outPoint - p.music[0].inPoint).toBeCloseTo(2, 1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("source-viewer")).toHaveCount(0);
});
