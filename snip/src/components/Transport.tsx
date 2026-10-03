import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRepeatAll20Regular,
  Next20Filled,
  Pause24Filled,
  Play24Filled,
  Previous20Filled,
  Speaker220Regular,
  Speaker120Regular,
  Speaker020Regular,
  SpeakerMute20Regular,
} from "@fluentui/react-icons";
import { useSnip } from "../store/snip";
import { stepFrames, togglePlay } from "../lib/playback";
import { secondsToTimecode } from "../lib/timecode";
import { IconButton } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { Slider } from "./ui/Slider";

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <SpeakerMute20Regular />;
  if (volume < 0.34) return <Speaker020Regular />;
  if (volume < 0.67) return <Speaker120Regular />;
  return <Speaker220Regular />;
}

/** Controles de reproducción debajo del preview. */
export function Transport() {
  const media = useSnip((s) => s.media);
  const current = useSnip((s) => s.current);
  const playing = useSnip((s) => s.playing);
  const loop = useSnip((s) => s.loop);
  const toggleLoop = useSnip((s) => s.toggleLoop);
  const volume = useSnip((s) => s.volume);
  const muted = useSnip((s) => s.muted);
  const setVolume = useSnip((s) => s.setVolume);
  const toggleMute = useSnip((s) => s.toggleMute);
  if (!media) return null;
  const fps = media.fps;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-1" data-testid="transport">
      <div className="t-body tabular flex items-baseline gap-1.5">
        <span className="text-[var(--text-primary)]" data-testid="current-tc">
          {secondsToTimecode(current, fps)}
        </span>
        <span className="text-[var(--text-tertiary)]">/ {secondsToTimecode(media.duration, fps)}</span>
      </div>

      <div className="flex items-center gap-2">
        <Tooltip content={<>Cuadro anterior <kbd className="kbd ml-1">←</kbd></>}>
          <IconButton label="Cuadro anterior" onClick={() => stepFrames(-1)} size={36}>
            <Previous20Filled />
          </IconButton>
        </Tooltip>
        <Tooltip content={<>{playing ? "Pausa" : "Reproducir"} <kbd className="kbd ml-1">Espacio</kbd></>}>
          <motion.button
            type="button"
            aria-label={playing ? "Pausa" : "Reproducir"}
            onClick={() => togglePlay()}
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            className="btn-accent relative flex h-10 w-10 items-center justify-center rounded-full outline-none"
            data-testid="play-toggle"
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
          <IconButton label="Cuadro siguiente" onClick={() => stepFrames(1)} size={36}>
            <Next20Filled />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex items-center justify-end gap-1">
        <Tooltip content={loop ? "Loop activado" : "Repetir el recorte en loop"}>
          <IconButton label="Loop" active={loop} onClick={toggleLoop} data-testid="loop-toggle">
            <ArrowRepeatAll20Regular />
          </IconButton>
        </Tooltip>
        <div className="ml-1 flex items-center gap-1">
          <Tooltip content={muted ? "Activar sonido" : "Silenciar"}>
            <IconButton label={muted ? "Activar sonido" : "Silenciar"} onClick={toggleMute} disabled={!media.hasAudio}>
              <VolumeIcon volume={volume} muted={muted || !media.hasAudio} />
            </IconButton>
          </Tooltip>
          {media.hasAudio && <Slider value={muted ? 0 : volume} onChange={setVolume} label="Volumen" width={88} />}
        </div>
      </div>
    </div>
  );
}
