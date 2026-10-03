import { expect, test } from "@playwright/test";
import { focusBody, open, project, seek } from "./helpers";

// Tanda 2: imagen del clip (encuadre, zoom/paneo, color, looks, mejoras).
const SHOTS = "e2e/screenshots";

test.describe("imagen del clip", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.getByTestId("inspector-tab-video").click();
    await expect(page.getByTestId("framing")).toBeVisible();
  });

  test("recortar a 9:16 sobre el preview: Enter confirma y deshacer lo saca en un paso", async ({ page }) => {
    const before = await page.getByTestId("preview-canvas").boundingBox();
    await page.getByTestId("aspect-9:16").click();
    await expect(page.getByTestId("crop-editor")).toBeVisible();
    // Mientras se recorta, el preview muestra el cuadro completo (16:9).
    const full = await page.getByTestId("preview-canvas").boundingBox();
    expect(full!.width / full!.height).toBeCloseTo(before!.width / before!.height, 1);
    const rect = page.getByTestId("crop-rect");
    const r0 = (await rect.boundingBox())!;
    expect(r0.width / r0.height).toBeCloseTo(9 / 16, 1);
    // Arrastrar el recuadro hacia la izquierda.
    await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2);
    await page.mouse.down();
    await page.mouse.move(r0.x + r0.width / 2 - 120, r0.y + r0.height / 2, { steps: 6 });
    await page.mouse.up();
    const r1 = (await rect.boundingBox())!;
    expect(r1.x).toBeLessThan(r0.x - 100);
    // La manija de la esquina mantiene la proporción.
    const h = (await page.getByTestId("crop-handle-se").boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x - 60, h.y - 100, { steps: 6 });
    await page.mouse.up();
    const r2 = (await rect.boundingBox())!;
    expect(r2.height).toBeLessThan(r1.height - 40);
    expect(r2.width / r2.height).toBeCloseTo(9 / 16, 1);
    await page.screenshot({ path: `${SHOTS}/20-recorte.png` });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("crop-editor")).toHaveCount(0);
    // El lienzo sigue al primer clip: ahora es vertical.
    const after = (await page.getByTestId("preview-canvas").boundingBox())!;
    expect(after.height).toBeGreaterThan(after.width);
    await expect.poll(async () => (await project(page))?.clips[0].video.crop?.aspect).toBe("9:16");
    await focusBody(page);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await project(page))?.clips[0].video.crop ?? null).toBeNull();
  });

  test("Esc cancela el recorte (también la proporción elegida)", async ({ page }) => {
    await page.getByTestId("aspect-1:1").click();
    await expect(page.getByTestId("crop-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("crop-editor")).toHaveCount(0);
    await expect(page.getByTestId("aspect-original")).toHaveAttribute("aria-checked", "true");
  });

  test("rotar y voltear", async ({ page }) => {
    await page.getByTestId("rotate-right").click();
    const box = (await page.getByTestId("preview-canvas").boundingBox())!;
    expect(box.height).toBeGreaterThan(box.width);
    await page.getByTestId("flip-h").click();
    await expect(page.getByTestId("flip-h")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await project(page))?.clips[0].video).toMatchObject({ rotate: 90, flipH: true });
    await page.getByTestId("rotate-left").click();
    await expect.poll(async () => (await project(page))?.clips[0].video.rotate).toBe(0);
  });

  test("zoom y paneo: keyframes en la lista y en el timeline, ventana arrastrable", async ({ page }) => {
    await page.getByTestId("zoom-kenburns").click();
    await expect(page.getByTestId("zoom-key")).toHaveCount(2);
    await expect(page.getByTestId("tl-zoom-key")).toHaveCount(2);
    await page.getByTestId("zoom-key").last().click();
    await expect(page.getByTestId("zoom-editor")).toBeVisible();
    await expect(page.getByTestId("zoom-key-editor")).toBeVisible();
    const w = (await page.getByTestId("zoom-window").boundingBox())!;
    await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2);
    await page.mouse.down();
    await page.mouse.move(w.x + w.width / 2 + 40, w.y + w.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await project(page))?.clips[0].video.zoom[1].cx).toBeGreaterThan(0.53);
    await page.screenshot({ path: `${SHOTS}/21-zoom-keyframe.png` });
    // Un keyframe nuevo en el playhead.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("zoom-editor")).toHaveCount(0);
    await seek(page, 5);
    await page.getByTestId("zoom-add").click();
    await expect(page.getByTestId("zoom-key")).toHaveCount(3);
    // Mover el rombo del timeline cambia el tiempo del keyframe.
    const d = (await page.getByTestId("tl-zoom-key").nth(1).boundingBox())!;
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
    await page.mouse.down();
    await page.mouse.move(d.x + d.width / 2 + 50, d.y + d.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await project(page))?.clips[0].video.zoom[1].t).toBeGreaterThan(5.3);
    await page.getByTestId("zoom-remove").click();
    await expect(page.getByTestId("zoom-key")).toHaveCount(2);
  });

  test("color: sliders bipolares, doble click vuelve a 0 y restablecer", async ({ page }) => {
    const s = page.getByTestId("color-brightness");
    await s.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Number(await s.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await s.dblclick();
    await expect(s).toHaveAttribute("aria-valuenow", "0");
    await page.getByTestId("color-saturation").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("color-reset")).toBeVisible();
    await page.getByTestId("color-reset").click();
    await expect.poll(async () => (await project(page))?.clips[0].video.color.saturation).toBe(0);
  });

  test("looks con miniaturas del cuadro actual e intensidad", async ({ page }) => {
    const card = page.getByTestId("look-noir");
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("img")).toBeVisible({ timeout: 8_000 });
    await card.click();
    await expect(card).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("look-intensity")).toBeVisible();
    await page.getByTestId("look-intensity").focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await project(page))?.clips[0].video.look).toMatchObject({ id: "noir" });
    await page.screenshot({ path: `${SHOTS}/22-looks.png` });
    await page.getByTestId("look-none").click();
    await expect.poll(async () => (await project(page))?.clips[0].video.look ?? null).toBeNull();
  });

  test("estabilizar procesa en segundo plano con el aviso de vista previa", async ({ page }) => {
    await page.getByTestId("stabilize").scrollIntoViewIfNeeded();
    await page.getByTestId("stabilize").click();
    await expect(page.getByTestId("stabilize-strength")).toBeVisible();
    await expect(page.getByTestId("preparing-chip")).toContainText("Estabilizando", { timeout: 5_000 });
    await expect.poll(() => page.evaluate(() => window.__snipMock.calls.filter((c) => c.cmd === "prepare_clip").length)).toBeGreaterThan(0);
  });
});
