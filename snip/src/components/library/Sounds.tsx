// Pack de sonidos incluido (sintetizados por Snip, CC0): pasar el mouse los
// escucha, arrastrarlos los suelta en una pista de audio y "+" los agrega en
// el playhead.

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Add16Regular, Speaker216Regular } from "@fluentui/react-icons";
import { api, mediaSrc, type SfxInfo } from "../../lib/platform";
import { formatDuration } from "../../lib/timecode";
import { importFilesAt } from "../../store/clipboard";
import { useEditor } from "../../store/editor";
import { IconButton } from "../ui/Button";

export const SFX_MIME = "application/x-snip-sfx";

const LABELS: Record<string, string> = {
  whoosh: "Whoosh",
  swish: "Swish rápido",
  pop: "Pop",
  click: "Clic",
  impact: "Impacto",
  boom: "Explosión",
  riser: "Transición (sube)",
  ding: "Ding",
  notification: "Notificación",
  glitch: "Glitch",
};
export const sfxLabel = (name: string) => LABELS[name] ?? name;

let cached: Promise<SfxInfo[]> | null = null;
function loadSfx() {
  cached ??= api.listSfx().catch(() => ((cached = null), []));
  return cached;
}

export function Sounds() {
  const [list, setList] = useState<SfxInfo[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    void loadSfx().then(setList);
    return () => audio.current?.pause();
  }, []);
  const preview = (s: SfxInfo | null) => {
    const a = (audio.current ??= new Audio());
    a.pause();
    setPlaying(s?.path ?? null);
    if (!s) return;
    a.src = mediaSrc(s.path);
    a.currentTime = 0;
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="sounds">
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="sfx-list">
        {list.map((s, i) => (
          <motion.li key={s.path} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(0.2, i * 0.02) }}>
            <div
              className={`sfx-row group flex h-9 cursor-grab items-center gap-2 rounded-[6px] px-2 ${playing === s.path ? "is-playing" : ""}`}
              draggable
              onDragStart={(e) => {
                preview(null);
                e.dataTransfer.setData(SFX_MIME, s.path);
                e.dataTransfer.setData("text/plain", sfxLabel(s.name));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onPointerEnter={() => preview(s)}
              onPointerLeave={() => preview(null)}
              title={`${sfxLabel(s.name)} · arrastralo a una pista`}
              data-testid="sfx-item"
              data-name={s.name}
              data-playing={playing === s.path}
            >
              <Speaker216Regular className="sfx-icon shrink-0" />
              <span className="t-body min-w-0 flex-1 truncate">{sfxLabel(s.name)}</span>
              <span className="t-caption tabular text-[var(--text-tertiary)]">{formatDuration(s.duration)}</span>
              <IconButton
                label={`Agregar ${sfxLabel(s.name)} en el playhead`}
                size={24}
                onClick={() => void importFilesAt([s.path], useEditor.getState().time)}
                data-testid="sfx-add"
              >
                <Add16Regular />
              </IconButton>
            </div>
          </motion.li>
        ))}
      </ul>
      <p className="t-caption px-4 pb-3 text-[var(--text-tertiary)]" data-testid="sfx-license">
        Sintetizados por Snip · dominio público (CC0). Podés usarlos en cualquier video.
      </p>
    </div>
  );
}
