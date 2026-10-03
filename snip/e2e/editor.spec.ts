import { expect, test, type Page } from "@playwright/test";

// Tests de UI en navegador con el IPC de Tauri mockeado (src/mocks/tauriMock.ts).
const SHOTS = "e2e/screenshots";
const VIDEO = "C:\\Users\\Bruno\\Videos\\Clip de prueba.mp4";

const tc = (s: string) => {
  const [h, m, sec, f] = s.split(":").map(Number);
  return h * 3600 + m * 60 + sec + f / 30;
};

async function open(page: Page, query = "") {
  await page.goto(`/?theme=dark${query}`);
  await expect(page.getByTestId("welcome")).toBeVisible();
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("clip")).toHaveCount(1);
  await expect(page.getByTestId("thumb").first()).toBeVisible({ timeout: 10_000 });
}

/** Pone el foco en la página (no en un input) para que anden los atajos. */
async function focusBody(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function seek(page: Page, seconds: number) {
  const input = page.getByTestId("current-tc");
  await input.click();
  await input.fill(String(seconds));
  await input.press("Enter");
  await focusBody(page);
}

/** Abre el panel de la cola (si no está abierto). */
async function openQueue(page: Page) {
  if (!(await page.getByTestId("queue-panel").isVisible())) await page.getByTestId("queue-button").click();
  await expect(page.getByTestId("queue-panel")).toBeVisible();
}

async function total(page: Page) {
  return tc(((await page.getByTestId("total-tc").textContent()) ?? "").replace("/", "").trim());
}

async function clipIds(page: Page) {
  return page.getByTestId("clip").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.clipId!));
}

async function project(page: Page) {
  // El último autoguardado (o el proyecto que mandó la última exportación).
  return page.evaluate(() => {
    const saves = Object.values(window.__snipMock.autosaves);
    return saves.sort((a, b) => b.project.updatedAt - a.project.updatedAt)[0]?.project ?? null;
  });
}

test("abrir, ver el editor y exportar con la cola", async ({ page }) => {
  await page.goto("/?theme=dark");
  await expect(page.getByTestId("welcome-title")).toHaveText("Editá un video en segundos");
  await page.screenshot({ path: `${SHOTS}/01-bienvenida-oscuro.png` });
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("tab")).toHaveCount(1);
  await expect(page.getByTestId("tab")).toContainText("Clip de prueba");
  await expect(page.getByTestId("audio-clip")).toHaveCount(1);
  await expect(page.getByTestId("total-tc")).toContainText("00:00:12:00");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/02-editor-oscuro.png` });

  // El preview dibuja algo (WebGL) en el canvas.
  const lit = await page.getByTestId("preview-canvas").evaluate((c: HTMLCanvasElement) => {
    const g = document.createElement("canvas");
    g.width = 32;
    g.height = 18;
    const x = g.getContext("2d")!;
    x.drawImage(c, 0, 0, 32, 18);
    const d = x.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3;
  });
  expect(lit).toBeGreaterThan(20);

  await page.getByTestId("inspector-tab-export").click();
  await expect(page.getByTestId("mode-caption")).toContainText("Rápido · sin pérdida");
  await expect(page.getByTestId("output-name")).toHaveText("Clip de prueba_snip.mp4");
  await page.getByTestId("export-btn").click();
  await expect(page.getByTestId("toast-info")).toContainText("Exportando en segundo plano");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", /queued|running/);
  await page.screenshot({ path: `${SHOTS}/03-exportando.png` });
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  await expect(page.getByTestId("toast-success")).toContainText("Exportación lista");
  await page.screenshot({ path: `${SHOTS}/04-listo.png` });

  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  expect(job.window).toBeNull();
  expect(job.saveProject).toBe(true);
  expect(job.project.clips).toHaveLength(1);
  expect(job.settings!.format).toBe("mp4");

  // Exportado + .snip al lado: la pestaña ya no tiene cambios sin guardar.
  await expect(page.getByTestId("tab")).toHaveAttribute("data-dirty", "false");
  await page.getByTestId("queue-open-folder").click();
  await page.getByTestId("queue-play").click();
  const calls = await page.evaluate(() => window.__snipMock.calls.map((c) => c.cmd));
  expect(calls).toContain("reveal_in_folder");
  expect(calls).toContain("open_in_default_app");
});

test("multi-clip: agregar varios, reordenar arrastrando, deshacer y rehacer", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\v\\segundo 6s.mov", "C:\\v\\tercero 4s.mkv"]));
  await page.getByTestId("add-videos").click();
  await expect(page.getByTestId("clip")).toHaveCount(3);
  await expect(page.getByTestId("toast-success")).toContainText("2 videos agregados");
  expect(await total(page)).toBeCloseTo(22, 1);
  const [a, b, c] = await clipIds(page);

  // Arrastrar el tercero al principio.
  const last = (await page.getByTestId("clip").nth(2).boundingBox())!;
  const first = (await page.getByTestId("clip").nth(0).boundingBox())!;
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 10, first.y + first.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => clipIds(page)).toEqual([c, a, b]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/05-multiclip.png` });

  await focusBody(page);
  await page.keyboard.press("Control+z");
  await expect.poll(() => clipIds(page)).toEqual([a, b, c]);
  await page.keyboard.press("Control+y");
  await expect.poll(() => clipIds(page)).toEqual([c, a, b]);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("clip")).toHaveCount(1);
});

test("dividir con S, borrar el del medio con Supr y borrar un rango I/O", async ({ page }) => {
  await open(page);
  await seek(page, 4);
  await page.keyboard.press("s");
  await seek(page, 8);
  await page.keyboard.press("s");
  await expect(page.getByTestId("clip")).toHaveCount(3);
  // Seleccionar el del medio y borrarlo: el hueco se cierra.
  await page.getByTestId("clip").nth(1).click();
  await expect(page.getByTestId("clip").nth(1)).toHaveAttribute("data-selected", "true");
  await focusBody(page);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("clip")).toHaveCount(2);
  expect(await total(page)).toBeCloseTo(8, 1);

  // Rango I/O: de 1 a 2 s.
  await seek(page, 1);
  await page.keyboard.press("i");
  await seek(page, 2);
  await page.keyboard.press("o");
  await expect(page.getByTestId("io-range")).toBeVisible();
  await page.keyboard.press("Delete");
  expect(await total(page)).toBeCloseTo(8 - 1 - 1 / 30, 1);
  await page.keyboard.press("Control+z");
  expect(await total(page)).toBeCloseTo(8, 1);
});

test("fragmentos: marcar varios rangos y exportarlos como archivos separados", async ({ page }) => {
  await open(page);
  for (const [a, b] of [
    [1, 3],
    [6, 9],
  ]) {
    await seek(page, a);
    await page.keyboard.press("i");
    await seek(page, b);
    await page.keyboard.press("o");
    await page.getByTestId("add-range").click();
  }
  await expect(page.getByTestId("range-band")).toHaveCount(2);
  await page.getByTestId("inspector-tab-export").click();
  await expect(page.getByTestId("range-row")).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/06-fragmentos.png` });
  await page.getByTestId("export-ranges").click();
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveCount(2);
  const jobs = await page.evaluate(() => window.__snipMock.jobs);
  expect(jobs.map((j) => j.label)).toEqual(["Fragmento 1", "Fragmento 2"]);
  expect(jobs[0].window!.start).toBeCloseTo(1, 2);
  expect(jobs[1].window!.end).toBeCloseTo(9 + 1 / 30, 2);
  expect(jobs.every((j) => j.saveProject === false)).toBe(true);
  await expect(page.getByTestId("queue-item").nth(1)).toHaveAttribute("data-state", "done", { timeout: 15_000 });
});

test("marcadores: M agrega, doble click renombra, Shift+M salta", async ({ page }) => {
  await open(page);
  await seek(page, 2);
  await page.keyboard.press("m");
  await seek(page, 7);
  await page.keyboard.press("m");
  await expect(page.getByTestId("marker")).toHaveCount(2);
  await page.getByTestId("marker").first().dblclick();
  await page.getByTestId("marker-rename").fill("Gol");
  await page.getByTestId("marker-rename").press("Enter");
  await expect(page.getByTestId("ruler")).toContainText("Gol");
  await seek(page, 0);
  await page.keyboard.press("Shift+M");
  await expect(page.getByTestId("current-tc")).toHaveValue("00:00:02:00");
  await page.keyboard.press("Shift+M");
  await expect(page.getByTestId("current-tc")).toHaveValue("00:00:07:00");
  await page.keyboard.press("Control+Shift+M");
  await expect(page.getByTestId("current-tc")).toHaveValue("00:00:02:00");
});

test("velocidad, cámara lenta suave, invertir, loop, boomerang y congelar", async ({ page }) => {
  await open(page, "&heavyMs=900");
  await page.getByTestId("speed-2").click();
  expect(await total(page)).toBeCloseTo(6, 1);
  await expect(page.getByTestId("smooth-toggle")).toHaveCount(0);
  await page.getByTestId("speed-0.5").click();
  expect(await total(page)).toBeCloseTo(24, 1);
  await page.getByTestId("smooth-toggle").click();
  // La cámara lenta suave se procesa aparte: aviso discreto de "preparando vista previa".
  await expect(page.getByTestId("preparing-chip")).toBeVisible();
  await expect(page.getByTestId("preparing-chip")).toContainText("Interpolando");
  await page.screenshot({ path: `${SHOTS}/07-preparando.png` });
  await expect(page.getByTestId("preparing-chip")).toHaveCount(0, { timeout: 8000 });
  const prepared = await page.evaluate(() => window.__snipMock.calls.filter((c) => c.cmd === "prepare_clip").length);
  expect(prepared).toBeGreaterThan(0);

  await page.getByTestId("speed-1").click();
  await page.getByTestId("reverse-toggle").click();
  await expect(page.getByTestId("preparing-chip")).toContainText("Invirtiendo");
  await page.getByTestId("loop-mode-boomerang").click();
  // Boomerang ×2 = ida y vuelta dos veces.
  expect(await total(page)).toBeCloseTo(48, 1);
  await page.getByTestId("loop-mode-loop").click();
  await page.getByRole("button", { name: "Más repeticiones" }).click();
  expect(await total(page)).toBeCloseTo(36, 1);
  await page.getByTestId("loop-mode-none").click();
  expect(await total(page)).toBeCloseTo(12, 1);

  await seek(page, 5);
  await page.getByTestId("freeze-btn").click();
  await expect(page.getByTestId("clip")).toHaveCount(3);
  expect(await total(page)).toBeCloseTo(14, 1);
  await page.getByTestId("clip").nth(1).click();
  await expect(page.getByTestId("clip-tab")).toContainText("Cuadro congelado");
  await expect(page.getByTestId("freeze-duration")).toBeVisible();
});

test("audio: volumen, silenciar, quitar, fades, normalizar y reducir ruido", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-audio").click();
  const slider = page.getByTestId("clip-volume");
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect(page.getByTestId("volume-value")).toHaveText("150%");
  await page.getByTestId("mute-toggle").click();
  await page.getByTestId("normalize-toggle").click();
  await expect(page.getByTestId("clip-audio")).toContainText("estaba en -23,4 LUFS");
  await page.getByTestId("denoise-toggle").click();
  await expect(page.getByTestId("preparing-chip")).toContainText("Reduciendo ruido");
  await page.screenshot({ path: `${SHOTS}/08-audio.png` });
  await page.waitForTimeout(900);
  const p = await project(page);
  expect(p!.clips[0].audio).toMatchObject({ volume: 1.5, muted: true, denoise: true });
  expect(p!.clips[0].audio.normalize!.inputI).toBeCloseTo(-23.4);
  await page.getByTestId("remove-audio-toggle").click();
  await expect(page.getByTestId("audio-clip").first()).toHaveClass(/is-silent/);
});

test("música: agregar, ducking, extraer audio a MP3", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Música\\tema.mp3"]));
  await page.getByTestId("add-music").click();
  await expect(page.getByTestId("music-clip")).toHaveCount(1);
  await page.getByTestId("music-clip").click();
  await expect(page.getByTestId("music-section")).toBeVisible();
  await page.getByTestId("ducking-toggle").click();
  await page.screenshot({ path: `${SHOTS}/09-musica.png` });
  await page.getByTestId("extract-mp3").click();
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveCount(1);
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  expect(job.settings!.format).toBe("mp3");
  expect(job.project.music[0].ducking).toBe(true);
});

test("transiciones entre clips y fundido a negro", async ({ page }) => {
  await open(page);
  await seek(page, 6);
  await page.keyboard.press("s");
  await page.getByTestId("junction").click();
  await expect(page.getByTestId("transition-section")).toBeVisible();
  await page.getByTestId("transition-select").click();
  await page.getByRole("option", { name: "Deslizar ←" }).click();
  // La transición solapa los clips: el total baja 0,8 s.
  expect(await total(page)).toBeCloseTo(11.2, 1);
  await seek(page, 5.6);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/10-transicion.png` });
  await page.getByTestId("inspector-tab-video").click();
  const fi = (await page.getByTestId("global-fade-in").boundingBox())!;
  await page.mouse.click(fi.x + fi.width * 0.2, fi.y + fi.height / 2);
  const p = await project(page);
  await expect.poll(async () => (await project(page))?.fades.fadeIn ?? 0).toBeGreaterThan(0.5);
  expect(p).not.toBeNull();
});

test("exportar: formatos, resolución con confirmación y presets de tamaño", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-tab-export").click();
  await page.getByTestId("format-gif").click();
  await expect(page.getByTestId("size-preset")).toHaveCount(0);
  await expect(page.getByTestId("gif-fps")).toBeVisible();
  await page.getByTestId("format-webm").click();
  await expect(page.getByTestId("mode-caption")).toContainText("VP9");
  await page.getByTestId("format-mp4").click();

  await page.getByTestId("select-resolution").click();
  await page.getByRole("option", { name: /720p/ }).click();
  await expect(page.getByTestId("export-summary")).toContainText("1280×720");
  await page.getByTestId("select-resolution").click();
  await page.getByRole("option", { name: /4K/ }).click();
  await expect(page.getByRole("dialog")).toContainText("¿Agrandar el video?");
  await page.getByTestId("dialog-secondary").click();
  await expect(page.getByTestId("export-summary")).toContainText("1280×720");

  // Discord: aparece la opción de Nitro.
  await page.getByTestId("size-preset").click();
  await page.getByRole("option", { name: /Discord/ }).click();
  await expect(page.getByTestId("discord-tier")).toBeVisible();
  await expect(page.getByTestId("discord-tier")).toContainText("20 MB");
  await expect(page.getByTestId("discord-tier")).toContainText("Nitro Basic");
  await page.getByTestId("discord-tier-discordNitro").click();
  await expect(page.getByTestId("export-summary")).toContainText("hasta 500 MB");
  await page.screenshot({ path: `${SHOTS}/11-discord.png` });

  // Personalizado muy chico: avisa que pierde calidad y sugiere bajar la resolución.
  await page.getByTestId("size-preset").click();
  await page.getByRole("option", { name: /personalizado/ }).click();
  await page.getByTestId("custom-mb").fill("1");
  await page.getByTestId("custom-mb").press("Enter");
  await expect(page.getByTestId("size-low-quality")).toBeVisible();
  await page.getByTestId("apply-suggestion").click();
  await page.getByTestId("export-btn").click();
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveCount(1);
  const job = await page.evaluate(() => window.__snipMock.jobs[0]);
  expect(job.settings!.sizeTarget).toEqual({ preset: "custom", megabytes: 1 });
  expect(job.settings!.resolution.kind).not.toBe("original");
});

test("cola: varias exportaciones en segundo plano, reordenar y cancelar", async ({ page }) => {
  await open(page, "&exportMs=4000");
  await page.evaluate(() => (window.__snipMock.holdQueue = true));
  await page.getByTestId("inspector-tab-export").click();
  for (const f of ["mp4", "webm", "gif"]) {
    await page.getByTestId(`format-${f}`).click();
    await page.getByTestId("export-btn").click();
  }
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveCount(3);
  // Bajar el primero.
  await page.getByTestId("queue-item").first().getByRole("button", { name: "Bajar" }).click();
  await expect.poll(() => page.evaluate(() => window.__snipMock.queue.map((q) => q.id))).toEqual([2, 1, 3]);
  await page.getByTestId("queue-item").nth(2).getByTestId("queue-cancel").click();
  await expect(page.getByTestId("queue-item").nth(2)).toHaveAttribute("data-state", "cancelled");
  await page.evaluate(() => {
    window.__snipMock.holdQueue = false;
    window.__snipMock.exportMs = 500;
  });
  // Se puede seguir editando mientras exporta.
  await page.mouse.click(400, 300);
  await expect(page.getByTestId("queue-panel")).toHaveCount(0);
  await page.getByTestId("tool-marker").click();
  await expect(page.getByTestId("marker")).toHaveCount(1);
  await openQueue(page);
  await expect(page.getByTestId("queue-item").first()).toHaveAttribute("data-state", /running|done/, { timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}/12-cola.png` });
  await expect(page.getByTestId("queue-item").nth(1)).toHaveAttribute("data-state", "done", { timeout: 10_000 });
});

test("error de exportación: mensaje claro y detalles", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__snipMock.nextExportError = {
      kind: "diskFull",
      message: "No hay espacio suficiente en el disco para guardar el video.",
      detail: "av_interleaved_write_frame(): No space left on device",
    };
  });
  await page.keyboard.press("Control+e");
  await openQueue(page);
  const item = page.getByTestId("queue-item");
  await expect(item).toHaveAttribute("data-state", "failed", { timeout: 10_000 });
  await expect(item).toContainText("No hay espacio suficiente");
  await expect(item).not.toContainText("av_interleaved");
  await item.getByTestId("queue-details").click();
  await expect(item).toContainText("No space left on device");
  await expect(page.getByTestId("toast-critical")).toContainText("No se pudo exportar");
});

test("proyectos: autoguardado, sin terminar, cerrar con cambios, retomar y descartar", async ({ page }) => {
  await open(page);
  await seek(page, 3);
  await page.keyboard.press("s");
  await page.keyboard.press("m");
  await expect.poll(async () => (await project(page))?.clips.length).toBe(2);
  await expect(page.getByTestId("tab")).toHaveAttribute("data-dirty", "true");
  await page.getByTestId("tab-close").click();
  await expect(page.getByRole("dialog")).toContainText("¿Guardar los cambios?");
  await page.getByTestId("dialog-secondary").click();
  await expect(page.getByTestId("welcome")).toBeVisible();
  await expect(page.getByTestId("project-card")).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/13-sin-terminar.png` });
  await page.getByTestId("project-card").click();
  await expect(page.getByTestId("clip")).toHaveCount(2);
  await expect(page.getByTestId("marker")).toHaveCount(1);
  // Vuelve con el playhead donde estaba.
  await expect(page.getByTestId("current-tc")).toHaveValue("00:00:03:00");
  await page.keyboard.press("Control+w");
  await page.getByTestId("dialog-secondary").click();
  await expect(page.getByTestId("project-card")).toHaveCount(1);
  await page.getByTestId("project-card").hover();
  await page.getByTestId("discard-project").click();
  await expect(page.getByRole("dialog")).toContainText("¿Descartar el proyecto?");
  await page.getByTestId("dialog-primary").click();
  await expect(page.getByTestId("project-card")).toHaveCount(0);
});

test("proyectos sin terminar de antes y archivos recientes en la bienvenida", async ({ page }) => {
  await page.goto("/?theme=dark&seed=1");
  await expect(page.getByTestId("project-card")).toHaveCount(3);
  await expect(page.getByTestId("project-card").first()).toContainText("Vacaciones en la costa");
  await expect(page.getByTestId("project-card").first()).toContainText("hace 5 minutos");
  await expect(page.getByTestId("recent-row")).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/14-bienvenida-proyectos.png` });
  // Un proyecto con un video que se movió: aviso + "Buscar archivo".
  await page.getByTestId("project-card").nth(2).click();
  await expect(page.getByTestId("missing-media")).toBeVisible();
  await expect(page.getByTestId("toast-caution")).toContainText("Falta un archivo");
  await page.screenshot({ path: `${SHOTS}/15-archivo-faltante.png` });
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Videos\\cocina.mp4"]));
  await page.getByTestId("relink").click();
  await expect(page.getByTestId("missing-media")).toHaveCount(0);
  await expect(page.getByTestId("toast-success")).toContainText("vinculado");
});

test(".snip: Ctrl+S guarda, se reabre desde recientes y las pestañas", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window.__snipMock.dialogSavePath = "C:\\Users\\Bruno\\Documents\\mi proyecto.snip"));
  await focusBody(page);
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("toast-success")).toContainText("Proyecto guardado");
  await expect(page.getByTestId("tab")).toHaveAttribute("data-dirty", "false");
  const saved = await page.evaluate(() => Object.keys(window.__snipMock.snips));
  expect(saved).toContain("C:\\Users\\Bruno\\Documents\\mi proyecto.snip");
  // Editar → vuelve a tener cambios; Ctrl+S guarda en el mismo archivo sin preguntar.
  await page.keyboard.press("m");
  await expect(page.getByTestId("tab")).toHaveAttribute("data-dirty", "true");
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("tab")).toHaveAttribute("data-dirty", "false");

  // Abrir un .snip en otra pestaña (Ctrl+O) y cambiar con Ctrl+Tab.
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\Users\\Bruno\\Documents\\viaje.snip"]));
  await page.keyboard.press("Control+o");
  await expect(page.getByTestId("tab")).toHaveCount(2);
  await expect(page.getByTestId("tab").nth(1)).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Control+Tab");
  await expect(page.getByTestId("tab").nth(0)).toHaveAttribute("data-active", "true");
  await page.screenshot({ path: `${SHOTS}/16-pestanas.png` });
  await page.keyboard.press("Control+w");
  await expect(page.getByTestId("tab")).toHaveCount(1);
});

test("guardar el cuadro actual como PNG", async ({ page }) => {
  await open(page);
  await seek(page, 2);
  await page.evaluate(() => (window.__snipMock.dialogSavePath = "C:\\Users\\Bruno\\Desktop\\cuadro.png"));
  await page.getByTestId("save-png").click();
  await expect(page.getByTestId("toast-success")).toContainText("Cuadro guardado");
  const png = await page.evaluate(() => window.__snipMock.calls.find((c) => c.cmd === "save_png")!.args as { pngBase64: string });
  expect(png.pngBase64.startsWith("data:image/png;base64,")).toBe(true);
  expect(png.pngBase64.length).toBeGreaterThan(5000);
});

test("zoom del timeline con +/− y Ctrl+rueda", async ({ page }) => {
  await open(page);
  const w0 = (await page.getByTestId("clip").boundingBox())!.width;
  await focusBody(page);
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await expect.poll(async () => (await page.getByTestId("clip").boundingBox())!.width).toBeGreaterThan(w0 * 2);
  const area = (await page.getByTestId("timeline-area").boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + 60);
  await page.keyboard.down("Control");
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await page.getByTestId("clip").boundingBox())!.width).toBeLessThan(w0 * 1.05);
});

test("atajos: panel con ?, espacio reproduce y J/K/L", async ({ page }) => {
  await open(page);
  await focusBody(page);
  await page.keyboard.press("Shift+?");
  await expect(page.getByTestId("shortcuts-panel")).toBeVisible();
  await expect(page.getByTestId("shortcuts-panel")).toContainText("Dividir en el playhead");
  await page.screenshot({ path: `${SHOTS}/17-atajos.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts-panel")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("aria-label", "Pausa");
  await page.waitForTimeout(700);
  await page.keyboard.press("k");
  await expect(page.getByTestId("play-toggle")).toHaveAttribute("aria-label", "Reproducir");
  expect(tc(await page.getByTestId("current-tc").inputValue())).toBeGreaterThan(0.3);
  // Escribiendo en un input, los atajos no hacen nada.
  await page.getByTestId("current-tc").focus();
  await page.keyboard.press("s");
  await expect(page.getByTestId("clip")).toHaveCount(1);
});

test("formatos: abre MOV/MKV/WebM, avisa con otros y archivo dañado", async ({ page }) => {
  await page.goto("/?theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-dnd", "ready");
  await page.evaluate(() => window.__snipMock.dragEnter(["C:\\v\\clip.avi"]));
  await expect(page.getByTestId("trim-illustration")).toHaveAttribute("data-drag", "invalid");
  await page.evaluate(() => window.__snipMock.drop(["C:\\v\\clip.avi"]));
  await expect(page.getByTestId("toast-caution").last()).toContainText("Ese formato no se puede abrir");
  await page.evaluate(() => window.__snipMock.dragEnter(["C:\\v\\peli.mkv", "C:\\v\\vertical.webm"]));
  await expect(page.getByTestId("trim-illustration")).toHaveAttribute("data-drag", "valid");
  await page.screenshot({ path: `${SHOTS}/18-drag-valido.png` });
  await page.evaluate(() => window.__snipMock.drop(["C:\\v\\peli.mkv", "C:\\v\\vertical.webm"]));
  await expect(page.getByTestId("clip")).toHaveCount(2);
  // En el editor, soltar un video lo suma al proyecto.
  await page.evaluate(() => window.__snipMock.dragEnter(["C:\\v\\otro.mov"]));
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-valid", "true");
  await page.evaluate(() => window.__snipMock.drop(["C:\\v\\otro.mov"]));
  await expect(page.getByTestId("clip")).toHaveCount(3);
  await page.evaluate(() => (window.__snipMock.dialogOpenPaths = ["C:\\v\\corrupto.mp4"]));
  await page.getByTestId("tab-new").click();
  await expect(page.getByTestId("toast-critical")).toContainText("dañado");
});

test("HEVC sin soporte: genera el proxy y muestra el aviso", async ({ page }) => {
  await page.goto("/?theme=dark&broken=1&codec=hevc");
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("proxy-progress")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/19-proxy.png` });
  await expect(page.getByTestId("proxy-chip")).toBeVisible({ timeout: 8000 });
  const calls = await page.evaluate(() => window.__snipMock.calls.map((c) => c.cmd));
  expect(calls).toContain("create_preview_proxy");
});

test("inspector colapsable", async ({ page }) => {
  await open(page);
  await page.getByTestId("toggle-panel").click();
  await expect(page.getByTestId("inspector")).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/20-panel-cerrado.png` });
  await page.getByTestId("toggle-panel").click();
  await expect(page.getByTestId("inspector")).toBeVisible();
});

test("tema claro", async ({ page }) => {
  await page.goto("/?theme=light&seed=1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(243, 243, 243)");
  await page.screenshot({ path: `${SHOTS}/21-bienvenida-claro.png` });
  await page.getByTestId("welcome-open").click();
  await expect(page.getByTestId("thumb").first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("inspector-tab-export").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/22-editor-claro.png` });
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="export-btn"]')!).backgroundColor))
    .toBe("rgb(0, 95, 184)");
});

test("tema oscuro con acento personalizado", async ({ page }) => {
  await page.goto("/?theme=dark&accentLight2=%23FF8CC6&accentDark1=%23B3005E");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(32, 32, 32)");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="welcome-open"]')!).backgroundColor))
    .toBe("rgb(255, 140, 198)");
  await page.screenshot({ path: `${SHOTS}/23-acento-rosa.png` });
});

test.describe("movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });
  test("sin loops ni shimmer, la app sigue funcionando", async ({ page }) => {
    await page.goto("/?theme=dark&thumbMs=300");
    await page.getByTestId("welcome-open").click();
    await expect(page.getByTestId("editor")).toBeVisible();
    const anim = await page.evaluate(() => {
      const el = document.querySelector(".skeleton");
      return el ? getComputedStyle(el, "::after").animationName : "none";
    });
    expect(anim).toBe("none");
    await page.keyboard.press("Control+e");
    await openQueue(page);
    await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 10_000 });
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
  await open(page);
  await seek(page, 4);
  await page.keyboard.press("s");
  await page.getByTestId("junction").click();
  await page.getByTestId("inspector-tab-audio").click();
  await page.getByTestId("inspector-tab-export").click();
  await page.keyboard.press("Control+e");
  await openQueue(page);
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  expect(errors).toEqual([]);
});

void VIDEO;
