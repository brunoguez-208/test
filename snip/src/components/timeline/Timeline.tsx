import { setDropGeo } from "./dropTarget";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Add16Regular,
  Delete16Regular,
  Flag16Regular,
  AlignCenterVertical16Regular,
  MusicNote216Regular,
  Cut16Regular,
  Image16Regular,
  Speaker216Regular,
  VideoClip16Regular,
  ZoomIn16Regular,
  ZoomOut16Regular,
  TextT16Regular,
  ClosedCaption16Regular,
} from "@fluentui/react-icons";
import type { Project } from "../../project/model";
import { moveMarker, renameMarker } from "../../project/ops";
import { activeTab, edit, gestureEnd, gestureStart, patchProject, setSelection, useEditor } from "../../store/editor";
import { addMusicWithDialog, addRangeFromMarks, addTextAtPlayhead, addVideosWithDialog, player } from "../../store/controller";
import { runShortcut } from "../../hooks/useShortcuts";
import { freezeAt } from "../../project/ops";
import { notifyEditError } from "../../store/controller";
import { secondsToTimecode } from "../../lib/timecode";
import { IconButton, Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { AUDIO_H, GUTTER, MUSIC_H, OVERLAY_H, PAD_X, RULER_H, VIDEO_H, geometry, rulerLabel, rulerStep, tToX, useTrackWidth, xToT, type Geo } from "./geometry";
import { VideoTrack } from "./VideoTrack";
import { MainAudioTrack, MusicTrack, musicRows } from "./AudioTracks";
import { OverlayTrack, SubtitleTrack, overlayLanes } from "./OverlayTracks";
import { setScroll, zoomTimeline } from "./zoom";

function Ruler({ project, geo, onScrubStart }: { project: Project; geo: Geo; onScrubStart: (e: React.PointerEvent) => void }) {
  const tab = useEditor((s) => activeTab(s));
  const selection = tab?.selection ?? [];
  const { major, minor } = rulerStep(geo.pps);
  const t0 = Math.max(0, xToT(geo, 0));
  const t1 = xToT(geo, geo.width);
  const ticks: { t: number; major: boolean }[] = [];
  for (let k = Math.floor(t0 / minor); k * minor <= t1 + minor && ticks.length < 600; k++) {
    const t = k * minor;
    ticks.push({ t, major: Math.abs(t / major - Math.round(t / major)) < 1e-6 });
  }
  const [renaming, setRenaming] = useState<string | null>(null);

  const markerDown = (id: string, time: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const origin = project;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!started) {
        if (Math.abs(dx) < 3) return;
        started = true;
        gestureStart();
      }
      edit(() => moveMarker(origin, id, time + dx / geo.pps));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (started) gestureEnd();
      else {
        setSelection([id]);
        player().pause();
        player().seek(time);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const mi = tab?.markIn ?? null;
  const mo = tab?.markOut ?? null;
  return (
    <div className="tl-ruler relative cursor-text select-none" style={{ height: RULER_H }} onPointerDown={onScrubStart} data-testid="ruler">
      {/* Fragmentos para exportar */}
      {project.ranges.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`tl-range absolute bottom-0 top-[13px] rounded-[3px] ${selection.includes(r.id) ? "is-selected" : ""}`}
          style={{ left: tToX(geo, r.start), width: Math.max(4, (r.end - r.start) * geo.pps) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            setSelection([r.id]);
            useEditor.setState({ inspectorTab: "export", inspectorOpen: true });
          }}
          title={r.name}
          data-testid="range-band"
        >
          <span className="t-caption block truncate px-1 text-[10px] leading-[13px]">{r.name}</span>
        </button>
      ))}
      {/* Rango I/O */}
      {(mi !== null || mo !== null) && (
        <div
          className="tl-io pointer-events-none absolute inset-y-0"
          style={{ left: tToX(geo, mi ?? 0), width: Math.max(2, ((mo ?? geo.duration) - (mi ?? 0)) * geo.pps) }}
          data-testid="io-range"
        />
      )}
      {ticks.map(({ t, major: isMajor }) => {
        const x = tToX(geo, t);
        if (x < -40 || x > geo.width + 40) return null;
        return (
          <div key={t.toFixed(4)} className="pointer-events-none absolute top-0" style={{ left: x }}>
            <div className={`tl-tick ${isMajor ? "is-major" : ""}`} />
            {isMajor && <span className="tl-tick-label t-caption tabular absolute left-1 top-0 whitespace-nowrap">{rulerLabel(t, major)}</span>}
          </div>
        );
      })}
      {project.markers.map((m) => (
        <div key={m.id} className="absolute top-0 z-10" style={{ left: tToX(geo, m.time) - 6 }}>
          <motion.button
            type="button"
            className={`tl-marker flex h-[14px] w-3 items-start justify-center ${selection.includes(m.id) ? "is-selected" : ""}`}
            onPointerDown={markerDown(m.id, m.time)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(m.id);
            }}
            whileHover={{ scale: 1.2 }}
            aria-label={m.name ? `Marcador: ${m.name}` : "Marcador"}
            title={m.name ? `${m.name} · doble click para renombrar` : "Doble click para ponerle nombre"}
            data-testid="marker"
          >
            <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
              <path d="M1 1 H11 V8 L6 13 L1 8 Z" fill="currentColor" />
            </svg>
          </motion.button>
          {m.name && renaming !== m.id && <span className="tl-marker-name t-caption pointer-events-none absolute left-3.5 top-0 whitespace-nowrap text-[10px]">{m.name}</span>}
          <AnimatePresence>
            {renaming === m.id && (
              <motion.input
                key="rename"
                autoFocus
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                defaultValue={m.name}
                placeholder="Nombre del marcador"
                className="tc-input t-caption absolute left-3 top-[-2px] z-30 h-6 w-40 rounded-[4px] px-2 outline-none"
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== m.name) edit((p) => renameMarker(p, m.id, v));
                  setRenaming(null);
                }}
                data-testid="marker-rename"
              />
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

/** Playhead: línea sobre todas las pistas que sigue al reproductor a 60 fps sin re-render. */
function Playhead({ geo, height }: { geo: Geo; height: number }) {
  const x = useMotionValue(tToX(geo, useEditor.getState().time));
  const geoRef = useRef(geo);
  geoRef.current = geo;
  useEffect(() => {
    x.set(tToX(geo, useEditor.getState().time));
  }, [geo, x]);
  useEffect(() => {
    const off = player().on((t) => x.set(tToX(geoRef.current, t)));
    return () => {
      off();
    };
  }, [x]);
  return (
    <motion.div className="pointer-events-none absolute top-0 z-30 w-[2px]" style={{ x, height, left: -1 }} data-testid="playhead">
      <div className="tl-playhead h-full w-[2px] rounded-full" />
      <div className="tl-playhead-knob absolute -left-[5px] top-[2px] h-3 w-3 rounded-full" />
    </motion.div>
  );
}

/** Timeline multi-pista: regla, video, audio y música, con zoom y snap. */
export function Timeline({ project }: { project: Project }) {
  const area = useRef<HTMLDivElement>(null);
  const width = useTrackWidth(area);
  const geo = useMemo(() => geometry(project, width), [project, width]);
  setDropGeo(geo);
  const dropTarget = useEditor((s) => s.dropTarget);
  const [snapOn, setSnapOn] = useState(true);
  const tab = useEditor((s) => activeTab(s));
  const time = useEditor((s) => s.time);
  const hasMusic = project.music.length > 0;
  const lanes = overlayLanes(project);
  const hasCues = project.subtitles.cues.length > 0;
  const tracksH = RULER_H + lanes * OVERLAY_H + (hasCues ? OVERLAY_H : 0) + VIDEO_H + AUDIO_H + musicRows(project) * MUSIC_H + 8;

  // Mantener el playhead a la vista mientras se reproduce.
  useEffect(() => {
    const x = tToX(geo, time);
    if (x > geo.width - 40) setScroll(geo.scroll + (x - geo.width * 0.25));
    else if (x < 0) setScroll(geo.scroll + x - geo.width * 0.1);
  }, [time, geo]);

  const scrubStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = area.current;
    if (!el) return;
    const pl = player();
    pl.pause();
    const seekTo = (clientX: number) => {
      const r = el.getBoundingClientRect();
      pl.seek(xToT(geo, clientX - r.left));
    };
    seekTo(e.clientX);
    const onMove = (ev: PointerEvent) => seekTo(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = area.current?.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const x = r ? e.clientX - r.left : geo.width / 2;
      zoomTimeline(e.deltaY < 0 ? 1.2 : 1 / 1.2, xToT(geo, x), x);
    } else {
      setScroll(geo.scroll + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
    }
  };

  // Ctrl+rueda no debe hacer zoom de la página.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const block = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, []);

  const contentW = geo.duration * geo.pps + 2 * PAD_X;
  const showBar = contentW > geo.width + 1;
  const marks = tab && (tab.markIn !== null || tab.markOut !== null);

  return (
    <div className="timeline-card card flex flex-col" data-testid="timeline">
      {/* Barra de herramientas */}
      <div className="flex items-center gap-1 px-2 pb-1 pt-2">
        <Tooltip content="Agregar videos">
          <Button variant="subtle" className="!h-8 !px-2" icon={<Add16Regular />} onClick={() => void addVideosWithDialog()} data-testid="add-videos">
            Video
          </Button>
        </Tooltip>
        <Tooltip content="Agregar música">
          <Button variant="subtle" className="!h-8 !px-2" icon={<MusicNote216Regular />} onClick={() => void addMusicWithDialog()} data-testid="add-music">
            Música
          </Button>
        </Tooltip>
        <Tooltip content="Agregar texto en el playhead">
          <Button variant="subtle" className="!h-8 !px-2" icon={<TextT16Regular />} onClick={() => addTextAtPlayhead()} data-testid="add-text">
            Texto
          </Button>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-[var(--stroke-divider)]" />
        <Tooltip content={<>Dividir en el playhead <kbd className="kbd ml-1">S</kbd></>}>
          <IconButton label="Dividir" onClick={() => runShortcut({ type: "split" })} data-testid="tool-split">
            <Cut16Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content={<>Borrar la selección o el rango I/O <kbd className="kbd ml-1">Supr</kbd></>}>
          <IconButton label="Borrar" onClick={() => runShortcut({ type: "delete" })} disabled={!tab?.selection.length && !marks} data-testid="tool-delete">
            <Delete16Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content="Congelar este cuadro 2 segundos">
          <IconButton
            label="Congelar cuadro"
            onClick={() => {
              try {
                edit((p) => freezeAt(p, useEditor.getState().time, 2));
              } catch (e) {
                notifyEditError(e);
              }
            }}
            data-testid="tool-freeze"
          >
            <Image16Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content={<>Agregar marcador <kbd className="kbd ml-1">M</kbd></>}>
          <IconButton label="Marcador" onClick={() => runShortcut({ type: "marker" })} data-testid="tool-marker">
            <Flag16Regular />
          </IconButton>
        </Tooltip>
        <AnimatePresence>
          {marks && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              className="ml-2 flex items-center gap-2"
              data-testid="io-bar"
            >
              <span className="t-caption tabular text-[var(--text-secondary)]">
                {secondsToTimecode(tab!.markIn ?? 0, player().fps())} → {secondsToTimecode(tab!.markOut ?? geo.duration, player().fps())}
              </span>
              <Button variant="subtle" className="!h-7 !px-2 t-caption" onClick={addRangeFromMarks} data-testid="add-range">
                Agregar fragmento
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex-1" />
        <Tooltip content={snapOn ? "Imán activado" : "Imán desactivado"}>
          <IconButton label="Imán" active={snapOn} onClick={() => setSnapOn((v) => !v)} data-testid="snap-toggle">
            <AlignCenterVertical16Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content={<>Alejar <kbd className="kbd ml-1">−</kbd></>}>
          <IconButton label="Alejar" onClick={() => zoomTimeline(1 / 1.5)} disabled={project.view.zoom === 0} data-testid="zoom-out">
            <ZoomOut16Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content={<>Acercar <kbd className="kbd ml-1">+</kbd></>}>
          <IconButton label="Acercar" onClick={() => zoomTimeline(1.5)} data-testid="zoom-in">
            <ZoomIn16Regular />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex">
        {/* Íconos de las pistas */}
        <div className="tl-gutter flex shrink-0 flex-col items-center" style={{ width: GUTTER }}>
          <div style={{ height: RULER_H }} />
          {lanes > 0 && (
            <div className="flex items-start justify-center pt-1.5 text-[var(--text-tertiary)]" style={{ height: lanes * OVERLAY_H }} title="Textos e imágenes">
              <TextT16Regular />
            </div>
          )}
          {hasCues && (
            <div className="flex items-center justify-center text-[var(--text-tertiary)]" style={{ height: OVERLAY_H }} title="Subtítulos">
              <ClosedCaption16Regular />
            </div>
          )}
          <div className="flex items-center justify-center text-[var(--text-tertiary)]" style={{ height: VIDEO_H }} title="Video">
            <VideoClip16Regular />
          </div>
          <div className="flex items-center justify-center text-[var(--text-tertiary)]" style={{ height: AUDIO_H }} title="Audio">
            <Speaker216Regular />
          </div>
          {hasMusic && (
            <div className="flex items-start justify-center pt-2.5 text-[var(--text-tertiary)]" style={{ height: musicRows(project) * MUSIC_H }} title="Audio">
              <MusicNote216Regular />
            </div>
          )}
        </div>
        <div
          ref={area}
          className="tl-area relative min-w-0 flex-1 overflow-hidden"
          style={{ height: tracksH }}
          onWheel={onWheel}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelection([]);
          }}
          data-testid="timeline-area"
        >
          <Ruler project={project} geo={geo} onScrubStart={scrubStart} />
          <div onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelection([]); scrubStart(e); } }}>
            {lanes > 0 && <OverlayTrack project={project} geo={geo} snapOn={snapOn} />}
            {hasCues && <SubtitleTrack project={project} geo={geo} snapOn={snapOn} />}
            <VideoTrack project={project} geo={geo} snapOn={snapOn} />
            <MainAudioTrack project={project} geo={geo} />
            {hasMusic && <MusicTrack project={project} geo={geo} snapOn={snapOn} />}
          </div>
          <Playhead geo={geo} height={tracksH} />
          {dropTarget && (
            <motion.div
              className="tl-drop-line pointer-events-none absolute top-0 z-20 w-0.5 rounded-full"
              style={{ left: tToX(geo, dropTarget.time) - 1, height: tracksH }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              data-testid="drop-target"
              data-kind={dropTarget.kind}
              data-row={dropTarget.row}
            />
          )}
        </div>
      </div>
      {/* Barra de desplazamiento cuando hay zoom */}
      <div className="relative mx-3 mb-2 mt-1 h-1.5" style={{ marginLeft: GUTTER + 12 }}>
        <AnimatePresence>
          {showBar && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="tl-scroll absolute inset-0 rounded-full"
              onPointerDown={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const ratio = geo.width / contentW;
                const thumbW = r.width * ratio;
                const go = (cx: number) => setScroll(((cx - r.left - thumbW / 2) / (r.width - thumbW)) * (contentW - geo.width));
                go(e.clientX);
                const mv = (ev: PointerEvent) => go(ev.clientX);
                const up = () => {
                  window.removeEventListener("pointermove", mv);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", mv);
                window.addEventListener("pointerup", up);
              }}
            >
              <div
                className="tl-scroll-thumb absolute inset-y-0 rounded-full"
                style={{ left: `${(geo.scroll / contentW) * 100}%`, width: `${(geo.width / contentW) * 100}%` }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Para los tests y el zoom con +/−: deja la vista en "ajustar". */
export function resetZoom() {
  patchProject((p) => ({ ...p, view: { ...p.view, zoom: 0, scroll: 0 } }));
}
