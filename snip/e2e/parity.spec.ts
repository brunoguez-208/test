// Paridad preview ↔ exportación: el mismo proyecto se renderiza con el
// compositor WebGL del preview (sobre videos reales) y con el motor de Rust +
// FFmpeg real; se comparan cuadros exactos con SSIM. Requiere FFmpeg
// (SNIP_FFMPEG_DIR, por defecto /opt/ffmpeg9/bin) y cargo; si faltan, se saltea.

import { test, expect, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MediaRef, Project, TransitionKind } from "../src/project/model";
import { canvasFps } from "../src/project/model";
import { fitCanvas, insertMedia, newProject, setTransition, updateClip } from "../src/project/ops";
import { LOOKS } from "../src/engine/color";
import { addBlur, addEffect, addImage, addPip, addText, setCues, updateOverlay } from "../src/project/overlayOps";
import { layout } from "../src/project/timeline";
import { rampPreset } from "../src/project/ramp";

const FF_DIR = process.env.SNIP_FFMPEG_DIR ?? "/opt/ffmpeg9/bin";
const FFMPEG = join(FF_DIR, "ffmpeg");
const MANIFEST = resolve(process.cwd(), "src-tauri/core/Cargo.toml");
const available = existsSync(FFMPEG) && !process.env.SNIP_SKIP_INTEGRATION;

test.describe.configure({ mode: "serial" });
test.skip(!available, "Sin FFmpeg: paridad salteada");

let dir = "";
const media: Record<string, MediaRef> = {};

function ff(args: string[]): string {
  return execFileSync(FFMPEG, ["-hide_banner", "-y", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function snipRender(args: string[]): string {
  return execFileSync("cargo", ["run", "-q", "--example", "snip_render", "--manifest-path", MANIFEST, "--", ...args], {
    encoding: "utf8",
    env: { ...process.env, SNIP_FFMPEG_DIR: FF_DIR },
    maxBuffer: 1 << 26,
  });
}

/** VP9 (el Chromium de test no decodifica H.264), BT.601 etiquetado en los dos caminos. */
function makeVideo(name: string, src: string) {
  ff([
    "-loglevel", "error", "-f", "lavfi", "-i", src,
    "-c:v", "libvpx-vp9", "-crf", "10", "-b:v", "0", "-deadline", "good", "-cpu-used", "4", "-g", "15",
    "-pix_fmt", "yuv420p", "-colorspace", "smpte170m", "-color_primaries", "smpte170m", "-color_trc", "smpte170m",
    join(dir, name),
  ]);
  media[name] = JSON.parse(snipRender(["probe", join(dir, name), name.replace(/\W/g, "")]));
}

test.beforeAll(() => {
  test.setTimeout(600_000);
  dir = mkdtempSync(join(tmpdir(), "snip-parity-"));
  makeVideo("a.webm", "testsrc2=s=640x360:r=30:d=4");
  makeVideo("b.webm", "testsrc2=s=640x360:r=30:d=4,hue=h=140,hflip");
  makeVideo("c.webm", "testsrc=s=360x360:r=30:d=4");
  // Pantalla verde con un sujeto que se mueve (para el chroma key).
  makeVideo("verde.webm", "color=c=0x00b140:s=640x360:r=30:d=4[bg];testsrc2=s=220x160:r=30:d=4[fg];[bg][fg]overlay=x='120+60*t':y=100[out0]");
  // Logo con transparencia (PNG).
  ff(["-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xFF6A00@0.85:s=240x120,format=rgba,drawbox=x=20:y=20:w=80:h=80:color=white@1:t=fill", "-frames:v", "1", join(dir, "logo.png")]);
  media["logo.png"] = JSON.parse(snipRender(["probe", join(dir, "logo.png"), "logo"]));
});

test.afterAll(() => {
  // SNIP_PARITY_KEEP=1 deja los cuadros para mirarlos a mano.
  if (process.env.SNIP_PARITY_KEEP) console.log(`[paridad] cuadros en ${dir}`);
  else if (dir) rmSync(dir, { recursive: true, force: true });
});

function exportProject(p: Project, name: string, raster: Raster | null = null): string {
  const out = join(dir, `${name}.mp4`);
  const job = join(dir, `${name}.json`);
  writeFileSync(job, JSON.stringify({ project: p, output: out, saveProject: false, raster }));
  snipRender(["export", job, join(dir, "work")]);
  return out;
}

/** Cuadros exactos (por índice) del video exportado, como PNG. */
function exportedFrames(file: string, frames: number[], tag: string): string[] {
  return frames.map((k) => {
    const png = join(dir, `${tag}-exp-${k}.png`);
    ff(["-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${k})`, "-fps_mode", "passthrough", "-frames:v", "1", png]);
    return png;
  });
}

async function previewFrames(page: Page, p: Project, frames: number[], tag: string): Promise<string[]> {
  const urls = mediaUrls(p);
  const pngs = await page.evaluate(
    ({ p, urls, frames }) => (window as unknown as { __snipParity: { render: (...a: unknown[]) => Promise<string[]> } }).__snipParity.render(p, urls, frames),
    { p, urls, frames },
  );
  return pngs.map((d, i) => {
    const file = join(dir, `${tag}-prev-${frames[i]}.png`);
    writeFileSync(file, Buffer.from(d.split(",")[1], "base64"));
    return file;
  });
}

function compare(a: string, b: string): number {
  const r = spawnSync(
    FFMPEG,
    ["-hide_banner", "-i", a, "-i", b, "-lavfi", "[0:v]format=yuv420p[x];[1:v]format=yuv420p[y];[x][y]ssim", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = /All:([\d.]+)/.exec(r.stderr ?? "");
  if (!m) throw new Error(`SSIM sin resultado: ${r.stderr}`);
  return Number(m[1]);
}

function mediaUrls(p: Project): Record<string, string> {
  return Object.fromEntries(p.media.map((m) => [m.path, `/parity-media/${encodeURIComponent(m.path.split(/[\\/]/).pop()!)}`]));
}

type Raster = { decor?: string; masks: Record<string, string>; pips: Record<string, { mask: string; shadow: string | null; width: number; height: number; x: number; y: number }> };

/** Capas generadas en el navegador (igual que la app) y escritas a disco. */
async function rasterFor(page: Page, p: Project, tag: string): Promise<Raster | null> {
  const r = await page.evaluate(
    ({ p, urls }) =>
      (window as unknown as { __snipParity: { raster: (...a: unknown[]) => Promise<{ files: { name: string; data: string }[]; decor: string | null; masks: Record<string, string>; pips: Raster["pips"] }> } }).__snipParity.raster(p, urls),
    { p, urls: mediaUrls(p) },
  );
  if (!r.files.length) return null;
  const rd = join(dir, `raster-${tag}`);
  mkdirSync(rd, { recursive: true });
  for (const f of r.files) writeFileSync(join(rd, f.name), Buffer.from(f.data, "base64"));
  const out: Raster = { masks: {}, pips: {} };
  if (r.decor) {
    writeFileSync(join(rd, "decor.ffconcat"), r.decor);
    out.decor = join(rd, "decor.ffconcat");
  }
  Object.entries(r.masks).forEach(([id, list], i) => {
    writeFileSync(join(rd, `blur${i}.ffconcat`), list);
    out.masks[id] = join(rd, `blur${i}.ffconcat`);
  });
  for (const [id, pp] of Object.entries(r.pips)) out.pips[id] = { ...pp, mask: join(rd, pp.mask), shadow: pp.shadow ? join(rd, pp.shadow) : null };
  return out;
}

async function check(page: Page, p: Project, frames: Record<string, number>, tag: string, min: number, control = false) {
  await page.route("**/parity-media/*", (route) => route.fulfill({ path: join(dir, decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!)) }));
  await page.goto("/");
  await expect(page.getByTestId("welcome-open")).toBeVisible();
  const ks = Object.values(frames);
  const exp = exportedFrames(exportProject(p, tag, await rasterFor(page, p, tag)), ks, tag);
  const prev = await previewFrames(page, p, ks, tag);
  const results = Object.keys(frames).map((label, i) => ({ label, frame: ks[i], ssim: compare(prev[i], exp[i]) }));
  for (const r of results) {
    if (r.ssim < min) {
      await test.info().attach(`${r.label}-preview.png`, { body: readFileSync(prev[ks.indexOf(r.frame)]), contentType: "image/png" });
      await test.info().attach(`${r.label}-export.png`, { body: readFileSync(exp[ks.indexOf(r.frame)]), contentType: "image/png" });
    }
  }
  console.log(`[paridad ${tag}] ` + results.map((r) => `${r.label}=${r.ssim.toFixed(3)}`).join(" "));
  // Control: el mismo cuadro del preview contra uno corrido 3 cuadros del export
  // tiene que puntuar claramente peor (si no, el SSIM no estaría midiendo nada).
  if (control) {
    const k0 = ks[ks.length - 2];
    const [shifted] = exportedFrames(join(dir, `${tag}.mp4`), [k0 + 3], `${tag}-control`);
    const c = compare(prev[ks.length - 2], shifted);
    console.log(`[paridad ${tag}] control(+3 cuadros)=${c.toFixed(3)}`);
    expect(c).toBeLessThan(results[ks.length - 2].ssim - 0.01);
  }
  expect(results.filter((r) => r.ssim < min)).toEqual([]);
}

function base(clips: [string, number, number][]): Project {
  let p = newProject(0);
  for (const [m, a, b] of clips) {
    p = insertMedia(p, [media[m]]);
    const id = p.clips[p.clips.length - 1].id;
    p = updateClip(p, id, (c) => ({ ...c, inPoint: a, outPoint: b }));
  }
  return p;
}

test("paridad: transiciones (cada tipo, a mitad de la transición)", async ({ page }) => {
  test.setTimeout(300_000);
  const kinds: TransitionKind[] = ["fade", "wipeLeft", "slideUp", "circleOpen", "zoomIn", "fadeBlack"];
  let p = base([["a.webm", 0, 2], ["b.webm", 0, 2], ["c.webm", 0, 2], ["a.webm", 1, 3], ["b.webm", 2, 4], ["c.webm", 1, 3], ["a.webm", 2, 4]]);
  kinds.forEach((kind, i) => (p = setTransition(p, p.clips[i + 1].id, { kind, duration: 0.6 })));
  const fps = canvasFps(p.canvas);
  const spans = layout(p.clips);
  const frames: Record<string, number> = { "solo-primero": 10 };
  kinds.forEach((kind, i) => {
    const s = spans[i + 1];
    frames[kind] = Math.round((s.start + 0.3) * fps);
    frames[`${kind}-después`] = Math.round((s.start + 0.9) * fps);
  });
  await check(page, p, frames, "transiciones", 0.95, true);
});

test("paridad: velocidad, encuadre con barras y fundidos de entrada/salida", async ({ page }) => {
  test.setTimeout(300_000);
  let p = base([["a.webm", 0, 4], ["c.webm", 0, 2], ["b.webm", 1, 2]]);
  p = updateClip(p, p.clips[0].id, (c) => ({ ...c, speed: 2 }));
  p = updateClip(p, p.clips[2].id, (c) => ({ ...c, speed: 0.5 }));
  p = { ...p, fades: { fadeIn: 1, fadeOut: 1 } };
  // A ×2: 0–2 s · C con barras: 2–4 s · B ×0,5: 4–6 s.
  await check(page, p, { "fundido-entrada": 9, "velocidad-x2": 40, "barras": 85, "camara-lenta": 130, "fundido-salida": 170 }, "velocidad", 0.95, true);
});

/** Aplica cambios de imagen a un clip (y reajusta el lienzo como hace el editor). */
test("paridad: rampas de velocidad (cada preset, a lo largo de la curva)", async ({ page }) => {
  test.setTimeout(400_000);
  // Cada preset en su propio proyecto: el clip arranca en un cuadro exacto (en la app
  // el preview reproduce el mismo intermedio que exporta; acá se mide la matemática).
  const cases: [string, "slowmo-middle" | "speed-up" | "slow-down", string, number][] = [
    ["lenta", "slowmo-middle", "a.webm", 4],
    ["acelera", "speed-up", "b.webm", 4],
    ["frena", "slow-down", "a.webm", 3],
  ];
  for (const [name, preset, file, len] of cases) {
    let p = base([[file, 0, len]]);
    p = updateClip(p, p.clips[0].id, (c) => ({ ...c, speedKeys: rampPreset(preset, len) }));
    const fps = canvasFps(p.canvas);
    const d = layout(p.clips)[0].duration;
    const frames: Record<string, number> = {};
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) frames[`${name}-${Math.round(f * 100)}`] = Math.round(d * f * fps);
    await check(page, p, frames, `rampa-${name}`, 0.95, name === "acelera");
  }
});

function withVideo(p: Project, i: number, v: Partial<Project["clips"][number]["video"]>): Project {
  return fitCanvas(updateClip(p, p.clips[i].id, (c) => ({ ...c, video: { ...c.video, ...v } })));
}

/** Cuadro en la mitad de cada clip. */
function midFrames(p: Project, labels: string[]): Record<string, number> {
  const fps = canvasFps(p.canvas);
  const spans = layout(p.clips);
  return Object.fromEntries(labels.map((l, i) => [l, Math.round((spans[i].start + spans[i].duration / 2) * fps)]));
}

test("paridad: rotar, voltear y recortar", async ({ page }) => {
  test.setTimeout(300_000);
  let p = base([["a.webm", 0, 1], ["b.webm", 0, 1], ["c.webm", 0, 1], ["a.webm", 1, 2]]);
  // El primer clip define el lienzo: rotado 90° y recortado → vertical.
  p = withVideo(p, 0, { rotate: 90, crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.6, aspect: null } });
  p = withVideo(p, 1, { flipH: true, flipV: true });
  p = withVideo(p, 2, { rotate: 270, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5, aspect: "1:1" } });
  p = withVideo(p, 3, { rotate: 180, flipH: true, crop: { x: 0.3, y: 0, w: 0.7, h: 1, aspect: null } });
  expect(p.canvas.width).toBeLessThan(p.canvas.height);
  await check(page, p, midFrames(p, ["rotar-recortar", "voltear", "rotar270-cuadrado", "rotar180-voltear-recortar"]), "geometria", 0.95);
});

test("paridad: ajustes de color, cada look y nitidez", async ({ page }) => {
  test.setTimeout(300_000);
  const n = LOOKS.length + 2;
  let p = base(Array.from({ length: n }, (_, i) => [["a.webm", "b.webm", "c.webm"][i % 3], (i % 6) * 0.5, (i % 6) * 0.5 + 0.5] as [string, number, number]));
  p = withVideo(p, 0, { color: { brightness: 0.3, contrast: 0.4, saturation: -0.5, temperature: 0.6, exposure: 0.2 } });
  LOOKS.forEach((l, i) => (p = withVideo(p, i + 1, { look: { id: l.id, intensity: i % 2 ? 0.7 : 1 } })));
  p = withVideo(p, n - 1, { sharpen: 0.8, color: { brightness: -0.2, contrast: -0.3, saturation: 0.6, temperature: -0.5, exposure: -0.3 } });
  await check(page, p, midFrames(p, ["ajustes", ...LOOKS.map((l) => `look-${l.id}`), "nitidez-y-ajustes"]), "color", 0.95);
});

test("paridad: zoom y paneo con keyframes", async ({ page }) => {
  test.setTimeout(300_000);
  let p = base([["a.webm", 0, 4], ["b.webm", 0, 2]]);
  p = withVideo(p, 0, {
    zoom: [
      { id: 1, t: 0.5, zoom: 1, cx: 0.5, cy: 0.5, easing: "easeInOut" },
      { id: 2, t: 2, zoom: 2.5, cx: 0.3, cy: 0.7, easing: "linear" },
      { id: 3, t: 3.5, zoom: 1.5, cx: 0.95, cy: 0.1, easing: "easeOut" },
    ],
  });
  p = withVideo(p, 1, { zoom: [{ id: 1, t: 0, zoom: 3, cx: 0.6, cy: 0.4, easing: "linear" }] });
  await check(page, p, { "antes": 10, "acercando": 35, "en-key": 60, "paneando": 80, "acotado-al-borde": 110, "zoom-fijo": 150 }, "zoom", 0.95);
});

test("paridad: textos animados, logo y subtítulos palabra por palabra", async ({ page }) => {
  test.setTimeout(300_000);
  let p = base([["a.webm", 0, 4], ["b.webm", 0, 2]]);
  [p] = addText(p, "title", 0.5); // pop de entrada (0,45 s) y fundido de salida
  [p] = addText(p, "lowerThird", 1); // fondo redondeado, deslizar
  [p] = addText(p, "impact", 3.4); // contorno
  [p] = addImage(p, media["logo.png"]);
  p = { ...p, overlays: p.overlays.map((o) => (o.type === "image" ? { ...o, opacity: 0.8, radius: 0.2, shadow: true } : o)) };
  p = setCues(p, [
    { id: "s1", start: 0.2, end: 2.2, text: "hola a todos", words: [] },
    { id: "s2", start: 2.4, end: 5.5, text: "esto es palabra por palabra", words: [
      { start: 2.4, end: 2.9, text: "esto" }, { start: 2.9, end: 3.2, text: "es" }, { start: 3.2, end: 4, text: "palabra" }, { start: 4, end: 4.6, text: "por" }, { start: 4.6, end: 5.5, text: "palabra" },
    ] },
  ]);
  p = { ...p, subtitles: { ...p.subtitles, wordByWord: true, style: { ...p.subtitles.style, background: { color: "#000000", opacity: 0.5, padding: 0.3, radius: 0.2 } } } };
  await check(page, p, { "pop-entrando": 20, "zocalo-deslizando": 35, "quieto": 50, "palabra-1": 80, "palabra-3": 110, "impacto": 108, "logo-y-saliendo": 160 }, "capas", 0.95);
});

test("paridad: zonas desenfocadas y pixeladas (con keyframes) y picture-in-picture", async ({ page }) => {
  test.setTimeout(300_000);
  let p = base([["a.webm", 0, 4], ["b.webm", 0, 2]]);
  let blur: string, pix: string, pip: string;
  [p, blur] = addBlur(p, 0.5, "blur");
  [p, pix] = addBlur(p, 1, "pixelate");
  p = updateOverlay(p, pix, (o) => (o.type === "blur" ? { ...o, strength: 0.8, rect: { x: 0.05, y: 0.55, w: 0.3, h: 0.35 } } : o));
  // La zona desenfocada sigue algo que se mueve (dos keyframes).
  p = updateOverlay(p, blur, (o) =>
    o.type === "blur"
      ? { ...o, duration: 3, keys: [{ id: 1, t: 0, rect: { x: 0.1, y: 0.1, w: 0.25, h: 0.25 } }, { id: 2, t: 3, rect: { x: 0.6, y: 0.4, w: 0.3, h: 0.3 } }] }
      : o,
  );
  [p, pip] = addPip(p, media["c.webm"], 2);
  p = updateOverlay(p, pip, (o) => (o.type === "video" ? { ...o, inPoint: 1, duration: 3, radius: 0.12 } : o));
  await check(page, p, { "solo-desenfoque": 20, "zona-moviendose": 50, "pixelado": 60, "pip-entrando": 61, "pip-y-zonas": 80, "pip-solo": 140 }, "zonas", 0.95);
});

test("paridad: chroma key en un PiP (verde con sujeto, despill y borde suave)", async ({ page }) => {
  test.setTimeout(300_000);
  let p = base([["a.webm", 0, 4]]);
  let pip: string;
  [p, pip] = addPip(p, media["verde.webm"], 0);
  p = updateOverlay(p, pip, (o) =>
    o.type === "video" ? { ...o, duration: 4, width: 0.6, x: 0.5, y: 0.5, radius: 0.05, shadow: false, chroma: { color: "#00b140", similarity: 0.12, smoothness: 0.1, despill: 0.7 } } : o,
  );
  await check(page, p, { "inicio": 5, "medio": 60, "final": 110 }, "chroma", 0.95);
  // Control: sin la llave el PiP tapa el fondo (el SSIM con el export con llave cae).
  const [keyed] = exportedFrames(join(dir, "chroma.mp4"), [60], "chroma-ctl");
  const plain = updateOverlay(p, pip, (o) => (o.type === "video" ? { ...o, chroma: null } : o));
  const [prev] = await previewFrames(page, plain, [60], "chroma-sin");
  expect(compare(prev, keyed)).toBeLessThan(0.9);
});

test("paridad: efectos de un clic (temblor, zoom punch, flash, glitch, viñeta)", async ({ page }) => {
  test.setTimeout(400_000);
  let p = base([["a.webm", 0, 4], ["b.webm", 0, 4]]);
  // Inicios fuera de la grilla de cuadros a propósito.
  const plan: [Parameters<typeof addEffect>[1], number, number, number][] = [
    ["shake", 0.21, 0.6, 1],
    ["zoomPunch", 1.07, 0.5, 0.9],
    ["flash", 2.013, 0.4, 0.8],
    ["glitch", 3.1, 0.6, 0.8],
    ["vignette", 4.25, 2, 1],
  ];
  const frames: Record<string, number> = {};
  for (const [kind, at, d, i] of plan) {
    let id: string;
    [p, id] = addEffect(p, kind, at, d);
    p = updateOverlay(p, id, (o) => (o.type === "effect" ? { ...o, intensity: i } : o));
    for (const f of [0.15, 0.5, 0.85]) frames[`${kind}-${Math.round(f * 100)}`] = Math.ceil((at + d * f) * 30);
  }
  frames["sin-efecto"] = 200;
  await check(page, p, frames, "efectos", 0.95, true);
});
