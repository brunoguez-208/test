import { expect, test } from "@playwright/test";
import { focusBody, open, openQueue, project, seek } from "./helpers";

// Efectos de un clic: se agregan en el playhead como bloques de la pista de
// capas, con intensidad y duración, y viajan en la exportación.

type Fx = { type: "effect"; kind: string; intensity: number; start: number; duration: number };
const effects = async (page: import("@playwright/test").Page) => ((await project(page))?.overlays ?? []).filter((o: { type: string }) => o.type === "effect") as Fx[];

test("efectos: los cinco presets, intensidad, duración, borrar y exportar", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-video").click();
  await seek(page, 1);
  for (const kind of ["shake", "zoomPunch", "flash", "glitch", "vignette"]) {
    await page.getByTestId(`add-effect-${kind}`).click();
    await expect(page.getByTestId("effect-editor")).toBeVisible();
  }
  await expect(page.getByTestId("overlay-item")).toHaveCount(5);
  await expect(page.locator('[data-testid="overlay-item"][aria-label="Efecto: Temblor"]')).toHaveCount(1);
  await expect.poll(async () => (await effects(page)).map((e) => e.kind).sort()).toEqual(["flash", "glitch", "shake", "vignette", "zoomPunch"]);
  const fx = await effects(page);
  expect(fx.every((e) => Math.abs(e.start - 1) < 0.05)).toBe(true);
  expect(fx.find((e) => e.kind === "vignette")!.duration).toBeCloseTo(3);
  // El último agregado (viñeta) queda elegido.
  await expect(page.getByTestId("effect-name")).toHaveText("Viñeta");

  // Intensidad y duración con el teclado.
  await page.getByTestId("effect-intensity").focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(async () => (await effects(page)).find((e) => e.kind === "vignette")!.intensity).toBeCloseTo(0.05);
  await page.getByTestId("effect-duration").focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(async () => (await effects(page)).find((e) => e.kind === "vignette")!.duration).toBeCloseTo(0.2);

  // Elegir otro desde la pista de capas.
  await page.locator('[data-testid="overlay-item"][aria-label="Efecto: Flash"]').click();
  await expect(page.getByTestId("effect-name")).toHaveText("Flash");
  await page.getByTestId("effect-delete").click();
  await expect(page.getByTestId("overlay-item")).toHaveCount(4);
  await focusBody(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("overlay-item")).toHaveCount(5);

  await page.keyboard.press("Control+e");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  expect(job.project.overlays.filter((o: { type: string }) => o.type === "effect")).toHaveLength(5);
});
