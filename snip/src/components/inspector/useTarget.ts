import { activeTab, useEditor } from "../../store/editor";
import { activeAt, layout } from "../../project/timeline";
import type { Clip, MusicClip, Project } from "../../project/model";

/** Clip sobre el que actúa el inspector: el seleccionado, o el que está bajo el playhead. */
export function useTargetClip(project: Project): { clip: Clip | null; index: number; explicit: boolean } {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const time = useEditor((s) => s.time);
  const sel = project.clips.findIndex((c) => selection.includes(c.id));
  if (sel >= 0) return { clip: project.clips[sel], index: sel, explicit: true };
  const f = activeAt(layout(project.clips), time);
  if (!f) return { clip: null, index: -1, explicit: false };
  const i = f.b ?? f.a;
  return { clip: project.clips[i], index: i, explicit: false };
}

export function useSelectedMusic(project: Project): MusicClip | null {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  return project.music.find((m) => selection.includes(m.id)) ?? null;
}
