import { AutoSection } from "./AutoSection";
import { AnimatePresence, motion } from "motion/react";
import { Delete16Regular, MusicNote220Regular, MusicNote216Regular, ArrowExport20Regular, ArrowSplit20Regular, ArrowJoin20Regular } from "@fluentui/react-icons";
import type { Clip, MusicClip, Project, TrackState, VoiceEnhance } from "../../project/model";
import { audioTrackName, canSeparate, setTrackState, trackState, type TrackRef } from "../../project/audioOps";
import { DEFAULT_VOICE_AMOUNT } from "../../engine/audioFx";
import { joinSelection, separateSelection, setVoiceAmount, setVoiceEnhance } from "../../store/audio";
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

/** "Mejorar voz" con un clic + intensidad (igual en clips de video y de audio). */
function VoiceField({ id, enhance }: { id: string; enhance: VoiceEnhance | null | undefined }) {
  return (
    <>
      <Field inline label="Mejorar voz" hint="Saca graves y ruido, da presencia, comprime y lleva la voz a un nivel parejo. Ideal para micrófono.">
        <Toggle checked={!!enhance} onChange={(v) => void setVoiceEnhance([id], v)} label="Mejorar voz" testId="voice-toggle" />
      </Field>
      {enhance && (
        <Field label="Intensidad" aside={<span className="t-caption tabular text-[var(--text-secondary)]" data-testid="voice-amount-value">{pct(enhance.amount)}</span>}>
          <RangeSlider
            label="Intensidad de mejorar voz"
            value={enhance.amount}
            min={0}
            max={1}
            step={0.05}
            resetTo={DEFAULT_VOICE_AMOUNT}
            onStart={gestureStart}
            onEnd={gestureEnd}
            onChange={(v) => setVoiceAmount([id], enhance, v)}
            testId="voice-amount"
          />
          {!enhance.loudness && <span className="t-caption text-[var(--text-tertiary)]">Midiendo el nivel…</span>}
        </Field>
      )}
    </>
  );
}

/** Volumen, silenciar y solo de cada pista de audio (y nombre). */
function TracksSection({ project }: { project: Project }) {
  const rows = Math.max(1, ...project.music.map((m) => (m.track ?? 0) + 1));
  const list: { r: TrackRef; name: string; id: string }[] = [
    { r: { kind: "videoAudio" }, name: "Audio del video", id: "video-audio" },
    ...Array.from({ length: project.music.length ? rows : 0 }, (_, i) => ({ r: { kind: "audio", index: i } as TrackRef, name: audioTrackName(project, i), id: `audio-${i}` })),
  ];
  return (
    <Section title="Pistas de audio" testId="tracks-section">
      {list.map(({ r, name, id }) => {
        const st = trackState(project, r);
        const set = (patch: Partial<TrackState>) => edit((p) => setTrackState(p, r, patch));
        return (
          <div key={id} className="flex flex-col gap-1.5" data-testid={`track-row-${id}`}>
            <div className="flex items-center gap-2">
              {r.kind === "audio" ? (
                <input
                  className="t-body-strong min-w-0 flex-1 bg-transparent outline-none"
                  value={st.name ?? ""}
                  placeholder={name}
                  onChange={(e) => set({ name: e.target.value || null })}
                  aria-label="Nombre de la pista"
                  data-testid={`track-name-${id}`}
                />
              ) : (
                <span className="t-body-strong flex-1">{name}</span>
              )}
              <span className="t-caption tabular text-[var(--text-secondary)]">{pct(st.volume ?? 1)}</span>
              <Button variant="subtle" className={`!h-7 !min-w-7 !px-1.5 ${st.muted ? "!text-[#ff99a4]" : ""}`} onClick={() => set({ muted: !st.muted })} aria-pressed={!!st.muted} data-testid={`track-row-mute-${id}`}>
                M
              </Button>
              <Button variant="subtle" className={`!h-7 !min-w-7 !px-1.5 ${st.solo ? "!text-[#ffd60a]" : ""}`} onClick={() => set({ solo: !st.solo })} aria-pressed={!!st.solo} data-testid={`track-row-solo-${id}`}>
                S
              </Button>
            </div>
            <RangeSlider label={`Volumen de ${name}`} value={st.volume ?? 1} min={0} max={MAX_CLIP_VOLUME} step={0.05} resetTo={1} origin={1} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set({ volume: v })} testId={`track-volume-${id}`} />
          </div>
        );
      })}
    </Section>
  );
}

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
  if (a.detached) {
    return (
      <Section title="Audio del clip" testId="clip-audio">
        <p className="t-caption text-[var(--text-secondary)]">El audio de este clip está separado en su propia pista: se edita ahí.</p>
        <Button icon={<ArrowJoin20Regular />} onClick={() => joinSelection([clip.id])} data-testid="join-audio">
          Unir audio
        </Button>
      </Section>
    );
  }
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
      <VoiceField id={clip.id} enhance={a.enhance} />
      {canSeparate(project, clip.id) && (
        <Button icon={<ArrowSplit20Regular />} onClick={() => separateSelection([clip.id])} data-testid="separate-audio">
          Separar audio
        </Button>
      )}
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
      <VoiceField id={mu.id} enhance={mu.enhance} />
      <Field label="Curva de volumen" hint="Doble clic sobre el audio en el timeline agrega un punto; arrastralo para subir o bajar. Doble clic en un punto lo borra.">
        <div className="flex items-center gap-2">
          <span className="t-caption flex-1 text-[var(--text-secondary)]" data-testid="volume-keys-count">
            {(mu.volumeKeys ?? []).length ? `${(mu.volumeKeys ?? []).length} puntos` : "Sin puntos"}
          </span>
          {(mu.volumeKeys ?? []).length > 0 && (
            <Button variant="subtle" className="!h-7" onClick={() => set((m) => ({ ...m, volumeKeys: [] }))} data-testid="volume-keys-clear">
              Borrar puntos
            </Button>
          )}
        </div>
      </Field>
      {mu.linkedClip && project.clips.some((c) => c.id === mu.linkedClip) && (
        <Button icon={<ArrowJoin20Regular />} onClick={() => joinSelection([mu.id])} data-testid="join-audio">
          Unir audio al clip
        </Button>
      )}
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
      <Section title="Pistas de audio extra">
        <Button icon={<MusicNote220Regular />} onClick={() => void addMusicWithDialog()} data-testid="add-music-inspector">
          Agregar música
        </Button>
        {project.music.length > 0 && !music && (
          <p className="t-caption text-[var(--text-secondary)]">Tocá un clip de música en el timeline para ajustar su volumen, fades y ducking.</p>
        )}
      </Section>
      <TracksSection project={project} />
      <AutoSection project={project} />
      <Section title="Extraer">
        <Button icon={<ArrowExport20Regular />} onClick={() => void extractAudio()} disabled={!project.clips.length} data-testid="extract-mp3">
          Extraer el audio a MP3
        </Button>
      </Section>
    </div>
  );
}
