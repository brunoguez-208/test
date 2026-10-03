import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRepeatAll20Regular,
  Camera20Regular,
  Next20Filled,
  Pause24Filled,
  Play24Filled,
  Previous20Filled,
  Speaker220Regular,
  Speaker120Regular,
  Speaker020Regular,
  SpeakerMute20Regular,
} from "@fluentui/react-icons";
import { activeTab, saveVolume, useEditor } from "../store/editor";
import { player, saveFramePng } from "../store/controller";
import { secondsToTimecode } from "../lib/timecode";
import { canvasFps, type Project } from "../project/model";
import { totalDuration } from "../project/timeline";
import { IconButton } from "./ui/Button";
import { GoToTime } from "./GoToTime";
import { Tooltip } from "./ui/Tooltip";
import { Slider } from "./ui/Slider";

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <SpeakerMute20Regular />;
  if (volume < 0.34) return <Speaker020Regular />;
  if (volume < 0.67) return <Speaker120Regular />;
  return <Speaker220Regular />;
}

/** Controles de reproducción debajo del preview. */
export function Transport({ project }: { project: Project }) {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  const volume = useEditor((s) => s.volume);
  const muted = useEditor((s) => s.muted);
  const tab = useEditor((s) => activeTab(s));
  const fps = canvasFps(project.canvas);
  const total = totalDuration(project);
  const hasRange = !!tab && (tab.markIn !== null || tab.markOut !== null);

  const setVolume = (v: number) => {
    const m = v === 0;
    useEditor.setState({ volume: v, muted: m });
    player().setVolume(v, m);
    saveVolume(v, m);
  };
  const toggleMute = () => {
    const next = !muted;
    const vol = !next && volume === 0 ? 0.5 : volume;
    useEditor.setState({ muted: next, volume: vol });
    player().setVolume(vol, next);
    saveVolume(vol, next);
  };
  const toggleLoop = () => {
    const next = !loop;
    useEditor.setState({ loop: next });
    const t = activeTab();
    player().loop = next ? [t?.markIn ?? 0, t?.markOut ?? total] : null;
  };

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-1" data-testid="transport">
      <div className="t-body tabular flex items-baseline gap-1.5">
        <GoToTime value={time} fps={fps} onSeek={(t) => player().seek(t)} />
        <span className="text-[var(--text-tertiary)]" data-testid="total-tc">/ {secondsToTimecode(total, fps)}</span>
      </div>

      <div className="flex items-center gap-2">
        <Tooltip content={<>Cuadro anterior <kbd className="kbd ml-1">←</kbd></>}>
          <IconButton label="Cuadro anterior" onClick={() => player().step(-1)} size={36}>
            <Previous20Filled />
          </IconButton>
        </Tooltip>
        <Tooltip content={<>{playing ? "Pausa" : "Reproducir"} <kbd className="kbd ml-1">Espacio</kbd></>}>
          <motion.button
            type="button"
            aria-label={playing ? "Pausa" : "Reproducir"}
            onClick={() => player().toggle()}
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            className="btn-accent relative flex h-10 w-10 items-center justify-center rounded-full outline-none"
            data-testid="play-toggle"
            disabled={!project.clips.length}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={playing ? "pause" : "play"}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="flex text-[22px]"
              >
                {playing ? <Pause24Filled /> : <Play24Filled className="ml-0.5" />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </Tooltip>
        <Tooltip content={<>Cuadro siguiente <kbd className="kbd ml-1">→</kbd></>}>
          <IconButton label="Cuadro siguiente" onClick={() => player().step(1)} size={36}>
            <Next20Filled />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex items-center justify-end gap-1">
        <Tooltip content="Guardar este cuadro como PNG">
          <IconButton label="Guardar cuadro como PNG" onClick={() => void saveFramePng()} disabled={!project.clips.length} data-testid="save-png">
            <Camera20Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content={loop ? "Loop activado" : hasRange ? "Repetir el rango I/O" : "Repetir todo"}>
          <IconButton label="Loop" active={loop} onClick={toggleLoop} data-testid="loop-toggle">
            <ArrowRepeatAll20Regular />
          </IconButton>
        </Tooltip>
        <div className="ml-1 flex items-center gap-1">
          <Tooltip content={muted ? "Activar sonido" : "Silenciar"}>
            <IconButton label={muted ? "Activar sonido" : "Silenciar"} onClick={toggleMute}>
              <VolumeIcon volume={volume} muted={muted} />
            </IconButton>
          </Tooltip>
          <Slider value={muted ? 0 : volume} onChange={setVolume} label="Volumen" width={88} />
        </div>
      </div>
    </div>
  );
}
