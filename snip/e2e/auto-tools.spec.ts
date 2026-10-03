import { expect, test } from "@playwright/test";
import { focusBody, open, project, total } from "./helpers";

// Herramientas automáticas sobre el análisis falso del mock (tauriMock.ts):
// video con jugadas en 3 s y 8,5 s y silencios en 5–6,2 s y 10–10,8 s;
// música a 120 BPM.

test("jugadas: marcadores y fragmentos de ±X s", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-audio").click();
  await expect(page.getByTestId("auto-section")).toBeVisible();
  await page.getByTestId("plays-ranges").click();
  await page.getByTestId("plays-run").click();
  await expect(page.getByTestId("plays-count")).toContainText("2 jugadas");
  await expect.poll(async () => (await project(page))?.ranges?.length ?? 0).toBe(2);
  const p = await project(page);
  const plays = p.markers.filter((m: { kind?: string }) => m.kind === "play");
  expect(plays.map((m: { time: number }) => Math.round(m.time))).toEqual([3, 9]);
  expect(plays[0].name).toBe("Jugada 1");
  expect(p.ranges).toHaveLength(2);
  // ±5 s alrededor de cada jugada, recortado al timeline.
  p.ranges.forEach((r: { start: number; end: number }, i: number) => {
    expect(r.start).toBeCloseTo(Math.max(0, plays[i].time - 5), 2);
    expect(r.end).toBeCloseTo(Math.min(12, plays[i].time + 5), 2);
  });
  await expect(page.getByTestId("range-band")).toHaveCount(2);
  // Volver a detectar reemplaza (no duplica); "Quitar" las saca.
  await page.getByTestId("plays-run").click();
  await expect.poll(async () => (await project(page)).markers.filter((m: { kind?: string }) => m.kind === "play").length).toBe(2);
  await page.getByTestId("plays-clear").click();
  await expect(page.getByTestId("plays-count")).toHaveCount(0);
});

test("silencios: ver antes de cortar, cortar y deshacer", async ({ page }) => {
  await open(page);
  const before = await total(page);
  await page.getByTestId("inspector-tab-audio").click();
  await page.getByTestId("silence-find").click();
  await expect(page.getByTestId("silence-band")).toHaveCount(2);
  await expect(page.getByTestId("silence-summary")).toContainText("2 silencios");
  // Todavía no cortó nada.
  expect(await total(page)).toBeCloseTo(before, 2);
  await page.screenshot({ path: "e2e/screenshots/41-silencios.png" });
  // Cancelar saca las bandas.
  await page.getByTestId("silence-cancel").click();
  await expect(page.getByTestId("silence-band")).toHaveCount(0);
  // Más exigente con la duración: solo el silencio largo.
  await page.getByTestId("silence-min").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.getByTestId("silence-find").click();
  await expect(page.getByTestId("silence-band")).toHaveCount(1);
  await page.getByTestId("silence-apply").click();
  await expect(page.getByTestId("silence-band")).toHaveCount(0);
  // 1,2 s de silencio menos 0,15 s de margen de cada lado.
  await expect.poll(() => total(page)).toBeCloseTo(before - 0.9, 1);
  await focusBody(page);
  await page.keyboard.press("Control+z");
  await expect.poll(() => total(page)).toBeCloseTo(before, 2);
});

test("silencios: si el proyecto cambia, la vista previa se descarta", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-audio").click();
  await page.getByTestId("silence-find").click();
  await expect(page.getByTestId("silence-band")).toHaveCount(2);
  await focusBody(page);
  await page.keyboard.press("m");
  await expect(page.getByTestId("silence-band")).toHaveCount(0);
  await expect(page.getByTestId("silence-apply")).toHaveCount(0);
});

test("beats: marcar, rayitas en la regla y el imán los toma", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-audio").click();
  await expect(page.getByTestId("beats-run")).toBeDisabled();
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Music\\tema.mp3"]));
  await page.getByTestId("add-music-inspector").click();
  await expect(page.getByTestId("beats-run")).toBeEnabled();
  await page.getByTestId("beats-run").click();
  await expect(page.getByTestId("beats-count")).toBeVisible();
  await expect.poll(async () => (await project(page))?.markers?.length ?? 0).toBeGreaterThan(15);
  const p = await project(page);
  const beats = p.markers.filter((m: { kind?: string }) => m.kind === "beat").map((m: { time: number }) => m.time);
  expect(beats.length).toBeGreaterThan(15);
  // 120 BPM desde 0,25 s del tema.
  const music = p.music[0];
  for (const b of beats.slice(0, 6)) {
    const src = b - music.start + music.inPoint - 0.25;
    expect(Math.abs(src / 0.5 - Math.round(src / 0.5))).toBeLessThan(0.05);
  }
  await expect(page.getByTestId("beat-marker").first()).toBeAttached();
  // Shift+M no salta por los beats.
  expect(await page.getByTestId("marker").count()).toBe(0);
  await page.getByTestId("beats-clear").click();
  await expect(page.getByTestId("beat-marker")).toHaveCount(0);
});
