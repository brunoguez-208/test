// Cabeceras de las pistas (columna izquierda del timeline): ícono y botones
// por pista. Audio: silenciar y solo (y volumen en la pestaña Audio).

import type { ReactNode } from "react";
import {
  ClosedCaption16Regular,
  Eye16Regular,
  EyeOff16Regular,
  LockClosed16Regular,
  LockOpen16Regular,
  MusicNote216Regular,
  Speaker216Regular,
  SpeakerMute16Regular,
  TextT16Regular,
  VideoClip16Regular,
} from "@fluentui/react-icons";
import type { Project } from "../../project/model";
import { audioTrackName, setTrackState, trackState, type TrackRef } from "../../project/audioOps";
import { edit, useEditor } from "../../store/editor";
import { Tooltip } from "../ui/Tooltip";
import { AUDIO_H, MUSIC_H, OVERLAY_H, RULER_H, VIDEO_H } from "./geometry";

function Toggle({ on, label, onClick, children, testId, tone }: { on: boolean; label: string; onClick: () => void; children: ReactNode; testId: string; tone?: "solo" | "mute" | "plain" }) {
  return (
    <Tooltip content={label} placement="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        onClick={onClick}
        className={`tl-track-btn t-caption flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] px-0.5 text-[11px] font-semibold ${on ? `is-on ${tone ? `is-${tone}` : ""}` : ""}`}
        data-testid={testId}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Row({ height, icon, title, children, testId }: { height: number; icon: ReactNode; title: string; children?: ReactNode; testId?: string }) {
  return (
    <div className="flex items-center gap-1 pl-2 pr-1 text-[var(--text-tertiary)]" style={{ height }} title={title} data-testid={testId}>
      <span className="flex shrink-0">{icon}</span>
      <span className="flex-1" />
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

/** Ocultar (ojo) una pista visual. */
function EyeButton({ project, r, id }: { project: Project; r: TrackRef; id: string }) {
  const st = trackState(project, r);
  return (
    <Toggle on={!!st.hidden} label={st.hidden ? "Mostrar pista" : "Ocultar pista"} onClick={() => edit((p) => setTrackState(p, r, { hidden: !st.hidden }))} testId={`track-eye-${id}`} tone="plain">
      {st.hidden ? <EyeOff16Regular /> : <Eye16Regular />}
    </Toggle>
  );
}

/** Bloquear una pista (no se puede mover, recortar, dividir ni borrar lo que tiene). */
function LockButton({ project, r, id }: { project: Project; r: TrackRef; id: string }) {
  const st = trackState(project, r);
  return (
    <Toggle on={!!st.locked} label={st.locked ? "Desbloquear pista" : "Bloquear pista"} onClick={() => edit((p) => setTrackState(p, r, { locked: !st.locked }))} testId={`track-lock-${id}`} tone="plain">
      {st.locked ? <LockClosed16Regular /> : <LockOpen16Regular />}
    </Toggle>
  );
}

/** Silenciar / solo de una pista de audio. */
function AudioButtons({ project, r, id }: { project: Project; r: TrackRef; id: string }) {
  const st = trackState(project, r);
  const set = (patch: Parameters<typeof setTrackState>[2]) => edit((p) => setTrackState(p, r, patch));
  return (
    <>
      <Toggle on={!!st.muted} label={st.muted ? "Activar sonido" : "Silenciar pista"} onClick={() => set({ muted: !st.muted })} testId={`track-mute-${id}`} tone="mute">
        {st.muted ? <SpeakerMute16Regular /> : "M"}
      </Toggle>
      <Toggle on={!!st.solo} label={st.solo ? "Quitar solo" : "Solo: escuchar solo esta pista"} onClick={() => set({ solo: !st.solo })} testId={`track-solo-${id}`} tone="solo">
        S
      </Toggle>
    </>
  );
}

export function TrackHeaders({ project, lanes, hasCues, rows }: { project: Project; lanes: number; hasCues: boolean; rows: number }) {
  useEditor((s) => s.active); // re-render al cambiar de pestaña
  return (
    <>
      <div style={{ height: RULER_H }} />
      {Array.from({ length: lanes }, (_, i) => (
        <Row key={`o${i}`} height={OVERLAY_H} icon={i === 0 ? <TextT16Regular /> : <span className="w-4" />} title={`Capa ${i + 1}`} testId={`track-header-overlay-${i}`}>
          <EyeButton project={project} r={{ kind: "overlay", index: i }} id={`overlay-${i}`} />
          <LockButton project={project} r={{ kind: "overlay", index: i }} id={`overlay-${i}`} />
        </Row>
      ))}
      {hasCues && (
        <Row height={OVERLAY_H} icon={<ClosedCaption16Regular />} title="Subtítulos" testId="track-header-subtitles">
          <EyeButton project={project} r={{ kind: "subtitles" }} id="subtitles" />
          <LockButton project={project} r={{ kind: "subtitles" }} id="subtitles" />
        </Row>
      )}
      <Row height={VIDEO_H} icon={<VideoClip16Regular />} title="Video" testId="track-header-video">
        <EyeButton project={project} r={{ kind: "video" }} id="video" />
        <LockButton project={project} r={{ kind: "video" }} id="video" />
      </Row>
      <Row height={AUDIO_H} icon={<Speaker216Regular />} title="Audio del video" testId="track-header-video-audio">
        <AudioButtons project={project} r={{ kind: "videoAudio" }} id="video-audio" />
        <LockButton project={project} r={{ kind: "videoAudio" }} id="video-audio" />
      </Row>
      {Array.from({ length: rows }, (_, i) => (
        <Row key={`a${i}`} height={MUSIC_H} icon={<MusicNote216Regular />} title={audioTrackName(project, i)} testId={`track-header-audio-${i}`}>
          <AudioButtons project={project} r={{ kind: "audio", index: i }} id={`audio-${i}`} />
          <LockButton project={project} r={{ kind: "audio", index: i }} id={`audio-${i}`} />
        </Row>
      ))}
    </>
  );
}
