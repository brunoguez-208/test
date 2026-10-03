import { expect, test } from "@playwright/test";
import { focusBody, openQueue } from "./helpers";

// Grabaciones de NVIDIA ShadowPlay: dos pistas de audio (juego + micrófono),
// nombre con varios puntos. El preview usa un proxy que mezcla las pistas
// (igual que la exportación) y se puede elegir una sola.
const SHADOWPLAY = "C:\\Users\\Bruno\\Videos\\Desktop 2026.10.03 - 04.28.16.07.mp4";

test("ShadowPlay: proxy con las pistas mezcladas, elegir una, nombre con puntos", async ({ page }) => {
  await page.goto("/?theme=dark&proxyMs=2500");
  await page.evaluate((p) => (window.__snipMock.dialogOpenPaths = [p]), SHADOWPLAY);
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  // La pestaña conserva todo el nombre (la extensión es solo lo último).
  await expect(page.getByTestId("tab")).toContainText("Desktop 2026.10.03 - 04.28.16.07");

  // Mientras se arma el proxy el preview sigue andando, con un aviso chico.
  await expect(page.getByTestId("mix-chip")).toContainText("Mezclando pistas de audio");
  await expect(page.getByTestId("proxy-chip")).toBeVisible({ timeout: 10_000 });
  const proxyCalls = () => page.evaluate(() => window.__snipMock.calls.filter((c) => c.cmd === "create_preview_proxy").map((c) => c.args));
  expect((await proxyCalls())[0]).toMatchObject({ path: expect.stringContaining("Desktop 2026.10.03"), tracks: [0, 1] });

  // Elegir solo el micrófono: otro proxy, y la exportación lleva la pista elegida.
  await page.getByTestId("clip").first().click();
  await page.getByTestId("inspector-tab-audio").click();
  await page.getByTestId("clip-audio-track-select").click();
  await expect(page.getByRole("option", { name: /Mezclar las 2/ })).toBeVisible();
  await page.getByRole("option", { name: /Solo la pista 2/ }).click();
  await expect.poll(async () => (await proxyCalls()).some((a) => JSON.stringify(a.tracks) === "[1]")).toBe(true);

  await page.getByTestId("inspector-tab-export").click();
  await expect(page.getByTestId("output-name")).toHaveText("Desktop 2026.10.03 - 04.28.16.07_snip.mp4");
  // Dos pistas: nunca "Rápido · sin pérdida" (copiarlas dejaría solo una audible).
  await expect(page.getByTestId("mode-caption")).not.toContainText("sin pérdida");
  await focusBody(page);
  await page.keyboard.press("Control+e");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  expect(job.project.clips[0].audio.track).toBe(1);
  expect(job.project.media[0].audioTracks).toBe(2);
});
