// Subtítulos .srt: leer (tolerante: BOM, CRLF, coma o punto, etiquetas HTML,
// números faltantes) y escribir.

import type { Cue } from "./model";

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const ms = Number(m[4].padEnd(3, "0"));
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** Lee un .srt. Los subtítulos sin texto o con tiempos inválidos se descartan. */
export function parseSrt(text: string, makeId: (i: number) => string = (i) => `s${i + 1}`): Cue[] {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: Cue[] = [];
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l, i, a) => !(i === a.length - 1 && !l.trim()));
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->");
    const start = parseTime(a);
    const end = parseTime(b ?? "");
    const txt = cleanText(lines.slice(ti + 1).join("\n"));
    if (start === null || end === null || end <= start || !txt) continue;
    cues.push({ id: makeId(cues.length), start, end, text: txt, words: [] });
  }
  return cues.sort((x, y) => x.start - y.start);
}

function fmt(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function formatSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join("\n");
}
