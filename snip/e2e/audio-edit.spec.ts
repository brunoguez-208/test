import { expect, test, type Page } from "@playwright/test";
import { focusBody, open, seek } from "./helpers";

// Edición de audio: separar / unir, dividir y mover audio, curva de volumen,
// pistas (silenciar, solo, volumen, nombre) y "Mejorar voz".
const project = (page: Page) => page.evaluate(() => window.__snipTest.project());

test("separar el audio, editarlo en su pista y volver a unirlo", async ({ page }) => {
  await open(page);
  await page.getByTestId("clip").first().click({ button: "right" });
  await page.getByTestId("menu-separate-audio").click();
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  let p = (await project(page))!;
  expect(p.clips[0].audio.detached).toBe(true);
  expect(p.music[0]).toMatchObject({ start: 0, inPoint: 0, outPoint: 12, linkedClip: p.clips[0].id });

  // S con el audio elegido divide el audio (no el video).
  await seek(page, 5);
  await page.getByTestId("music-clip").click();
  await focusBody(page);
  await page.keyboard.press("s");
  await expect(page.getByTestId("music-clip")).toHaveCount(2);
  await expect(page.getByTestId("clip")).toHaveCount(1);

  // Mover el segundo tramo a otra pista arrastrando hacia abajo.
  const second = page.getByTestId("music-clip").nth(1);
  const b = (await second.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 34, { steps: 6 });
  await page.mouse.up();
  p = (await project(page))!;
  expect(p.music.map((m) => m.track ?? 0).sort()).toEqual([0, 1]);
  await expect(page.getByTestId("track-header-audio-1")).toBeVisible();

  // Deshacer todo hasta antes de mover, y unir desde el menú del primer tramo.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  await page.getByTestId("music-clip").click({ button: "right" });
  await page.getByTestId("menu-join-audio").click();
  await expect(page.getByTestId("music-clip")).toHaveCount(0);
  p = (await project(page))!;
  expect(p.clips[0].audio.detached).toBe(false);
});

test("curva de volumen, pistas y Mejorar voz", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Music\\tema.mp3"]));
  await page.getByTestId("add-music").click();
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  const clip = page.getByTestId("music-clip");
  await clip.click();
  // Doble clic arriba a la izquierda (volumen alto) y abajo a la derecha (bajo),
  // dentro de la parte visible del audio (dura más que el video).
  const box = (await clip.boundingBox())!;
  const area = (await page.getByTestId("timeline-area").boundingBox())!;
  const x0 = Math.max(box.x, area.x);
  const x1 = Math.min(box.x + box.width, area.x + area.width);
  await page.mouse.dblclick(x0 + (x1 - x0) * 0.2, box.y + 4);
  await page.mouse.dblclick(x0 + (x1 - x0) * 0.6, box.y + box.height - 4);
  await expect(page.getByTestId("volume-key")).toHaveCount(2);
  let p = (await project(page))!;
  const keys = p.music[0].volumeKeys!;
  expect(keys[0].v).toBeGreaterThan(1.5);
  await expect(page.getByTestId("volume-keys-count")).toHaveText("2 puntos");
  await page.screenshot({ path: "e2e/screenshots/a5-curva-volumen.png" });
  // Doble clic en un punto lo borra.
  await page.getByTestId("volume-key").first().dblclick();
  await expect(page.getByTestId("volume-key")).toHaveCount(1);

  // Pistas: solo en la música → el audio del video queda apagado; silenciar.
  await page.getByTestId("track-solo-audio-0").click();
  p = (await project(page))!;
  expect(p.tracks!.audio![0].solo).toBe(true);
  await page.getByTestId("track-mute-video-audio").click();
  p = (await project(page))!;
  expect(p.tracks!.videoAudio!.muted).toBe(true);
  // Nombre y volumen de la pista desde la pestaña Audio.
  await page.getByTestId("inspector-tab-audio").click();
  await page.getByTestId("track-name-audio-0").fill("Música de fondo");
  const vol = page.getByTestId("track-volume-audio-0");
  await vol.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
  p = (await project(page))!;
  expect(p.tracks!.audio![0].name).toBe("Música de fondo");
  expect(p.tracks!.audio![0].volume).toBeLessThan(1);

  // Mejorar voz con un clic: se aplica y mide el nivel; la intensidad se ajusta.
  await page.getByTestId("music-clip").click();
  await page.getByTestId("voice-toggle").click();
  await expect(page.getByTestId("voice-amount")).toBeVisible();
  await expect.poll(async () => (await project(page))!.music[0].enhance?.loudness?.inputI).toBe(-23.4);
  await page.getByTestId("voice-amount").focus();
  await page.keyboard.press("ArrowRight");
  p = (await project(page))!;
  expect(p.music[0].enhance!.amount).toBeCloseTo(0.65, 5);
  await expect(page.locator(".tl-badge")).toHaveText("VOZ");
  await page.screenshot({ path: "e2e/screenshots/a5-pistas-audio.png" });

  // Exportar lleva todo en el proyecto.
  await focusBody(page);
  await page.keyboard.press("Control+e");
  await expect.poll(() => page.evaluate(() => window.__snipMock.jobs.length), { timeout: 10_000 }).toBe(1);
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  expect(job.project.music[0].volumeKeys).toHaveLength(1);
  expect(job.project.tracks?.audio?.[0]?.solo).toBe(true);
});
