import { expect, test, type Page } from "@playwright/test";
import { focusBody, open, openQueue, project, seek } from "./helpers";

// Chroma key en un PiP: activar, gotero sobre la vista previa, ajustes,
// deshacer y exportar con la llave.

type Pip = { type: "video"; chroma?: { color: string; similarity: number; smoothness: number; despill: number } | null };

const chroma = async (page: Page) => ((await project(page))?.overlays[0] as Pip | undefined)?.chroma;

test("chroma key: gotero, similitud, suavidad, reflejo y exportar", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-video").click();
  await seek(page, 1);
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\camara verde.mp4"]));
  await page.getByTestId("add-pip").click();
  await expect(page.getByTestId("pip-editor")).toBeVisible();

  await page.getByTestId("chroma-toggle").click();
  await expect(page.getByTestId("chroma-color")).toHaveAttribute("data-color", "#00b140");
  await expect.poll(async () => (await chroma(page))?.similarity).toBeCloseTo(0.15);

  // Gotero: fuera del PiP avisa; dentro toma el color y se cierra.
  await page.getByTestId("chroma-pick").click();
  const layer = page.getByTestId("eyedropper-layer");
  await expect(layer).toBeVisible();
  const lb = (await layer.boundingBox())!;
  await page.mouse.click(lb.x + 4, lb.y + 4);
  await expect(layer).toContainText("Tocá dentro del video");
  const pip = (await page.getByTestId("overlay-box").boundingBox())!;
  await page.mouse.click(pip.x + pip.width / 2, pip.y + pip.height / 2);
  await expect(layer).toHaveCount(0);
  const picked = await page.getByTestId("chroma-color").getAttribute("data-color");
  expect(picked).toMatch(/^#[0-9a-f]{6}$/);
  expect(picked).not.toBe("#00b140");
  await expect.poll(async () => (await chroma(page))?.color).toBe(picked);

  // Esc cancela el gotero sin cambiar nada.
  await page.getByTestId("chroma-pick").click();
  await expect(layer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(layer).toHaveCount(0);
  await expect(page.getByTestId("pip-editor")).toBeVisible();

  // Sliders con el teclado.
  await page.getByTestId("chroma-similarity").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await chroma(page))?.similarity ?? 0).toBeGreaterThan(0.15);
  await page.getByTestId("chroma-smoothness").focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await chroma(page))?.smoothness ?? 1).toBeLessThan(0.08);

  // Deshacer vuelve a la llave anterior; apagar la quita.
  await focusBody(page);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await chroma(page))?.smoothness ?? 1).toBeCloseTo(0.08);
  // Deshacer limpia la selección: se vuelve a elegir el PiP.
  await page.getByTestId("overlay-item").first().click();

  // Apagarla la quita; Ctrl+Z la devuelve.
  await page.getByTestId("chroma-toggle").click();
  await expect.poll(async () => (await chroma(page)) ?? null).toBeNull();
  await expect(page.getByTestId("chroma-pick")).toHaveCount(0);
  await focusBody(page);
  await page.keyboard.press("Control+z");
  await page.getByTestId("overlay-item").first().click();
  await expect(page.getByTestId("chroma-pick")).toBeVisible();

  await page.keyboard.press("Control+e");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  expect(job.project.overlays[0].chroma).toMatchObject({ color: picked, despill: 0.5 });
});
