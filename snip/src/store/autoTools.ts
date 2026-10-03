// Herramientas automáticas: pide el análisis de audio a Rust (cacheado), corre
// los algoritmos de project/autoTools.ts y aplica el resultado como una edición.

import type { Project } from "../project/model";
import {
  cutSilences,
  decodeAnalysis,
  detectPlays,
  findSilences,
  musicBeats,
  playRanges,
  setAutoMarkers,
  timelineLevel,
  type Analysis,
} from "../project/autoTools";
import { api } from "../lib/platform";
import { activeProject, edit, pushToast, useEditor } from "./editor";

const cache = new Map<string, Promise<Analysis>>();

function analysisFor(path: string, tracks: number): Promise<Analysis> {
  const key = `${path}#${tracks}`;
  let a = cache.get(key);
  if (!a) {
    a = api.analyzeAudio(path, tracks).then(decodeAnalysis);
    a.catch(() => cache.delete(key));
    cache.set(key, a);
  }
  return a;
}

/** Análisis de los medios que usan los clips (o la música) del proyecto. */
async function analyses(p: Project, ids: Set<string>): Promise<Map<string, Analysis>> {
  const out = new Map<string, Analysis>();
  for (const m of p.media) {
    if (!ids.has(m.id) || !m.hasAudio) continue;
    out.set(m.id, await analysisFor(m.path, m.audioTracks ?? 1));
  }
  return out;
}

async function busy<T>(what: string, f: () => Promise<T>): Promise<T | null> {
  useEditor.setState({ autoBusy: what });
  try {
    return await f();
  } catch (e) {
    pushToast({ severity: "critical", title: "No se pudo analizar el audio", message: String((e as { message?: string })?.message ?? e) });
    return null;
  } finally {
    useEditor.setState({ autoBusy: null });
  }
}

export interface PlayOptions {
  sensitivity: number;
  /** Crear fragmentos (rangos exportables) de ±pad segundos; null = solo marcadores. */
  pad: number | null;
}

export async function runDetectPlays(o: PlayOptions): Promise<number> {
  const p = activeProject();
  if (!p?.clips.length) return 0;
  const found = await busy("plays", async () => {
    const an = await analyses(p, new Set(p.clips.map((c) => c.mediaId)));
    return detectPlays(timelineLevel(p, (id) => an.get(id)), 100, o.sensitivity);
  });
  if (!found) return 0;
  edit((q) => {
    let r = setAutoMarkers(q, "play", found, (i) => `Jugada ${i + 1}`);
    if (o.pad !== null) r = playRanges(r, found, o.pad);
    return r;
  });
  pushToast({ severity: found.length ? "success" : "info", title: found.length ? `${found.length} ${found.length === 1 ? "jugada marcada" : "jugadas marcadas"}` : "No encontramos jugadas: probá con más sensibilidad" });
  return found.length;
}

export interface SilenceOptions {
  thresholdDb: number;
  minDuration: number;
  margin: number;
}

/** Busca los silencios y los muestra en el timeline (todavía no corta nada). */
export async function previewSilences(o: SilenceOptions): Promise<number> {
  const p = activeProject();
  if (!p?.clips.length) return 0;
  const found = await busy("silences", async () => {
    const an = await analyses(p, new Set(p.clips.map((c) => c.mediaId)));
    return findSilences(timelineLevel(p, (id) => an.get(id)), 100, o.thresholdDb, o.minDuration, o.margin);
  });
  useEditor.setState({ silencePreview: { project: p, intervals: found ?? [] } });
  return found?.length ?? 0;
}

/** Silencios a la vista, si el proyecto no cambió desde que se buscaron. */
export function currentSilences(p: Project | null, prev = useEditor.getState().silencePreview): [number, number][] | null {
  return prev && p && prev.project === p ? prev.intervals : null;
}

export function applySilences() {
  const s = currentSilences(activeProject());
  if (!s?.length) {
    useEditor.setState({ silencePreview: null });
    return;
  }
  edit((p) => cutSilences(p, s));
  useEditor.setState({ silencePreview: null });
  pushToast({ severity: "success", title: `${s.length} ${s.length === 1 ? "silencio cortado" : "silencios cortados"}`, message: "Ctrl+Z lo deshace." });
}

export function cancelSilences() {
  useEditor.setState({ silencePreview: null });
}

export async function markBeats(): Promise<number> {
  const p = activeProject();
  if (!p?.music.length) return 0;
  const found = await busy("beats", async () => {
    const an = await analyses(p, new Set(p.music.map((m) => m.mediaId)));
    return musicBeats(p, (id) => an.get(id));
  });
  if (!found) return 0;
  edit((q) => setAutoMarkers(q, "beat", found, () => ""));
  pushToast({ severity: found.length ? "success" : "info", title: found.length ? `${found.length} beats marcados` : "No encontramos un ritmo claro en la música" });
  return found.length;
}

export function clearAutoMarkers(kind: "play" | "beat") {
  edit((p) => setAutoMarkers(p, kind, [], () => ""));
}
