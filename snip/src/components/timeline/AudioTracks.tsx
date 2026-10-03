import { motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import type { Clip, MediaRef, MusicClip, Project } from "../../project/model";
import { layout } from "../../project/timeline";
import { snap, snapPoints, trimMusic, updateMusic } from "../../project/ops";
import { basename } from "../../lib/files";
import { activeTab, edit, gestureEnd, gestureStart, setSelection, useEditor } from "../../store/editor";
import { AUDIO_H, MUSIC_H, tToX, type Geo } from "./geometry";

/** Dibuja picos (100 por segundo) en un canvas; `map` lleva x (px) → segundo del original. */
function drawWave(canvas: HTMLCanvasElement, peaks: Uint8Array | undefined, w: number, h: number, map: (x: number) => number | null, gain: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!peaks) return;
  g.fillStyle = getComputedStyle(canvas).color || "#fff";
  const mid = canvas.height / 2;
  const step = Math.max(1, Math.floor(dpr));
  for (let x = 0; x < canvas.width; x += step) {
    const t0 = map(x / dpr);
    const t1 = map((x + step) / dpr);
    if (t0 === null || t1 === null) continue;
    const a = Math.floor(Math.min(t0, t1) * 100);
    const b = Math.max(a + 1, Math.ceil(Math.max(t0, t1) * 100));
    let v = 0;
    for (let i = a; i < b && i < peaks.length; i++) v = Math.max(v, peaks[i]);
    const amp = Math.min(1, (v / 255) * gain) * (mid - 1);
    g.fillRect(x, mid - amp, step, Math.max(1, amp * 2));
  }
}

function sourceAt(c: Clip, u: number): number {
  if (c.kind === "freeze") return c.inPoint;
  const seg = Math.max(1e-3, (c.outPoint - c.inPoint) / c.speed);
  const pass = Math.floor(u / seg);
  let fwd = c.loopMode === "boomerang" ? pass % 2 === 0 : true;
  if (c.reverse) fwd = !fwd;
  const off = (u - pass * seg) * c.speed;
  return fwd ? c.inPoint + off : c.outPoint - off;
}

function ClipWave({ clip, media, start, duration, geo }: { clip: Clip; media: MediaRef | undefined; start: number; duration: number; geo: Geo }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = useEditor((s) => (media ? s.waveforms[media.path] : undefined));
  const x = tToX(geo, start);
  const w = duration * geo.pps;
  // Solo la parte visible.
  const vx0 = Math.max(0, -x);
  const vx1 = Math.min(w, geo.width - x);
  const silent = !media?.hasAudio || clip.audio.removed || clip.audio.muted || clip.kind === "freeze";
  useEffect(() => {
    if (!ref.current || vx1 <= vx0) return;
    drawWave(ref.current, silent ? undefined : peaks, vx1 - vx0, AUDIO_H - 6, (px) => {
      const u = (vx0 + px) / geo.pps;
      return u > duration ? null : sourceAt(clip, u);
    }, clip.audio.volume);
  }, [peaks, vx0, vx1, geo.pps, clip, duration, silent]);
  if (vx1 <= vx0) return null;
  return (
    <div className={`tl-audio-clip absolute top-[3px] overflow-hidden rounded-[4px] ${silent ? "is-silent" : ""}`} style={{ left: x, width: w, height: AUDIO_H - 6 }} data-testid="audio-clip">
      <canvas ref={ref} className="tl-wave absolute top-0" style={{ left: vx0, width: vx1 - vx0, height: AUDIO_H - 6 }} />
    </div>
  );
}

/** Audio de los clips de la pista principal (forma de onda alineada con cada clip). */
export function MainAudioTrack({ project, geo }: { project: Project; geo: Geo }) {
  const spans = useMemo(() => layout(project.clips), [project.clips]);
  return (
    <div className="tl-track relative" style={{ height: AUDIO_H }} data-testid="audio-track">
      {project.clips.map((c, i) => (
        <ClipWave key={c.id} clip={c} media={project.media.find((m) => m.id === c.mediaId)} start={spans[i].start} duration={spans[i].duration} geo={geo} />
      ))}
    </div>
  );
}

function MusicView({ mu, media, geo, selected, project, snapOn }: { mu: MusicClip; media: MediaRef | undefined; geo: Geo; selected: boolean; project: Project; snapOn: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = useEditor((s) => (media ? s.waveforms[media.path] : undefined));
  const len = mu.outPoint - mu.inPoint;
  const x = tToX(geo, mu.start);
  const w = Math.max(6, len * geo.pps);
  const vx0 = Math.max(0, -x);
  const vx1 = Math.min(w, geo.width - x);
  useEffect(() => {
    if (!ref.current || vx1 <= vx0) return;
    drawWave(ref.current, peaks, vx1 - vx0, MUSIC_H - 6, (px) => mu.inPoint + (vx0 + px) / geo.pps, mu.volume);
  }, [peaks, vx0, vx1, geo.pps, mu.inPoint, mu.volume]);

  const startDrag = (mode: "move" | "in" | "out") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const x0 = e.clientX;
    const origin = project;
    const m0 = mu;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!started) {
        if (Math.abs(dx) < 3) return;
        started = true;
        gestureStart();
      }
      const pts = snapOn ? snapPoints(origin, useEditor.getState().time, [m0.id]) : [];
      const thr = 8 / geo.pps;
      if (mode === "move") {
        let st = m0.start + dx / geo.pps;
        const endT = st + (m0.outPoint - m0.inPoint);
        const a = snap(st, pts, thr);
        const b = snap(endT, pts, thr);
        if (a.snapped) st = a.time;
        else if (b.snapped) st = b.time - (m0.outPoint - m0.inPoint);
        edit(() => updateMusic(origin, m0.id, (m) => ({ ...m, start: st })));
      } else {
        const edgeT = (mode === "in" ? m0.start : m0.start + (m0.outPoint - m0.inPoint)) + dx / geo.pps;
        edit(() => trimMusic(origin, m0.id, mode, snap(edgeT, pts, thr).time));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (started) gestureEnd();
      else {
        setSelection([m0.id]);
        useEditor.setState({ inspectorTab: "audio", inspectorOpen: true });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <motion.div
      className={`tl-music absolute top-[3px] ${selected ? "is-selected" : ""}`}
      style={{ left: x, width: w, height: MUSIC_H - 6 }}
      onPointerDown={startDrag("move")}
      data-testid="music-clip"
      role="button"
      aria-label={`Música: ${media ? basename(media.path) : ""}`}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[4px]">
        {vx1 > vx0 && <canvas ref={ref} className="tl-wave tl-wave-music absolute top-0" style={{ left: vx0, width: vx1 - vx0, height: MUSIC_H - 6 }} />}
      </div>
      {w > 60 && <span className="tl-music-name t-caption pointer-events-none absolute left-1.5 top-0.5 truncate">{media ? basename(media.path) : "Música"}</span>}
      <div className="tl-clip-outline pointer-events-none absolute inset-0 rounded-[4px]" />
      <div className="tl-trim absolute inset-y-0 left-0 w-2 cursor-ew-resize" onPointerDown={startDrag("in")} />
      <div className="tl-trim absolute inset-y-0 right-0 w-2 cursor-ew-resize" onPointerDown={startDrag("out")} />
    </motion.div>
  );
}

/** Pista de música (cada clip de música con su forma de onda). */
export function MusicTrack({ project, geo, snapOn }: { project: Project; geo: Geo; snapOn: boolean }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  return (
    <div className="tl-track relative" style={{ height: MUSIC_H }} data-testid="music-track">
      {project.music.map((mu) => (
        <MusicView
          key={mu.id}
          mu={mu}
          media={project.media.find((m) => m.id === mu.mediaId)}
          geo={geo}
          selected={selection.includes(mu.id)}
          project={project}
          snapOn={snapOn}
        />
      ))}
    </div>
  );
}
