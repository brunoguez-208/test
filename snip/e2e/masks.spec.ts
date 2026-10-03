import { expect, test, type Page } from "@playwright/test";
import { focusBody, open, openQueue, project, seek } from "./helpers";

// Máscaras del PiP: forma, borde suave, invertir, acomodarla en la vista previa
// y animarla con keyframes (la cámara en un círculo que sigue a la cara).

type Mask = { shape: string; rect: { x: number; y: number; w: number; h: number }; feather: number; invert: boolean; keys: { t: number }[] };
const mask = async (page: Page) => ((await project(page))?.overlays[0] as { mask?: Mask | null } | undefined)?.mask ?? null;

test("máscara: círculo, borde, invertir, mover en la vista previa y keyframes", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-video").click();
  await seek(page, 1);
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\camara 8s.mp4"]));
  await page.getByTestId("add-pip").click();
  await expect(page.getByTestId("pip-editor")).toBeVisible();
  await expect(page.getByTestId("pip-shadow")).toBeVisible();

  // Círculo: queda redondo en píxeles aunque el PiP sea 16:9, y la sombra se va.
  await page.getByTestId("mask-shape").getByRole("radio", { name: "Círculo" }).click();
  await expect.poll(async () => (await mask(page))?.shape).toBe("circle");
  const m0 = (await mask(page))!;
  expect(m0.rect.h).toBeGreaterThan(m0.rect.w);
  await expect(page.getByTestId("pip-shadow")).toHaveCount(0);
  await expect(page.getByTestId("mask-editor")).toBeVisible();

  // Mover la máscara dentro del PiP.
  const r = (await page.getByTestId("mask-rect").boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 - 30, r.y + r.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await mask(page))!.rect.x).toBeLessThan(m0.rect.x - 0.02);

  // Borde, invertir y forma redondeada (conserva el rectángulo).
  await page.getByTestId("mask-feather").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await mask(page))!.feather).toBeGreaterThan(0.15);
  await page.getByTestId("mask-invert").click();
  await expect.poll(async () => (await mask(page))!.invert).toBe(true);
  const before = (await mask(page))!.rect;
  await page.getByTestId("mask-shape").getByRole("radio", { name: "Redond." }).click();
  await expect(page.getByTestId("mask-radius")).toBeVisible();
  await expect.poll(async () => (await mask(page))!.rect).toEqual(before);

  // Keyframes: uno en 1 s, otro en 2,5 s con la máscara en otro lugar.
  await page.getByTestId("mask-track").click();
  await expect(page.getByTestId("mask-keys")).toContainText("1 keyframe");
  await seek(page, 2.5);
  await expect(page.getByTestId("current-tc")).toHaveValue("00:00:02:15");
  await page.getByTestId("overlay-item").first().click();
  await expect(page.getByTestId("mask-section")).toBeVisible();
  if (!(await page.getByTestId("mask-editor").isVisible())) await page.getByTestId("mask-edit").click();
  const h = (await page.getByTestId("mask-handle-se").boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 20, h.y - 15, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("mask-keys")).toContainText("2 keyframes");
  await page.screenshot({ path: "e2e/screenshots/40-mascara.png" });

  // "No" la quita y vuelve la sombra; Ctrl+Z la devuelve.
  await page.getByTestId("mask-shape").getByRole("radio", { name: "No" }).click();
  await expect.poll(() => mask(page)).toBeNull();
  await expect(page.getByTestId("pip-shadow")).toBeVisible();
  await focusBody(page);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await mask(page))?.shape).toBe("rounded");

  // Exportar lleva la máscara.
  await focusBody(page);
  await page.keyboard.press("Control+e");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  const jm = (job.project.overlays[0] as { mask?: Mask | null }).mask;
  expect(jm).toMatchObject({ shape: "rounded", invert: true });
  expect(jm?.keys).toHaveLength(2);
  // Raster: la máscara con keyframes viaja como secuencia.
  expect(job.raster?.pips?.[job.project.overlays[0].id]?.mask).toMatch(/pipmask0\.ffconcat$/);
});
