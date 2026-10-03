// Paridad de audio preview ↔ exportación: "Mejorar voz" con los filtros de
// WebAudio del preview (OfflineAudioContext) y con FFmpeg real en la
// exportación; se compara el nivel de cada tono (Goertzel en los dos lados).

import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Project, VoiceEnhance } from "../src/project/model";
import { goertzelDb } from "../src/mocks/parity";

const FF_DIR = process.env.SNIP_FFMPEG_DIR ?? "/opt/ffmpeg9/bin";
const FFMPEG = join(FF_DIR, "ffmpeg");
const MANIFEST = resolve(process.cwd(), "src-tauri/core/Cargo.toml");
test.skip(!existsSync(FFMPEG) || !!process.env.SNIP_SKIP_INTEGRATION, "Sin FFmpeg: paridad salteada");

const FREQS = [60, 300, 1000, 3500, 9000];
const AMP = 0.01; // −43 dBFS por tono: debajo del umbral del compresor (solo se compara el EQ)
const SECS = 4;

const ff = (args: string[]) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 28 });
const snipRender = (args: string[]) =>
  execFileSync("cargo", ["run", "-q", "--example", "snip_render", "--manifest-path", MANIFEST, "--", ...args], {
    encoding: "utf8",
    env: { ...process.env, SNIP_FFMPEG_DIR: FF_DIR },
    maxBuffer: 1 << 26,
  });

let dir = "";
test.beforeAll(() => {
  test.setTimeout(300_000);
  dir = mkdtempSync(join(tmpdir(), "snip-audio-parity-"));
  const expr = FREQS.map((f) => `${AMP}*sin(2*PI*${f}*t)`).join("+");
  ff(["-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=${SECS}`, "-c:a", "pcm_f32le", join(dir, "tonos.wav")]);
  ff(["-f", "lavfi", "-i", `testsrc2=s=320x240:r=30:d=${SECS}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", join(dir, "v.mp4")]);
});
test.afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

/** Exporta un proyecto con los tonos como clip de audio y devuelve el nivel de cada tono. */
function exportLevels(enhance: VoiceEnhance | null, tag: string): number[] {
  const v = JSON.parse(snipRender(["probe", join(dir, "v.mp4"), "m1"]));
  const a = JSON.parse(snipRender(["probe", join(dir, "tonos.wav"), "m2"]));
  const p = {
    version: 1, id: "p", name: "audio", media: [v, a],
    clips: [{ id: "c1", mediaId: "m1", inPoint: 0, outPoint: SECS, audio: { volume: 1, muted: true } }],
    music: [{ id: "a1", mediaId: "m2", start: 0, inPoint: 0, outPoint: SECS, volume: 1, fadeIn: 0, fadeOut: 0, ducking: false, enhance }],
    canvas: { width: 320, height: 240, fpsNum: 30, fpsDen: 1 },
    export: { format: "mkv", mode: "precise" },
  } as unknown as Project;
  const out = join(dir, `${tag}.mkv`);
  writeFileSync(join(dir, `${tag}.json`), JSON.stringify({ project: p, output: out, saveProject: false }));
  snipRender(["export", join(dir, `${tag}.json`), join(dir, "work")]);
  const pcm = ff(["-i", out, "-map", "0:a:0", "-ac", "1", "-f", "f32le", "-"]);
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const win = x.subarray(48000, x.length - 48000);
  return FREQS.map((f) => goertzelDb(win, 48000, f));
}

test("Mejorar voz suena igual en el preview y en la exportación", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?theme=dark");
  await page.waitForFunction(() => !!window.__snipParity);
  for (const amount of [0.3, 1]) {
    const enhance: VoiceEnhance = { amount, loudness: { inputI: -36, inputTp: -30, inputLra: 1, inputThresh: -46, targetOffset: 0 } };
    const prev = await page.evaluate(({ e, f, a, s }) => window.__snipParity.voice(e, f, a, s), { e: enhance, f: FREQS, a: AMP, s: SECS });
    const exp = exportLevels(enhance, `voz${amount}`);
    const raw = exportLevels(null, `cruda${amount}`);
    const fmt = (l: number[]) => l.map((v) => v.toFixed(1)).join(" ");
    console.log(`[paridad audio] intensidad ${amount}\n  cruda    ${fmt(raw)}\n  preview  ${fmt(prev)}\n  export   ${fmt(exp)}`);
    // Mismo resultado por tono (±1,5 dB; el AAC y la reducción de ruido explican lo que queda).
    FREQS.forEach((f, i) => expect(Math.abs(prev[i] - exp[i]), `${f} Hz`).toBeLessThan(1.5));
    // Y el efecto se nota: el zumbido de 60 Hz baja respecto de la presencia.
    expect(exp[3] - exp[0] - (raw[3] - raw[0])).toBeGreaterThan(amount * 6);
  }
});
