import { expect, test } from "@playwright/test";
import { focusBody, open, openQueue, project, seek } from "./helpers";

// Tanda 2: textos y títulos, subtítulos .srt y logo / marca de agua.
const SHOTS = "e2e/screenshots";

test.describe("textos", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test("agregar un texto, escribirlo, moverlo y agrandarlo sobre el preview", async ({ page }) => {
    await seek(page, 2);
    await page.getByTestId("add-text").click();
    const area = page.getByTestId("text-content");
    await expect(area).toBeFocused();
    await page.keyboard.type("Hola Snip");
    await focusBody(page);
    await expect(page.getByTestId("overlay-item")).toContainText("Hola Snip");
    await expect.poll(async () => (await project(page))?.overlays[0]).toMatchObject({ type: "text", text: "Hola Snip", start: 2 });
    // Escribir es un solo paso de deshacer.
    const box = (await page.getByTestId("overlay-box").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 + 90, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => ((await project(page))!.overlays[0] as { x: number }).x).toBeLessThan(0.4);
    expect(((await project(page))!.overlays[0] as { y: number }).y).toBeGreaterThan(0.6);
    const size0 = ((await project(page))!.overlays[0] as { style: { size: number } }).style.size;
    const h = (await page.getByTestId("overlay-scale").boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 60, h.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => ((await project(page))!.overlays[0] as { style: { size: number } }).style.size).toBeGreaterThan(size0 * 1.1);
    await page.screenshot({ path: `${SHOTS}/23-texto.png` });
    await focusBody(page);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => ((await project(page))!.overlays[0] as { x: number }).x).toBeCloseTo(0.5, 2);
  });

  test("plantillas, estilo y animaciones", async ({ page }) => {
    await page.getByTestId("inspector-tab-text").click();
    await page.getByTestId("template-impact").click();
    await expect(page.getByTestId("overlay-item")).toHaveCount(1);
    await focusBody(page);
    await page.getByTestId("text-bold").click();
    await page.getByTestId("text-italic").click();
    await page.getByTestId("text-background").click();
    await page.getByTestId("text-anim-in").click();
    await page.getByRole("option", { name: "Máquina de escribir" }).click();
    await page.getByTestId("text-color").locator("input").evaluate((el: HTMLInputElement) => {
      // Setter nativo: así React ve el cambio.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "#ff3366");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(async () => (await project(page))?.overlays[0]).toMatchObject({
      animIn: { kind: "typewriter" },
      style: { italic: true, color: "#ff3366", background: { color: "#000000" } },
    });
    // Otro texto que se superpone en el tiempo va a otra fila.
    await page.getByTestId("template-label").click();
    await expect.poll(async () => (await project(page))?.overlays.map((o) => o.lane)).toEqual([0, 1]);
    await page.getByTestId("text-delete").click();
    await expect(page.getByTestId("overlay-item")).toHaveCount(1);
  });

  test("mover y recortar una capa en el timeline", async ({ page }) => {
    await page.getByTestId("add-text").click();
    await expect(page.getByTestId("text-content")).toBeFocused();
    await focusBody(page);
    const item = page.getByTestId("overlay-item");
    const b = (await item.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await project(page))?.overlays[0].start).toBeGreaterThan(1);
    expect((await project(page))!.overlays[0].lane).toBe(1);
    const t = (await page.getByTestId("overlay-trim-out").boundingBox())!;
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 80, t.y + t.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await project(page))?.overlays[0].duration).toBeGreaterThan(3.3);
  });

  test("click en el texto del preview lo selecciona", async ({ page }) => {
    await seek(page, 1);
    await page.getByTestId("add-text").click();
    await expect(page.getByTestId("text-content")).toBeFocused();
    await focusBody(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("overlay-editor")).toHaveCount(0);
    await page.getByTestId("inspector-tab-clip").click();
    const c = (await page.getByTestId("preview-canvas").boundingBox())!;
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
    await expect(page.getByTestId("overlay-editor")).toBeVisible();
    await expect(page.getByTestId("inspector-tab-text")).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("subtítulos", () => {
  test("importar .srt, editar, guardar y palabra por palabra", async ({ page }) => {
    await open(page);
    await page.getByTestId("inspector-tab-text").click();
    await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\Clip de prueba.srt"]));
    await page.getByTestId("srt-import").click();
    await expect(page.getByTestId("cue-row")).toHaveCount(2);
    await expect(page.getByTestId("cue-item")).toHaveCount(2);
    await page.getByTestId("cue-text").first().fill("Hola, ¿cómo andás?");
    await focusBody(page);
    await expect.poll(async () => (await project(page))?.subtitles.cues[0].text).toBe("Hola, ¿cómo andás?");
    // Editar el fin escribiendo el tiempo.
    const end = page.getByRole("textbox", { name: "Fin del subtítulo" }).first();
    await end.fill("0:01,8");
    await end.press("Enter");
    await expect.poll(async () => (await project(page))?.subtitles.cues[0].end).toBeCloseTo(1.8, 5);
    await page.getByTestId("sub-uppercase").click();
    await page.getByTestId("word-by-word").click();
    await expect(page.getByTestId("sub-highlight")).toBeVisible();
    await seek(page, 1);
    await page.screenshot({ path: `${SHOTS}/24-subtitulos.png` });
    await page.evaluate(() => (window.__snipMock.dialogSavePath = "C:\\Users\\Bruno\\Videos\\clip.srt"));
    await page.getByTestId("srt-export").click();
    await expect.poll(() => page.evaluate(() => window.__snipMock.calls.find((c) => c.cmd === "write_subtitles")?.args as { text: string } | undefined)).toMatchObject({
      text: expect.stringContaining("00:00:00,500 --> 00:00:01,800\nHola, ¿cómo andás?"),
    });
    await page.getByTestId("cue-delete").first().click();
    await expect(page.getByTestId("cue-row")).toHaveCount(1);
    // Importar de nuevo pregunta si reemplazar o sumar.
    await page.getByTestId("srt-import").click();
    await page.getByRole("button", { name: "Sumar" }).click();
    await expect(page.getByTestId("cue-row")).toHaveCount(3);
  });
});

test.describe("logo y exportación con capas", () => {
  test("agregar un logo, ubicarlo y exportar con textos y subtítulos", async ({ page }) => {
    await open(page);
    await page.getByTestId("inspector-tab-video").click();
    await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Pictures\\logo.png"]));
    await page.getByTestId("add-logo").click();
    await expect(page.getByTestId("image-editor")).toBeVisible();
    await expect(page.getByTestId("overlay-item")).toContainText("logo.png");
    await page.getByTestId("image-place-bl").click();
    await page.getByTestId("image-shadow").click();
    await expect.poll(async () => (await project(page))?.overlays[0]).toMatchObject({ type: "image", shadow: true, start: 0, duration: 12 });
    await expect.poll(async () => ((await project(page))!.overlays[0] as { x: number }).x).toBeLessThan(0.2);
    expect(((await project(page))!.overlays[0] as { y: number }).y).toBeGreaterThan(0.8);
    await page.screenshot({ path: `${SHOTS}/25-logo.png` });
    await page.getByTestId("add-text").click();
    await expect(page.getByTestId("text-content")).toBeFocused();
    await focusBody(page);
    await page.keyboard.press("Control+e");
    await openQueue(page);
    await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
    const job = await page.evaluate(() => window.__snipMock.jobs[0]);
    expect(job.raster?.decor).toMatch(/decor\.ffconcat$/);
    const r = await page.evaluate(() => Object.values(window.__snipMock.raster)[0]);
    expect(r.files.length).toBeGreaterThan(5);
    expect(r.lists["decor.ffconcat"]).toMatch(/^ffconcat version 1\.0\nfile 'f00001\.png'\nduration /);
  });
});
