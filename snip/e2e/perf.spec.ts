import { expect, test, type Page } from "@playwright/test";

// Rendimiento: corre solo (después del resto) para que la medición no compita
// por CPU con otros tests. WebGL por software (sin GPU) en este entorno.
const SHOTS = "e2e/screenshots";

const tc = (s: string) => {
  const [h, m, sec, f] = s.split(":").map(Number);
  return h * 3600 + m * 60 + sec + f / 30;
};

async function open(page: Page) {
  await page.goto("/?theme=dark");
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("clip")).toHaveCount(1);
}

async function focusBody(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test("rendimiento: timeline fluido con 12 clips y preview 1080p", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = Array.from({ length: 11 }, (_, i) => `C:\\v\\clip${i} 5s.mp4`)));
  await page.getByTestId("add-videos").click();
  await expect(page.getByTestId("clip")).toHaveCount(12);
  await expect(page.getByTestId("thumb-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await focusBody(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press("+");
  // Fluidez al scrollear: tareas largas del hilo principal (> 50 ms) y tiempo por paso.
  const stats = await page.evaluate(async () => {
    const long: number[] = [];
    const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration)));
    obs.observe({ type: "longtask", buffered: false });
    const durs: number[] = [];
    const area = document.querySelector('[data-testid="timeline-area"]')!;
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      area.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      durs.push(performance.now() - t);
    }
    await new Promise((r) => setTimeout(r, 200));
    obs.disconnect();
    durs.sort((a, b) => a - b);
    return { p50: durs[Math.floor(durs.length / 2)], long: long.sort((a, b) => b - a) };
  });
  // Sin GPU (todo se pinta por software) cada cuadro cuesta más que en una PC real:
  // igual no puede haber tareas largas que traben el scroll.
  expect(stats.long.filter((d) => d > 150)).toEqual([]);
  expect(stats.p50).toBeLessThan(50);
  // Reproducción con el preview a 1080p: el reloj avanza en tiempo real.
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  await page.keyboard.press("Space");
  expect(tc(await page.getByTestId("current-tc").inputValue())).toBeGreaterThan(1.8);
  await page.screenshot({ path: `${SHOTS}/24-doce-clips.png` });
});

