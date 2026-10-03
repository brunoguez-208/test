import { AnimatePresence, motion } from "motion/react";
import { Delete16Regular, MusicNote220Regular, MusicNote216Regular, ArrowExport20Regular } from "@fluentui/react-icons";
import type { Clip, MusicClip, Project } from "../../project/model";
import { MAX_CLIP_VOLUME } from "../../project/model";
import { deleteClips, updateClip, updateMusic } from "../../project/ops";
import { clipDuration } from "../../project/timeline";
import { basename } from "../../lib/files";
import { edit, gestureEnd, gestureStart, setSelection } from "../../store/editor";
import { addMusicWithDialog, extractAudio, setNormalize } from "../../store/controller";
import { Button } from "../ui/Button";
import { RangeSlider } from "../ui/RangeSlider";
import { Toggle } from "../ui/Toggle";
import { Select } from "../ui/Select";
import { Field, Section, fmtNum } from "./Field";
import { useSelectedMusic, useTargetClip } from "./useTarget";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function ClipAudioSection({ clip, project }: { clip: Clip; project: Project }) {
  const media = project.media.find((m) => m.id === clip.mediaId);
  const set = (f: (c: Clip) => Clip) => edit((p) => updateClip(p, clip.id, f));
  const a = clip.audio;
  const dur = clipDuration(clip);
  if (!media?.hasAudio || clip.kind === "freeze") {
    return (
      <Section title="Audio del clip">
        <p className="t-caption text-[var(--text-secondary)]">{clip.kind === "freeze" ? "Un cuadro congelado no tiene sonido." : "Este clip no tiene audio."}</p>
      </Section>
    );
  }
  const off = a.removed || a.muted;
  const tracks = media.audioTracks ?? 1;
  return (
    <Section title="Audio del clip" testId="clip-audio">
      {tracks > 1 && (
        <Field label="Pistas de audio" hint="Las grabaciones de NVIDIA guardan el juego y el micrófono por separado. Por defecto suenan las dos.">
          <Select<string>
            label="Pistas de audio"
            value={a.track == null ? "mix" : String(a.track)}
            options={[
              { value: "mix", label: `Mezclar las ${tracks}` },
              ...Array.from({ length: tracks }, (_, i) => ({ value: String(i), label: `Solo la pista ${i + 1}`, hint: i === 0 ? "juego / sistema" : i === 1 ? "micrófono" : undefined })),
            ]}
            onChange={(v) => set((c) => ({ ...c, audio: { ...c.audio, track: v === "mix" ? undefined : Number(v) } }))}
            testId="clip-audio-track-select"
          />
        </Field>
      )}
      <Field label="Volumen" aside={<span className="t-caption tabular text-[var(--text-secondary)]" data-testid="volume-value">{pct(a.volume)}</span>}>
        <RangeSlider
          label="Volumen del clip"
          value={a.volume}
          min={0}
          max={MAX_CLIP_VOLUME}
          step={0.05}
          resetTo={1}
          origin={1}
          disabled={off}
          onStart={gestureStart}
          onEnd={gestureEnd}
          onChange={(v) => set((c) => ({ ...c, audio: { ...c.audio, volume: v } }))}
          testId="clip-volume"
        />
      </Field>
      <Field inline label="Silenciar" hint="El clip suena en silencio.">
        <Toggle checked={a.muted} onChange={(v) => set((c) => ({ ...c, audio: { ...c.audio, muted: v } }))} label="Silenciar" testId="mute-toggle" />
      </Field>
      <Field inline label="Quitar el audio" hint="Si ningún clip tiene audio, el archivo sale sin pista de sonido.">
        <Toggle checked={a.removed} onChange={(v) => set((c) => ({ ...c, audio: { ...c.audio, removed: v } }))} label="Quitar el audio" testId="remove-audio-toggle" />
      </Field>
      <div className={`grid grid-cols-2 gap-3 ${off ? "pointer-events-none opacity-40" : ""}`}>
        <Field label="Fade in" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(a.fadeIn)} s</span>}>
          <RangeSlider label="Fade in" value={a.fadeIn} min={0} max={Math.min(5, dur)} step={0.1} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set((c) => ({ ...c, audio: { ...c.audio, fadeIn: v } }))} testId="fade-in" />
        </Field>
        <Field label="Fade out" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(a.fadeOut)} s</span>}>
          <RangeSlider label="Fade out" value={a.fadeOut} min={0} max={Math.min(5, dur)} step={0.1} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set((c) => ({ ...c, audio: { ...c.audio, fadeOut: v } }))} testId="fade-out" />
        </Field>
      </div>
      <Field inline label="Normalizar" hint={a.normalize ? `Se lleva a −14 LUFS (estaba en ${fmtNum(a.normalize.inputI)} LUFS).` : "Iguala el volumen al de las redes (−14 LUFS)."}>
        <Toggle checked={!!a.normalize} onChange={(v) => void setNormalize(clip.id, v)} label="Normalizar" testId="normalize-toggle" />
      </Field>
      <Field inline label="Reducir ruido" hint="Saca zumbidos y ruido de fondo. Se procesa aparte.">
        <Toggle checked={a.denoise} onChange={(v) => set((c) => ({ ...c, audio: { ...c.audio, denoise: v } }))} label="Reducir ruido" testId="denoise-toggle" />
      </Field>
    </Section>
  );
}

function MusicSection({ mu, project }: { mu: MusicClip; project: Project }) {
  const media = project.media.find((m) => m.id === mu.mediaId);
  const set = (f: (m: MusicClip) => MusicClip) => edit((p) => updateMusic(p, mu.id, f));
  const len = mu.outPoint - mu.inPoint;
  return (
    <Section title="Música" testId="music-section">
      <div className="flex items-center gap-2">
        <span className="music-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px]">
          <MusicNote216Regular />
        </span>
        <p className="t-body min-w-0 flex-1 truncate">{media ? basename(media.path) : "Música"}</p>
        <Button
          variant="subtle"
          className="!h-8 !px-2"
          icon={<Delete16Regular />}
          onClick={() => {
            edit((p) => deleteClips(p, [mu.id]));
            setSelection([]);
          }}
          data-testid="music-delete"
        >
          Quitar
        </Button>
      </div>
      <Field label="Volumen" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{pct(mu.volume)}</span>}>
        <RangeSlider label="Volumen de la música" value={mu.volume} min={0} max={MAX_CLIP_VOLUME} step={0.05} resetTo={0.6} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set((m) => ({ ...m, volume: v }))} testId="music-volume" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fade in" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(mu.fadeIn)} s</span>}>
          <RangeSlider label="Fade in de la música" value={mu.fadeIn} min={0} max={Math.min(10, len)} step={0.1} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set((m) => ({ ...m, fadeIn: v }))} />
        </Field>
        <Field label="Fade out" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(mu.fadeOut)} s</span>}>
          <RangeSlider label="Fade out de la música" value={mu.fadeOut} min={0} max={Math.min(10, len)} step={0.1} resetTo={1.5} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set((m) => ({ ...m, fadeOut: v }))} />
        </Field>
      </div>
      <Field inline label="Bajar con la voz" hint="La música baja sola cuando suena el audio del video.">
        <Toggle checked={mu.ducking} onChange={(v) => set((m) => ({ ...m, ducking: v }))} label="Bajar la música con la voz" testId="ducking-toggle" />
      </Field>
    </Section>
  );
}

export function AudioTab({ project }: { project: Project }) {
  const { clip } = useTargetClip(project);
  const music = useSelectedMusic(project);
  return (
    <div className="flex flex-col gap-6" data-testid="audio-tab">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={music ? `m-${music.id}` : `c-${clip?.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {music ? <MusicSection mu={music} project={project} /> : clip ? <ClipAudioSection clip={clip} project={project} /> : null}
        </motion.div>
      </AnimatePresence>
      <Section title="Pista de música">
        <Button icon={<MusicNote220Regular />} onClick={() => void addMusicWithDialog()} data-testid="add-music-inspector">
          Agregar música
        </Button>
        {project.music.length > 0 && !music && (
          <p className="t-caption text-[var(--text-secondary)]">Tocá un clip de música en el timeline para ajustar su volumen, fades y ducking.</p>
        )}
      </Section>
      <Section title="Extraer">
        <Button icon={<ArrowExport20Regular />} onClick={() => void extractAudio()} disabled={!project.clips.length} data-testid="extract-mp3">
          Extraer el audio a MP3
        </Button>
      </Section>
    </div>
  );
}
