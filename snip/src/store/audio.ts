// Acciones de audio del editor: separar / unir audio, "Mejorar voz" (con la
// medición de nivel para llevar la voz a −16 LUFS) y el menú contextual.

import { api } from "../lib/platform";
import type { MenuEntry } from "../components/ui/ContextMenu";
import { canJoin, canSeparate, joinAudio, separateAudio, setEnhance } from "../project/audioOps";
import { DEFAULT_VOICE_AMOUNT } from "../engine/audioFx";
import type { Loudness, Project, VoiceEnhance } from "../project/model";
import { activeProject, activeTab, edit, pushToast, setSelection } from "./editor";
import { notifyEditError, notifyError } from "./controller";

export function separateSelection(ids = activeTab()?.selection ?? []) {
  try {
    let created: string[] = [];
    edit((p) => {
      const [q, n] = separateAudio(p, ids);
      created = n;
      return q;
    });
    setSelection(created);
    pushToast({ severity: "success", title: "Audio separado", message: "Ahora se edita en su propia pista. «Unir audio» lo vuelve a pegar." });
  } catch (e) {
    notifyEditError(e);
  }
}

export function joinSelection(ids = activeTab()?.selection ?? []) {
  try {
    edit((p) => joinAudio(p, ids));
    setSelection([]);
  } catch (e) {
    notifyEditError(e);
  }
}

/** Tramo de audio (archivo, inicio, largo) de un clip o un clip de audio. */
function source(p: Project, id: string): { path: string; start: number; dur: number } | null {
  const c = p.clips.find((x) => x.id === id);
  const mu = p.music.find((x) => x.id === id);
  const mediaId = c?.mediaId ?? mu?.mediaId;
  const m = p.media.find((x) => x.id === mediaId);
  if (!m) return null;
  if (c) return { path: m.path, start: c.inPoint, dur: Math.max(0.1, c.outPoint - c.inPoint) };
  if (mu) return { path: m.path, start: mu.inPoint, dur: Math.max(0.1, mu.outPoint - mu.inPoint) };
  return null;
}

/**
 * "Mejorar voz" con un clic. Mide el nivel del tramo (una vez) para que la
 * voz quede pareja; la intensidad se ajusta después con el control.
 */
export async function setVoiceEnhance(ids: string[], on: boolean, amount = DEFAULT_VOICE_AMOUNT) {
  const p = activeProject();
  if (!p || !ids.length) return;
  if (!on) {
    edit((q) => setEnhance(q, ids, null));
    return;
  }
  // Primero se aplica (el preview ya suena distinto) y después se suma la medición.
  const existing = (id: string) => p.clips.find((c) => c.id === id)?.audio.enhance ?? p.music.find((m) => m.id === id)?.enhance ?? null;
  edit((q) => {
    let r = q;
    for (const id of ids) r = setEnhance(r, [id], { amount, loudness: existing(id)?.loudness ?? null });
    return r;
  });
  for (const id of ids) {
    if (existing(id)?.loudness) continue;
    const src = source(p, id);
    if (!src) continue;
    try {
      const l: Loudness = await api.analyzeLoudness(src.path, src.start, src.dur);
      edit((q) => {
        const cur = q.clips.find((c) => c.id === id)?.audio.enhance ?? q.music.find((m) => m.id === id)?.enhance;
        return cur ? setEnhance(q, [id], { ...cur, loudness: l }) : q;
      });
    } catch (e) {
      notifyError("No se pudo medir el nivel de la voz", e);
    }
  }
}

export function setVoiceAmount(ids: string[], e: VoiceEnhance, amount: number) {
  edit((q) => setEnhance(q, ids, { ...e, amount }));
}

/** Entradas extra del menú contextual para clips con audio. */
export function audioMenu(id: string): MenuEntry[] {
  const p = activeProject();
  if (!p) return [];
  const sel = activeTab()?.selection.includes(id) ? activeTab()!.selection : [id];
  const isClip = p.clips.some((c) => c.id === id);
  const isMusic = p.music.some((m) => m.id === id);
  if (!isClip && !isMusic) return [];
  const enhanced = p.clips.find((c) => c.id === id)?.audio.enhance ?? p.music.find((m) => m.id === id)?.enhance;
  const out: MenuEntry[] = [];
  if (isClip && canSeparate(p, id)) out.push({ label: "Separar audio", run: () => separateSelection(sel), testId: "menu-separate-audio" });
  if (canJoin(p, sel)) out.push({ label: "Unir audio", run: () => joinSelection(sel), testId: "menu-join-audio" });
  out.push({
    label: enhanced ? "Quitar «Mejorar voz»" : "Mejorar voz",
    run: () => void setVoiceEnhance(sel, !enhanced),
    testId: "menu-enhance-voice",
  });
  return out;
}
