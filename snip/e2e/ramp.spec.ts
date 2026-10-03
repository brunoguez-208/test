import { expect, test } from "@playwright/test";
import { focusBody, open, openQueue, total } from "./helpers";

// Rampas de velocidad: presets de un clic, puntos en la curva, audio y
// exportación con la rampa.

test("rampa: preset, puntos, audio, deshacer y exportar", async ({ page }) => {
  await open(page, "&heavyMs=300");
  const before = await total(page);
  await page.getByTestId("clip").first().click();
  await page.getByTestId("inspector-tab-clip").click();
  await expect(page.getByTestId("ramp-editor")).toBeVisible();
  await expect(page.getByTestId("ramp-curve")).toHaveCount(0);

  // Cámara lenta en el medio: 4 puntos, el clip se alarga, se procesa aparte.
  await page.getByTestId("ramp-slowmo-middle").click();
  await expect(page.getByTestId("ramp-key")).toHaveCount(4);
  await expect(page.getByTestId("speed-slider")).toHaveCount(0);
  await expect(page.getByTestId("ramp-badge")).toBeVisible();
  await expect.poll(() => total(page)).toBeGreaterThan(before * 1.5);
  await expect.poll(() => page.evaluate(() => window.__snipMock.calls.some((c) => c.cmd === "prepare_clip"))).toBe(true);

  // Doble clic en la curva agrega un punto; arrastrarlo cambia la velocidad.
  const box = (await page.getByTestId("ramp-curve").boundingBox())!;
  await page.mouse.dblclick(box.x + box.width * 0.15, box.y + box.height * 0.5);
  await expect(page.getByTestId("ramp-key")).toHaveCount(5);
  const lenWith5 = await total(page);
  const key = page.getByTestId("ramp-key").nth(1);
  const kb = (await key.boundingBox())!;
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.move(kb.x + kb.width / 2, box.y + 4, { steps: 6 });
  await page.mouse.up();
  expect(Number(await key.getAttribute("data-v"))).toBeGreaterThan(5);
  await expect.poll(() => total(page)).toBeLessThan(lenWith5);

  // Audio: mudo por defecto, se puede mantener el tono.
  await expect(page.getByTestId("ramp-audio").getByRole("radio", { name: "Silenciado" })).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("ramp-audio").getByRole("radio", { name: "Mantener tono" }).click();

  // Doble clic en un punto lo borra; Ctrl+Z lo trae de vuelta.
  await page.getByTestId("ramp-key").nth(1).dblclick();
  await expect(page.getByTestId("ramp-key")).toHaveCount(4);
  await focusBody(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("ramp-key")).toHaveCount(5);

  // Exportar: el proyecto lleva la rampa y el modo de audio.
  await page.keyboard.press("Control+e");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  const c = job.project.clips[0];
  expect(c.speedKeys).toHaveLength(5);
  expect(c.rampAudio).toBe("pitch");

  // Quitar la rampa vuelve a la velocidad constante.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("queue-panel")).toBeHidden();
  await page.getByTestId("ramp-clear").click();
  await expect(page.getByTestId("speed-slider")).toBeVisible();
  await expect.poll(() => total(page)).toBeCloseTo(before, 1);
});

test("rampa: los presets acelerar y frenar cambian el largo en sentidos opuestos", async ({ page }) => {
  await open(page);
  const before = await total(page);
  await page.getByTestId("clip").first().click();
  await page.getByTestId("inspector-tab-clip").click();
  await page.getByTestId("ramp-speed-up").click();
  await expect.poll(() => total(page)).toBeLessThan(before * 0.6);
  await page.getByTestId("ramp-slow-down").click();
  const frena = await total(page);
  expect(frena).toBeGreaterThan(before * 0.6);
  await expect(page.getByTestId("ramp-key")).toHaveCount(2);
});
