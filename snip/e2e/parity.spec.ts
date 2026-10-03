// Paridad preview ↔ exportación: el mismo proyecto se renderiza con el
// compositor WebGL del preview (sobre videos reales) y con el motor de Rust +
// FFmpeg real; se comparan cuadros exactos con SSIM. Requiere FFmpeg
// (SNIP_FFMPEG_DIR, por defecto /opt/ffmpeg9/bin) y cargo; si faltan, se saltea.

import { test, expect, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MediaRef, Project, TransitionKind } from "../src/project/model";
import { canvasFps } from "../src/project/model";
import { insertMedia, newProject, setTransition, updateClip } from "../src/project/ops";
import { layout } from "../src/project/timeline";

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
});

test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function exportProject(p: Project, name: string): string {
  const out = join(dir, `${name}.mp4`);
  const job = join(dir, `${name}.json`);
  writeFileSync(job, JSON.stringify({ project: p, output: out, saveProject: false }));
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
  const urls = Object.fromEntries(p.media.map((m) => [m.path, `/parity-media/${encodeURIComponent(m.path.split(/[\\/]/).pop()!)}`]));
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

async function check(page: Page, p: Project, frames: Record<string, number>, tag: string, min: number) {
  await page.route("**/parity-media/*", (route) => route.fulfill({ path: join(dir, decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!)) }));
  await page.goto("/");
  await expect(page.getByTestId("welcome-open")).toBeVisible();
  const ks = Object.values(frames);
  const exp = exportedFrames(exportProject(p, tag), ks, tag);
  const prev = await previewFrames(page, p, ks, tag);
  const results = Object.keys(frames).map((label, i) => ({ label, frame: ks[i], ssim: compare(prev[i], exp[i]) }));
  for (const r of results) {
    if (r.ssim < min) {
      await test.info().attach(`${r.label}-preview.png`, { body: readFileSync(prev[ks.indexOf(r.frame)]), contentType: "image/png" });
      await test.info().attach(`${r.label}-export.png`, { body: readFileSync(exp[ks.indexOf(r.frame)]), contentType: "image/png" });
    }
  }
  // Control: el mismo cuadro del preview contra uno corrido 3 cuadros del export
  // tiene que puntuar claramente peor (si no, el SSIM no estaría midiendo nada).
  const k0 = ks[ks.length - 2];
  const [shifted] = exportedFrames(join(dir, `${tag}.mp4`), [k0 + 3], `${tag}-control`);
  const control = compare(prev[ks.length - 2], shifted);
  console.log(`[paridad ${tag}] control(+3 cuadros)=${control.toFixed(3)}`);
  expect(control).toBeLessThan(results[ks.length - 2].ssim - 0.01);
  console.log(`[paridad ${tag}] ` + results.map((r) => `${r.label}=${r.ssim.toFixed(3)}`).join(" "));
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
  await check(page, p, frames, "transiciones", 0.95);
});

test("paridad: velocidad, encuadre con barras y fundidos de entrada/salida", async ({ page }) => {
  test.setTimeout(300_000);
  let p = base([["a.webm", 0, 4], ["c.webm", 0, 2], ["b.webm", 1, 2]]);
  p = updateClip(p, p.clips[0].id, (c) => ({ ...c, speed: 2 }));
  p = updateClip(p, p.clips[2].id, (c) => ({ ...c, speed: 0.5 }));
  p = { ...p, fades: { fadeIn: 1, fadeOut: 1 } };
  // A ×2: 0–2 s · C con barras: 2–4 s · B ×0,5: 4–6 s.
  await check(page, p, { "fundido-entrada": 9, "velocidad-x2": 40, "barras": 85, "camara-lenta": 130, "fundido-salida": 170 }, "velocidad", 0.95);
});
