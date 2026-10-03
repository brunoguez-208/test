import { expect, type Page } from "@playwright/test";

// Helpers de los tests de UI (IPC de Tauri mockeado: src/mocks/tauriMock.ts).

export const tc = (s: string) => {
  const [h, m, sec, f] = s.split(":").map(Number);
  return h * 3600 + m * 60 + sec + f / 30;
};

export async function open(page: Page, query = "") {
  await page.goto(`/?theme=dark${query}`);
  await expect(page.getByTestId("welcome")).toBeVisible();
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("clip")).toHaveCount(1);
  await expect(page.getByTestId("thumb").first()).toBeVisible({ timeout: 10_000 });
}

/** Pone el foco en la página (no en un input) para que anden los atajos. */
export async function focusBody(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

export async function seek(page: Page, seconds: number) {
  const input = page.getByTestId("current-tc");
  await input.click();
  await input.fill(String(seconds));
  await input.press("Enter");
  await focusBody(page);
}

/** Abre el panel de la cola (si no está abierto). */
export async function openQueue(page: Page) {
  if (!(await page.getByTestId("queue-panel").isVisible())) await page.getByTestId("queue-button").click();
  await expect(page.getByTestId("queue-panel")).toBeVisible();
}

export async function total(page: Page) {
  return tc(((await page.getByTestId("total-tc").textContent()) ?? "").replace("/", "").trim());
}

export async function clipIds(page: Page) {
  return page.getByTestId("clip").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.clipId!));
}

export async function project(page: Page) {
  // El último autoguardado (o el proyecto que mandó la última exportación).
  return page.evaluate(() => {
    const saves = Object.values(window.__snipMock.autosaves);
    return saves.sort((a, b) => b.project.updatedAt - a.project.updatedAt)[0]?.project ?? null;
  });
}


/** Espera a que un elemento termine de animarse (misma caja dos veces seguidas). */
export async function settled(page: Page, testId: string) {
  let last = "";
  await expect
    .poll(
      async () => {
        const b = await page.getByTestId(testId).boundingBox();
        const now = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}` : "";
        const same = now !== "" && now === last;
        last = now;
        return same;
      },
      { intervals: [120], timeout: 10_000 },
    )
    .toBe(true);
}
