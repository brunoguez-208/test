import { expect, test } from "@playwright/test";
import { open, project, seek } from "./helpers";

// Pack de sonidos: escuchar al pasar el mouse, arrastrar a una pista y "+" en
// el playhead. Los sonidos son sintetizados por Snip (CC0).

test("sonidos: lista, escuchar al pasar, arrastrar y agregar en el playhead", async ({ page }) => {
  await open(page);
  // Registra las reproducciones (el autoplay sin gesto podría bloquearse).
  await page.evaluate(() => {
    const w = window as unknown as { __plays: string[] };
    w.__plays = [];
    HTMLMediaElement.prototype.play = function () {
      w.__plays.push(this.src);
      return Promise.resolve();
    };
  });
  await page.getByTestId("toggle-library").click();
  await page.getByTestId("lib-view").getByRole("radio", { name: "Sonidos" }).click();
  await expect(page.getByTestId("sfx-item")).toHaveCount(10);
  await expect(page.getByTestId("sfx-license")).toContainText("CC0");
  for (const name of ["whoosh", "pop", "impact", "riser", "notification"]) await expect(page.locator(`[data-testid="sfx-item"][data-name="${name}"]`)).toBeVisible();

  // Pasar el mouse lo reproduce; salir lo corta.
  const whoosh = page.locator('[data-testid="sfx-item"][data-name="whoosh"]');
  await whoosh.hover();
  await expect(whoosh).toHaveAttribute("data-playing", "true");
  expect(await page.evaluate(() => (window as unknown as { __plays: string[] }).__plays.length)).toBeGreaterThan(0);
  await page.mouse.move(5, 5);
  await expect(whoosh).toHaveAttribute("data-playing", "false");

  // Arrastrar "Impacto" a la pista de audio.
  const at = (await page.getByTestId("audio-track").boundingBox())!;
  await page.locator('[data-testid="sfx-item"][data-name="impact"]').dragTo(page.getByTestId("audio-track"), { targetPosition: { x: Math.min(200, at.width / 3), y: 10 } });
  await expect.poll(async () => (await project(page))?.music?.length ?? 0).toBe(1);
  let p = await project(page);
  const impact = p.media.find((m: { path: string }) => m.path.endsWith("impact.wav"));
  expect(impact).toBeTruthy();
  expect(p.music[0].mediaId).toBe(impact.id);
  expect(p.music[0].outPoint - p.music[0].inPoint).toBeCloseTo(0.9, 2);

  // "+" agrega "Pop" en el playhead (otra fila si se pisan).
  await seek(page, 2);
  await page.locator('[data-testid="sfx-item"][data-name="pop"]').hover();
  await page.locator('[data-testid="sfx-item"][data-name="pop"]').getByTestId("sfx-add").click();
  await expect.poll(async () => (await project(page))?.music?.length ?? 0).toBe(2);
  p = await project(page);
  const pop = p.music.find((m: { mediaId: string }) => p.media.find((x: { id: string; path: string }) => x.id === m.mediaId)?.path.endsWith("pop.wav"));
  expect(pop.start).toBeCloseTo(2, 1);
});
