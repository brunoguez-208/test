import { expect, test } from "@playwright/test";
import { focusBody, open, openQueue, project, seek } from "./helpers";

// Tanda 2: zonas desenfocadas / pixeladas (con seguimiento) y picture-in-picture.
const SHOTS = "e2e/screenshots";

type Blur = { type: "blur"; mode: string; strength: number; rect: { x: number; y: number; w: number; h: number }; keys: { t: number }[] };

test.describe("zonas y PiP", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.getByTestId("inspector-tab-video").click();
  });

  test("desenfocar una zona, moverla, agrandarla y seguir algo con keyframes", async ({ page }) => {
    await seek(page, 1);
    await page.getByTestId("add-blur").click();
    await expect(page.getByTestId("blur-editor")).toBeVisible();
    await expect(page.getByTestId("overlay-item")).toContainText("Desenfoque");
    const rect = page.getByTestId("zone-rect");
    const r0 = (await rect.boundingBox())!;
    await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2);
    await page.mouse.down();
    await page.mouse.move(r0.x + r0.width / 2 - 100, r0.y + r0.height / 2 - 50, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => ((await project(page))!.overlays[0] as Blur).rect.x).toBeLessThan(0.3);
    const h = (await page.getByTestId("zone-handle-se").boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 80, h.y + 60, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => ((await project(page))!.overlays[0] as Blur).rect.w).toBeGreaterThan(0.35);
    await page.getByTestId("blur-mode").getByText("Pixelar").click();
    await expect.poll(async () => ((await project(page))!.overlays[0] as Blur).mode).toBe("pixelate");
    // Seguimiento: keyframe acá, otro más adelante con la zona en otro lugar.
    await page.getByTestId("blur-track").click();
    await expect(page.getByTestId("blur-keys")).toContainText("1 keyframe");
    await seek(page, 3);
    const r1 = (await rect.boundingBox())!;
    await page.mouse.move(r1.x + r1.width / 2, r1.y + r1.height / 2);
    await page.mouse.down();
    await page.mouse.move(r1.x + r1.width / 2 + 150, r1.y + r1.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("blur-keys")).toContainText("2 keyframes");
    await page.screenshot({ path: `${SHOTS}/28-zona.png` });
    await page.getByTestId("blur-untrack").click();
    await expect(page.getByTestId("blur-track")).toBeVisible();
    await page.getByTestId("zone-delete").click();
    await expect(page.getByTestId("overlay-item")).toHaveCount(0);
  });

  test("picture-in-picture: agregar, mover, ajustar y exportar con sus capas", async ({ page }) => {
    await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\camara 8s.mp4"]));
    await page.getByTestId("add-pip").click();
    await expect(page.getByTestId("pip-editor")).toBeVisible();
    await expect(page.getByTestId("overlay-item")).toContainText("camara 8s.mp4");
    await expect.poll(async () => (await project(page))?.overlays[0]).toMatchObject({ type: "video", duration: 8, shadow: true, volume: 0 });
    const box = (await page.getByTestId("overlay-box").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2 - 150, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => ((await project(page))!.overlays[0] as { x: number }).x).toBeLessThan(0.6);
    await page.getByTestId("pip-volume").focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await expect.poll(async () => ((await project(page))!.overlays[0] as { volume: number }).volume).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/29-pip.png` });
    // Exportar con una zona también: la app manda las máscaras y la sombra.
    await page.getByTestId("add-pixelate").click();
    await focusBody(page);
    await page.keyboard.press("Control+e");
    await openQueue(page);
    await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
    const job = await page.evaluate(() => window.__snipMock.jobs[0]);
    const pipId = job.project.overlays.find((o) => o.type === "video")!.id;
    const blurId = job.project.overlays.find((o) => o.type === "blur")!.id;
    expect(job.raster?.pips?.[pipId]).toMatchObject({ mask: expect.stringMatching(/pipmask0\.png$/), shadow: expect.stringMatching(/pipshadow0\.png$/) });
    expect(job.raster?.masks?.[blurId]).toMatch(/blur0\.ffconcat$/);
    const r = await page.evaluate(() => Object.values(window.__snipMock.raster)[0]);
    expect(r.files).toEqual(expect.arrayContaining(["pipmask0.png", "pipshadow0.png"]));
  });
});
