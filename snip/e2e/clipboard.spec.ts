import { expect, test, type Page } from "@playwright/test";
import { focusBody, open, seek } from "./helpers";

const project = (page: Page) => page.evaluate(() => window.__snipTest.project());

// Copiar / cortar / pegar / duplicar / agrupar y pegar desde Windows.

async function pasteEvent(page: Page, data: { text?: string; png?: boolean }) {
  await page.evaluate(async ({ text, png }) => {
    const dt = new DataTransfer();
    if (text) dt.setData("text/plain", text);
    if (png) {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 32;
      c.getContext("2d")!.fillRect(0, 0, 64, 32);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
      dt.items.add(new File([blob], "captura.png", { type: "image/png" }));
    }
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

test("copiar, pegar en el playhead, duplicar, cortar y deshacer", async ({ page }) => {
  await open(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  // Dos clips: dividir en 4 s.
  await seek(page, 4);
  await page.keyboard.press("s");
  await expect(page.getByTestId("clip")).toHaveCount(2);
  await page.getByTestId("clip").first().click();
  await page.keyboard.press("Control+c");
  await expect(page.getByTestId("toast-info")).toContainText("Copiado");

  // Pegar en 8 s: divide el segundo clip y mete la copia (4 s) en el medio.
  await seek(page, 8);
  await page.keyboard.press("Control+v");
  await expect(page.getByTestId("clip")).toHaveCount(4);
  await expect(page.getByTestId("total-tc")).toContainText("00:00:16:00");
  let p = (await project(page))!;
  expect(p.clips[2].inPoint).toBe(0);
  expect(p.clips[2].outPoint).toBeCloseTo(4, 2);

  // Ctrl+D duplica la selección (el pegado) a continuación.
  await focusBody(page);
  await page.keyboard.press("Control+d");
  await expect(page.getByTestId("clip")).toHaveCount(5);
  await expect(page.getByTestId("total-tc")).toContainText("00:00:20:00");

  // Cortar saca el duplicado; deshacer lo devuelve.
  await page.keyboard.press("Control+x");
  await expect(page.getByTestId("clip")).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("clip")).toHaveCount(5);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("clip")).toHaveCount(2);
  p = (await project(page))!;
  expect(p.clips).toHaveLength(2);
});

test("pegar efectos, menú contextual y agrupar capas", async ({ page }) => {
  await open(page);
  await seek(page, 6);
  await page.keyboard.press("s");
  // Color y velocidad en el primer clip (por el modelo, como haría el inspector).
  await page.getByTestId("clip").first().click();
  await page.evaluate(() =>
    window.__snipTest.editJson(
      "(p) => ({ ...p, clips: [{ ...p.clips[0], speed: 2, video: { ...p.clips[0].video, color: { ...p.clips[0].video.color, saturation: 0.6 } } }, ...p.clips.slice(1)] })",
    ),
  );
  await page.getByTestId("clip").first().click();
  await page.keyboard.press("Control+c");
  // Clic derecho en el segundo: menú con "Pegar efectos".
  await page.getByTestId("clip").nth(1).click({ button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/a3-menu-contextual.png" });
  await page.getByTestId("menu-paste-effects").click();
  await expect(page.getByTestId("toast-success")).toContainText("Efectos pegados");
  let p = (await project(page))!;
  expect(p.clips[1].speed).toBe(2);
  expect(p.clips[1].video.color.saturation).toBe(0.6);

  // Dos textos → Ctrl+G: elegir uno elige los dos; moverlos juntos.
  await focusBody(page);
  await page.evaluate(() => window.__snipTest.addText(1));
  await page.evaluate(() => window.__snipTest.addText(3));
  await expect(page.getByTestId("overlay-item")).toHaveCount(2);
  await page.evaluate(() => window.__snipTest.selectAll("overlays"));
  await focusBody(page);
  await page.keyboard.press("Control+g");
  await expect(page.getByTestId("toast-info").filter({ hasText: "Agrupado" })).toBeVisible();
  p = (await project(page))!;
  expect(p.groups).toHaveLength(1);
  await page.evaluate(() => window.__snipTest.select([]));
  await page.getByTestId("overlay-item").first().click();
  await expect(page.locator(".tl-overlay.is-selected")).toHaveCount(2);
  const before = (await project(page))!.overlays.map((o) => o.start);
  const box = (await page.getByTestId("overlay-item").first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = (await project(page))!.overlays.map((o) => o.start);
  const d0 = after[0] - before[0];
  expect(d0).toBeGreaterThan(0.2);
  expect(after[1] - before[1]).toBeCloseTo(d0, 3);
  // Desagrupar desde el menú.
  await page.getByTestId("overlay-item").first().click({ button: "right" });
  await page.getByTestId("menu-ungroup").click();
  p = (await project(page))!;
  expect(p.groups ?? []).toHaveLength(0);
});

test("pegar desde Windows: captura, texto y archivos del Explorador", async ({ page }) => {
  await open(page);
  await seek(page, 2);
  // Captura (Win+Shift+S) → capa de imagen en el playhead.
  await pasteEvent(page, { png: true });
  await expect(page.getByTestId("overlay-item")).toHaveCount(1);
  let p = (await project(page))!;
  const img = p.overlays[0];
  expect(img.type).toBe("image");
  expect(img.start).toBeCloseTo(2, 1);
  expect(p.media.some((m) => /imagen-pegada-1\.png$/.test(m.path))).toBe(true);

  // Texto → capa de texto.
  await seek(page, 5);
  await pasteEvent(page, { text: "¡Qué jugada!" });
  await expect(page.getByTestId("overlay-item")).toHaveCount(2);
  p = (await project(page))!;
  const txt = p.overlays.find((o) => o.type === "text")!;
  expect(txt.type === "text" && txt.text).toBe("¡Qué jugada!");

  // Archivos copiados en el Explorador: video → pista principal, audio → pista de audio, imagen → capa.
  await page.evaluate(() => {
    window.__snipMock.clipboardFiles = ["C:\\Users\\Bruno\\Videos\\Otro 8s.mp4", "C:\\Users\\Bruno\\Music\\tema.mp3", "C:\\Users\\Bruno\\Pictures\\logo.png"];
  });
  await seek(page, 12);
  await pasteEvent(page, {});
  await expect(page.getByTestId("clip")).toHaveCount(2);
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  await expect(page.getByTestId("overlay-item")).toHaveCount(3);
  p = (await project(page))!;
  expect(p.music[0].start).toBeCloseTo(12, 1);

  // Mientras se escribe en un campo, Ctrl+V pega texto ahí (no en el timeline).
  await page.evaluate(() => (window.__snipMock.clipboardFiles = []));
  await page.getByTestId("inspector-tab-text").click();
  const n = (await project(page))!.overlays.length;
  const input = page.locator("textarea, input[type='text']").first();
  if (await input.isVisible()) {
    await input.focus();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "x");
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    expect((await project(page))!.overlays.length).toBe(n);
  }
});
