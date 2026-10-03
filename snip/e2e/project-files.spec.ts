import { expect, test, type Page } from "@playwright/test";
import { focusBody, open, openQueue, seek } from "./helpers";

// Proyecto .snip desde Exportar, Guardar como, versiones, empaquetar y plantillas.
const project = (page: Page) => page.evaluate(() => window.__snipTest.project());

async function menu(page: Page, id: string) {
  await page.getByTestId("project-menu").click();
  await page.getByTestId(id).click();
}

test("Exportar como Proyecto Snip guarda el .snip al instante", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-export").click();
  await page.getByTestId("format").getByRole("radio", { name: "Proyecto" }).click();
  await expect(page.getByTestId("mode-caption")).toContainText("guarda solo el proyecto");
  await expect(page.getByTestId("export-summary")).toContainText(".snip");
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("toast-success")).toContainText("Proyecto guardado");
  const snips = await page.evaluate(() => Object.keys(window.__snipMock.snips));
  expect(snips.some((s) => s.endsWith(".snip"))).toBe(true);
  // No pasó por la cola de exportación.
  expect(await page.evaluate(() => window.__snipMock.jobs.length)).toBe(0);
  await expect(page.getByTestId("tab")).toHaveAttribute("data-dirty", "false");
});

test("Guardar como, versiones (restaurar se deshace) y versión automática al exportar", async ({ page }) => {
  await open(page);
  // Guardar como… desde el menú y con Ctrl+Shift+S.
  await page.evaluate(() => (window.__snipMock.dialogSavePath = "C:\\Users\\Bruno\\Documents\\copia.snip"));
  await menu(page, "menu-save-as");
  await expect(page.getByTestId("toast-success")).toContainText("copia.snip");

  // Versión manual con nombre.
  await menu(page, "menu-save-version");
  await page.getByTestId("version-name").fill("Antes de cortar");
  await page.getByTestId("dialog-primary").click();
  await expect(page.getByTestId("toast-success").filter({ hasText: "Versión guardada" })).toBeVisible();

  // Cambios: dividir y borrar.
  await seek(page, 4);
  await page.keyboard.press("s");
  await page.getByTestId("clip").first().click();
  await focusBody(page);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("total-tc")).toContainText("00:00:08:00");

  // Exportar deja una versión automática.
  await page.keyboard.press("Control+e");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  await menu(page, "menu-versions");
  await expect(page.getByTestId("version-row")).toHaveCount(2);
  await expect(page.getByTestId("version-row").first()).toContainText("Exportación MP4");
  await expect(page.getByTestId("version-row").nth(1)).toContainText("Antes de cortar");
  await page.screenshot({ path: "e2e/screenshots/a7-versiones.png" });
  // Restaurar la manual: vuelve a 12 s; Ctrl+Z vuelve a 8 s; las versiones siguen.
  await page.getByTestId("version-restore").nth(1).click();
  await expect(page.getByTestId("total-tc")).toContainText("00:00:12:00");
  await expect(page.locator("[data-modal='true']")).toHaveCount(0);
  await focusBody(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("total-tc")).toContainText("00:00:08:00");
  expect(await page.evaluate(() => window.__snipMock.versions.length)).toBe(2);
});

test("empaquetar en carpeta y en ZIP", async ({ page }) => {
  await open(page);
  await menu(page, "menu-package-folder");
  await expect(page.getByTestId("toast-success").filter({ hasText: "Proyecto empaquetado" })).toBeVisible();
  await page.evaluate(() => (window.__snipMock.dialogSavePath = "C:\\Users\\Bruno\\Desktop\\viaje.zip"));
  await menu(page, "menu-package-zip");
  await expect.poll(() => page.evaluate(() => window.__snipMock.packages.length)).toBe(2);
  const pk = await page.evaluate(() => window.__snipMock.packages);
  expect(pk[0]).toMatchObject({ dest: "C:\\Users\\Bruno\\Documents", zip: false, media: 1 });
  expect(pk[1]).toMatchObject({ dest: "C:\\Users\\Bruno\\Desktop\\viaje.zip", zip: true });
});

test("guardar como plantilla y arrancar un proyecto nuevo desde la bienvenida", async ({ page }) => {
  await open(page);
  // Intro (el clip abierto) + contenido + outro, un texto y exportación WebM.
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\Outro 3s.mp4"]));
  await page.getByTestId("add-videos").click();
  await expect(page.getByTestId("clip")).toHaveCount(2);
  await page.evaluate(() => window.__snipTest.addText(1));
  await page.evaluate(() => window.__snipTest.editJson("(p) => ({ ...p, export: { ...p.export, format: 'webm' } })"));
  await menu(page, "menu-save-template");
  await page.getByTestId("template-name").fill("Mi canal");
  await page.getByTestId("dialog-primary").click();
  await expect(page.getByTestId("toast-success").filter({ hasText: "Plantilla guardada" })).toBeVisible();

  // Pantalla de bienvenida (nueva ventana del mismo estado): "Nuevo desde plantilla".
  await page.getByTestId("tab-close").click();
  const confirm = page.getByRole("button", { name: "No guardar" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByTestId("welcome")).toBeVisible();
  await page.getByTestId("welcome-template").click();
  await expect(page.getByTestId("template-row")).toHaveCount(1);
  await expect(page.getByTestId("template-row")).toContainText("intro · outro · 1 texto · exporta WEBM");
  await page.screenshot({ path: "e2e/screenshots/a7-plantillas.png" });
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\Partida 20s.mp4"]));
  await page.getByTestId("template-use").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("clip")).toHaveCount(3);
  const p = (await project(page))!;
  expect(p.media.find((m) => m.id === p.clips[1].mediaId)!.path).toContain("Partida 20s");
  expect(p.overlays).toHaveLength(1);
  expect(p.export.format).toBe("webm");
});
