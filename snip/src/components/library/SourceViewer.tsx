// Visor de origen: un medio de la biblioteca en su propio reproductor, con mini
// timeline, puntos de entrada/salida (I / O) y dos formas de llevar el
// fragmento al proyecto: "Insertar en el playhead" o arrastrarlo a una pista.

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowDownload20Regular, Dismiss16Regular, Pause20Filled, Play20Filled, ReOrderDotsVertical16Regular } from "@fluentui/react-icons";
import type { MediaRef } from "../../project/model";
import { basename } from "../../lib/files";
import { secondsToTimecode } from "../../lib/timecode";
import { mediaSrc } from "../../lib/platform";
import { useEditor } from "../../store/editor";
import { useShallow } from "zustand/react/shallow";
import { placeFromLibrary } from "../../store/library";
import { quantizeThumbTime, requestThumbs, thumbKey } from "../../store/controller";
import { Button, IconButton } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { MEDIA_MIME } from "./Library";

export const RANGE_MIME = "application/x-snip-range";
const STRIP = 10;

function Strip({ m }: { m: MediaRef }) {
  const step = Math.max(0.1, m.duration / STRIP);
  const times = Array.from({ length: STRIP }, (_, i) => quantizeThumbTime(i * step, step));
  useEffect(() => {
    if (m.kind === "video") requestThumbs(times.map((time) => ({ path: m.path, time })), 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.path, m.duration]);
  const thumbs = useEditor(useShallow((s) => times.map((t) => s.thumbs[thumbKey(m.path, t, 64)])));
  if (m.kind !== "video") return <div className="lib-audio absolute inset-0 rounded-[4px]" />;
  return (
    <div className="absolute inset-0 flex overflow-hidden rounded-[4px]">
      {thumbs.map((u, i) => (
        <div key={i} className="h-full flex-1 bg-black/30">
          {u && <img src={u} alt="" className="h-full w-full object-cover" draggable={false} />}
        </div>
      ))}
    </div>
  );
}

export function SourceViewer({ media }: { media: MediaRef }) {
  const el = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<[number, number]>([0, media.duration]);
  const fps = media.fps || 30;
  // HEVC u otros que el WebView no reproduce: el proxy, si ya está.
  const proxy = useEditor((s) => s.proxies[media.path]);
  const src = mediaSrc(proxy?.status === "ready" ? proxy.path : media.path);
  const dur = Math.max(0.01, media.duration);
  const close = () => useEditor.setState({ sourceMedia: null });
  const seek = (v: number) => {
    const x = Math.min(dur, Math.max(0, v));
    setT(x);
    if (el.current) el.current.currentTime = x;
  };
  const toggle = () => {
    const v = el.current;
    if (!v) return;
    if (v.paused) {
      // Si está al final del fragmento, arranca desde la entrada.
      if (v.currentTime >= range[1] - 0.05 || v.currentTime < range[0]) v.currentTime = range[0];
      void v.play();
    } else v.pause();
  };
  // Entrada y salida en cuadros exactos del original.
  const frame = (v: number) => Math.round(v * fps) / fps;
  const markIn = () => setRange(([, b]) => [Math.min(frame(t), b - 1 / fps), b]);
  const markOut = () => setRange(([a]) => [a, Math.max(frame(t), a + 1 / fps)]);
  const insert = () => {
    placeFromLibrary(media.id, useEditor.getState().time, null, media.kind === "image" ? null : range);
    close();
  };

  // Teclado propio mientras el visor está abierto (no llega al editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      const handled = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (k === "escape") return handled(), close();
      if (k === " ") return handled(), toggle();
      if (k === "i") return handled(), markIn();
      if (k === "o") return handled(), markOut();
      if (k === "arrowleft") return handled(), seek(t - (e.shiftKey ? 1 : 1 / fps));
      if (k === "arrowright") return handled(), seek(t + (e.shiftKey ? 1 : 1 / fps));
      if (k === "enter") return handled(), insert();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // El reproductor se detiene en la salida del fragmento.
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    let raf = 0;
    const loop = () => {
      setT(v.currentTime);
      if (!v.paused && v.currentTime >= range[1]) {
        v.pause();
        v.currentTime = range[1];
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [range]);

  const scrub = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    const at = (x: number) => seek(((x - r.left) / r.width) * dur);
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pct = (v: number) => `${(v / dur) * 100}%`;
  const tc = (v: number) => secondsToTimecode(v, fps);
  const isImage = media.kind === "image";

  return (
    <motion.div
      className="source-viewer card absolute inset-0 z-30 flex flex-col gap-3 p-4"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: [0.1, 0.9, 0.2, 1] }}
      data-testid="source-viewer"
    >
      <div className="flex items-center gap-2">
        <span className="t-caption rounded-[3px] bg-[var(--subtle-fill-hover)] px-1.5 py-0.5 text-[var(--text-secondary)]">Visor de origen</span>
        <p className="t-body-strong min-w-0 flex-1 truncate">{basename(media.path)}</p>
        <IconButton label="Cerrar el visor" onClick={close} data-testid="source-close">
          <Dismiss16Regular />
        </IconButton>
      </div>
      <div className="video-well relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[8px]">
        {isImage ? (
          <img src={mediaSrc(media.path)} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            ref={el}
            src={src}
            className={media.kind === "audio" ? "hidden" : "max-h-full max-w-full"}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            preload="auto"
            data-testid="source-video"
          />
        )}
      </div>
      {!isImage && (
        <>
          <div ref={bar} className="relative h-10 cursor-pointer select-none" onPointerDown={scrub} data-testid="source-bar">
            <Strip m={media} />
            {/* Lo que queda afuera del fragmento, oscurecido. */}
            <div className="source-out pointer-events-none absolute inset-y-0 left-0" style={{ width: pct(range[0]) }} />
            <div className="source-out pointer-events-none absolute inset-y-0 right-0" style={{ left: pct(range[1]) }} />
            <div className="source-range pointer-events-none absolute inset-y-0" style={{ left: pct(range[0]), width: pct(range[1] - range[0]) }} data-testid="source-range" />
            <div className="tl-playhead pointer-events-none absolute -inset-y-1 w-0.5" style={{ left: pct(t) }} />
          </div>
          <div className="flex items-center gap-2">
            <IconButton label={playing ? "Pausa" : "Reproducir"} onClick={toggle} data-testid="source-play">
              {playing ? <Pause20Filled /> : <Play20Filled />}
            </IconButton>
            <span className="t-body tabular" data-testid="source-tc">
              {tc(t)}
            </span>
            <span className="flex-1" />
            <Tooltip content={<>Marcar entrada <kbd className="kbd ml-1">I</kbd></>}>
              <Button className="!h-8" onClick={markIn} data-testid="source-in">
                Entrada · {tc(range[0])}
              </Button>
            </Tooltip>
            <Tooltip content={<>Marcar salida <kbd className="kbd ml-1">O</kbd></>}>
              <Button className="!h-8" onClick={markOut} data-testid="source-out">
                Salida · {tc(range[1])}
              </Button>
            </Tooltip>
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <div
          className="source-drag t-caption flex h-9 cursor-grab items-center gap-1.5 rounded-[4px] px-3"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(MEDIA_MIME, media.id);
            if (!isImage) e.dataTransfer.setData(RANGE_MIME, JSON.stringify(range));
            e.dataTransfer.effectAllowed = "copy";
          }}
          data-testid="source-drag"
        >
          <ReOrderDotsVertical16Regular />
          Arrastrá el fragmento a una pista
        </div>
        <span className="t-caption flex-1 text-[var(--text-tertiary)]">{isImage ? "" : `${(range[1] - range[0]).toFixed(1)} s`}</span>
        <Button variant="accent" icon={<ArrowDownload20Regular />} onClick={insert} data-testid="source-insert">
          Insertar en el playhead
        </Button>
      </div>
    </motion.div>
  );
}
