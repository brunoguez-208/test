import { expect, test, type Page } from "@playwright/test";

const SHOTS = "e2e/screenshots";

async function openSample(page: Page, query = "") {
  await page.goto(`/?theme=dark${query}`);
  await expect(page.getByTestId("welcome")).toBeVisible();
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  // Miniaturas cargadas y video listo.
  await expect(page.getByTestId("thumb")).toHaveCount(20, { timeout: 10_000 });
  await expect(page.locator(".skeleton")).toHaveCount(0);
}

async function dragHandle(page: Page, side: "start" | "end", fraction: number) {
  const strip = (await page.getByTestId("timeline-strip").boundingBox())!;
  const h = (await page.getByTestId(`handle-${side}`).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width * fraction + (side === "start" ? -h.width / 2 : h.width / 2), h.y + h.height / 2, { steps: 10 });
  await page.mouse.up();
}

const tcToSeconds = (tc: string) => {
  const [h, m, s, f] = tc.split(":").map(Number);
  return h * 3600 + m * 60 + s + f / 30;
};

test("flujo completo: bienvenida → abrir → mover handles → exportar → éxito", async ({ page }) => {
  await page.goto("/?theme=dark");
  await expect(page.getByTestId("welcome-title")).toHaveText("Recortá un video en segundos");
  await page.screenshot({ path: `${SHOTS}/01-bienvenida-oscuro.png` });

  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("titlebar-file")).toHaveText("Clip de prueba.mp4");
  await expect(page.getByTestId("thumb")).toHaveCount(20, { timeout: 10_000 });
  await expect(page.getByTestId("tc-start")).toHaveValue("00:00:00:00");
  await expect(page.getByTestId("tc-end")).toHaveValue("00:00:11:29");
  await page.screenshot({ path: `${SHOTS}/02-editor-oscuro.png` });

  // Handles: el preview salta al cuadro del handle.
  await dragHandle(page, "start", 0.25);
  const startTc = await page.getByTestId("tc-start").inputValue();
  expect(tcToSeconds(startTc)).toBeGreaterThan(2.5);
  expect(tcToSeconds(startTc)).toBeLessThan(3.5);
  await expect(page.getByTestId("current-tc")).toHaveText(startTc);

  await dragHandle(page, "end", 0.75);
  const endTc = await page.getByTestId("tc-end").inputValue();
  expect(tcToSeconds(endTc)).toBeGreaterThan(8.5);
  expect(tcToSeconds(endTc)).toBeLessThan(9.5);
  await expect(page.getByTestId("current-tc")).toHaveText(endTc);

  // Modo rápido: avisa del keyframe.
  await expect(page.getByTestId("mode-caption")).toContainText("keyframe");
  await page.screenshot({ path: `${SHOTS}/03-recorte-oscuro.png` });

  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("export-progress")).toBeVisible();
  await expect(page.getByTestId("export-bar")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-exportando-oscuro.png` });
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("success-file")).toHaveText("Clip de prueba_snip.mp4");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/05-listo-oscuro.png` });

  const req = await page.evaluate(() => window.__snipMock.lastExport);
  expect(req).not.toBeNull();
  expect(req!.mode).toBe("fast");
  expect(req!.output).toBeNull();
  expect(req!.resolution).toEqual({ kind: "original" });
  expect(req!.start).toBeCloseTo(tcToSeconds(startTc), 3);
  expect(req!.end).toBeCloseTo(tcToSeconds(endTc) + 1 / 30, 3);

  // Abrir carpeta / reproducir llaman a Rust con la salida.
  await page.getByTestId("open-folder").click();
  await page.getByTestId("play-output").click();
  const calls = await page.evaluate(() => window.__snipMock.calls.map((c) => c.cmd));
  expect(calls).toContain("reveal_in_folder");
  expect(calls).toContain("open_in_default_app");

  // Otra exportación: el nombre por defecto no pisa el anterior.
  await page.getByTestId("export-again").click();
  await expect(page.getByTestId("output-name")).toHaveText("Clip de prueba_snip (2).mp4");
});

test("timecodes editables mueven los handles y validan", async ({ page }) => {
  await openSample(page);
  const start = page.getByTestId("tc-start");
  await start.fill("00:00:04:15");
  await start.press("Enter");
  await expect(start).toHaveValue("00:00:04:15");
  await expect(page.getByTestId("current-tc")).toHaveText("00:00:04:15");
  const handle = await page.getByTestId("handle-start").boundingBox();
  const strip = await page.getByTestId("timeline-strip").boundingBox();
  // 4,5 s de 12 s = 37,5 % (el handle está a la izquierda del inicio).
  expect((handle!.x + handle!.width - strip!.x) / strip!.width).toBeCloseTo(0.375, 1);

  // Formato corto (mm:ss) y ↑ para sumar un cuadro.
  const end = page.getByTestId("tc-end");
  await end.fill("0:09");
  await end.press("Enter");
  await expect(end).toHaveValue("00:00:09:00");
  await end.focus();
  await end.press("ArrowUp");
  await expect(end).toHaveValue("00:00:09:01");
  await end.press("Escape");

  // Valor inválido: se rechaza y vuelve al anterior.
  await start.fill("abc");
  await start.press("Enter");
  await expect(start).toHaveValue("00:00:04:15");
  // Inicio después del fin: se rechaza.
  await start.fill("00:00:10:00");
  await start.press("Enter");
  await expect(start).toHaveValue("00:00:04:15");
});

test("atajos: I/O, cuadro a cuadro, espacio, Ctrl+E", async ({ page }) => {
  await openSample(page);
  await page.locator("body").click({ position: { x: 640, y: 20 } });
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("current-tc")).toHaveText("00:00:03:01");
  await page.keyboard.press("i");
  await expect(page.getByTestId("tc-start")).toHaveValue("00:00:03:01");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o");
  await expect(page.getByTestId("tc-end")).toHaveValue("00:00:05:01");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("current-tc")).toHaveText("00:00:05:00");

  // Espacio reproduce desde el inicio del rango y respeta el final.
  await page.keyboard.press("Space");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("aria-label", "Pausa");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("aria-label", "Reproducir", { timeout: 6000 });
  const tc = await page.getByTestId("current-tc").textContent();
  expect(tcToSeconds(tc!)).toBeLessThanOrEqual(5.04);
  expect(tcToSeconds(tc!)).toBeGreaterThanOrEqual(4.9);

  // Escribiendo en un input los atajos no hacen nada.
  await page.getByTestId("tc-start").focus();
  await page.keyboard.press("o");
  await expect(page.getByTestId("tc-end")).toHaveValue("00:00:05:01");
  await page.keyboard.press("Escape");

  await page.locator("body").click({ position: { x: 640, y: 20 } });
  await page.keyboard.press("Control+e");
  await expect(page.getByTestId("export-progress")).toBeVisible();
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
});

test("loop: la reproducción vuelve al inicio del rango", async ({ page }) => {
  await openSample(page);
  const start = page.getByTestId("tc-start");
  await start.fill("00:00:06:00");
  await start.press("Enter");
  const end = page.getByTestId("tc-end");
  await end.fill("00:00:06:29");
  await end.press("Enter");
  await page.getByTestId("loop-toggle").click();
  await page.getByTestId("play-toggle").click();
  await page.waitForTimeout(2600);
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("aria-label", "Pausa");
  const tc = tcToSeconds((await page.getByTestId("current-tc").textContent())!);
  expect(tc).toBeGreaterThanOrEqual(5.95);
  expect(tc).toBeLessThan(7.05);
  await page.getByTestId("play-toggle").click();
});

test("modo preciso: resolución, fps y confirmaciones", async ({ page }) => {
  await openSample(page);
  await page.getByTestId("select-resolution").click();
  await page.getByRole("option", { name: /720p/ }).click();
  await expect(page.getByTestId("mode-precise")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("export-summary")).toContainText("1280×720");

  // 4K agranda: pide confirmación. Cancelar deja 720p.
  await page.getByTestId("select-resolution").click();
  await page.getByRole("option", { name: /4K/ }).click();
  await expect(page.getByRole("dialog")).toContainText("¿Agrandar el video?");
  await page.screenshot({ path: `${SHOTS}/06-confirmar-agrandar.png` });
  await page.getByTestId("dialog-secondary").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("select-resolution")).toHaveText(/720p/);

  // FPS: 60 desde 30 pide confirmación; aceptar.
  await page.getByTestId("select-fps").click();
  await page.getByRole("option", { name: /60 fps/ }).click();
  await expect(page.getByRole("dialog")).toContainText("¿Subir los fps?");
  await page.getByTestId("dialog-primary").click();
  await expect(page.getByTestId("export-summary")).toContainText("60 fps");

  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
  const req = await page.evaluate(() => window.__snipMock.lastExport);
  expect(req).toMatchObject({ mode: "precise", resolution: { kind: "p720" }, fps: "fps60", allowFpsIncrease: true, allowUpscale: false });

  // Volver a "Rápido" resetea todo a original.
  await page.getByTestId("export-again").click();
  await page.getByTestId("mode-fast").click();
  await expect(page.getByTestId("export-summary")).toContainText("1920×1080 · 30 fps");
});

test("corte exacto y resolución personalizada", async ({ page }) => {
  await openSample(page);
  await page.getByTestId("frame-exact").click();
  await expect(page.getByTestId("mode-precise")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("select-resolution").click();
  await page.getByRole("option", { name: /Personalizada/ }).click();
  const w = page.getByTestId("custom-width");
  await w.fill("1001");
  await w.press("Enter");
  await expect(w).toHaveValue("1002");
  await expect(page.getByTestId("custom-height")).toHaveValue("564");
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
  const req = await page.evaluate(() => window.__snipMock.lastExport);
  expect(req).toMatchObject({ mode: "precise", frameExact: true, resolution: { kind: "custom", width: 1002 } });
});

test("cancelar la exportación vuelve a la configuración", async ({ page }) => {
  await openSample(page, "&exportMs=8000");
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("export-progress")).toBeVisible();
  await page.getByTestId("export-cancel").click();
  await expect(page.getByTestId("toast-info")).toContainText("Exportación cancelada");
  await expect(page.getByTestId("export-settings")).toBeVisible();
  const calls = await page.evaluate(() => window.__snipMock.calls.map((c) => c.cmd));
  expect(calls).toContain("cancel_export");
});

test("error de exportación: mensaje claro, detalles y reintentar", async ({ page }) => {
  await openSample(page);
  await page.evaluate(() => {
    window.__snipMock.nextExportError = {
      kind: "diskFull",
      message: "No hay espacio suficiente en el disco para guardar el video.",
      detail: "av_interleaved_write_frame(): No space left on device",
    };
  });
  await page.getByTestId("export-btn").click();
  const err = page.getByTestId("export-error");
  await expect(err).toContainText("No hay espacio suficiente");
  await expect(err).not.toContainText("av_interleaved");
  await err.getByText("Ver detalles").click();
  await expect(err).toContainText("No space left on device");
  await page.screenshot({ path: `${SHOTS}/07-error.png` });
  await expect(page.getByTestId("export-btn")).toHaveText(/Reintentar/);
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
});

test("guardar como… cambia el destino", async ({ page }) => {
  await openSample(page);
  await page.getByTestId("save-as").click();
  await expect(page.getByTestId("output-name")).toHaveText("recorte final.mp4");
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("success-file")).toHaveText("recorte final.mp4");
});

test("aviso de formato no soportado: bienvenida, drop y editor", async ({ page }) => {
  await page.goto("/?theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-dnd", "ready");
  await page.evaluate(() => window.__snipMock.dragEnter(["C:\\v\\clip.mov"]));
  await expect(page.getByTestId("trim-illustration")).toHaveAttribute("data-drag", "invalid");
  await expect(page.getByRole("heading", { name: "Por ahora solo MP4" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/08-drag-invalido.png` });
  await page.evaluate(() => window.__snipMock.drop(["C:\\v\\clip.mov"]));
  await expect(page.getByTestId("toast-caution").last()).toContainText("Por ahora solo MP4");
  await expect(page.getByTestId("trim-illustration")).toHaveAttribute("data-drag", "none", { timeout: 3000 });

  // Arrastrar un MP4: se abre con glow y al soltar carga el video.
  await page.evaluate(() => window.__snipMock.dragEnter(["C:\\v\\otro.mp4"]));
  await expect(page.getByTestId("trim-illustration")).toHaveAttribute("data-drag", "valid");
  await expect(page.getByRole("heading", { name: "Soltalo para abrirlo" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/09-drag-valido.png` });
  await page.evaluate(() => window.__snipMock.drop(["C:\\v\\otro.mp4"]));
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("titlebar-file")).toHaveText("otro.mp4");

  // En el editor, la capa de drop también reacciona distinto.
  await page.evaluate(() => window.__snipMock.dragEnter(["C:\\v\\peli.mkv"]));
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-valid", "false");
  await expect(page.getByTestId("drop-overlay")).toContainText("Por ahora solo MP4");
  await page.evaluate(() => window.__snipMock.dragLeave());
  await expect(page.getByTestId("drop-overlay")).toHaveCount(0);

  // Diálogo "Abrir" con un archivo no MP4 (por si el filtro se saltea).
  await page.evaluate(() => (window.__snipMock.dialogOpenPath = "C:\\v\\x.webm"));
  await page.getByTestId("titlebar-open").click();
  await expect(page.getByTestId("toast-caution").last()).toContainText("Por ahora solo MP4");
});

test("archivo dañado: error claro en español", async ({ page }) => {
  await page.goto("/?theme=dark");
  await page.evaluate(() => (window.__snipMock.dialogOpenPath = "C:\\v\\corrupto.mp4"));
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("toast-critical")).toContainText("dañado");
  await expect(page.getByTestId("welcome")).toBeVisible();
});

test("HEVC sin soporte: genera el proxy y muestra el aviso", async ({ page }) => {
  await page.goto("/?theme=dark&broken=1&codec=hevc");
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("proxy-progress")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-proxy.png` });
  await expect(page.getByTestId("proxy-chip")).toBeVisible({ timeout: 8000 });
  const calls = await page.evaluate(() => window.__snipMock.calls.map((c) => c.cmd));
  expect(calls).toContain("create_preview_proxy");
  // El modo rápido conserva HEVC.
  await expect(page.getByTestId("export-summary")).toContainText("HEVC sin recodificar");
});

test("panel de exportación colapsable", async ({ page }) => {
  await openSample(page);
  await page.getByTestId("toggle-panel").click();
  await expect(page.getByTestId("export-panel")).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/11-panel-cerrado.png` });
  // Ctrl+E con el panel cerrado lo abre y exporta.
  await page.keyboard.press("Control+e");
  await expect(page.getByTestId("export-panel")).toBeVisible();
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
});

test("tema claro", async ({ page }) => {
  await page.goto("/?theme=light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(243, 243, 243)");
  await page.screenshot({ path: `${SHOTS}/12-bienvenida-claro.png` });
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("thumb")).toHaveCount(20, { timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/13-editor-claro.png` });
  // Acento claro: AccentDark1 en rellenos.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="export-btn"]')!).backgroundColor))
    .toBe("rgb(0, 95, 184)");
});

test("tema oscuro con acento personalizado", async ({ page }) => {
  await page.goto("/?theme=dark&accentLight2=%23FF8CC6&accentDark1=%23B3005E");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(32, 32, 32)");
  // En oscuro, los rellenos de acento usan AccentLight2.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="welcome-open"]')!).backgroundColor))
    .toBe("rgb(255, 140, 198)");
  await page.screenshot({ path: `${SHOTS}/14-acento-rosa.png` });
});

test.describe("movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });
  test("sin loops ni shimmer, la app sigue funcionando", async ({ page }) => {
    await page.goto("/?theme=dark&thumbMs=400");
    await page.getByTestId("welcome-open").click();
    await expect(page.getByTestId("editor")).toBeVisible();
    const anim = await page.evaluate(() => {
      const el = document.querySelector(".skeleton");
      return el ? getComputedStyle(el, "::after").animationName : "none";
    });
    expect(anim).toBe("none");
    await expect(page.getByTestId("thumb")).toHaveCount(20, { timeout: 15_000 });
    await page.getByTestId("export-btn").click();
    await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
    const shimmer = await page.evaluate(() => {
      const el = document.querySelector(".shimmer");
      return el ? getComputedStyle(el, "::after").animationName : "none";
    });
    expect(shimmer).toBe("none");
  });

  test("la ilustración de bienvenida queda quieta", async ({ page }) => {
    await page.goto("/?theme=dark");
    await expect(page.getByTestId("welcome")).toBeVisible();
    await page.waitForTimeout(800);
    const box1 = await page.getByTestId("trim-illustration").locator(".illus-handle").first().boundingBox();
    await page.waitForTimeout(1200);
    const box2 = await page.getByTestId("trim-illustration").locator(".illus-handle").first().boundingBox();
    expect(Math.abs(box1!.x - box2!.x)).toBeLessThan(1);
  });
});

test("sin errores en consola", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await openSample(page);
  await dragHandle(page, "start", 0.3);
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("export-success")).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
