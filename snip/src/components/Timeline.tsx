import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useSnip, THUMB_COUNT } from "../store/snip";
import { frameToSeconds, secondsToFrame, secondsToTimecode, formatDuration } from "../lib/timecode";
import { pause, playheadTime, seekToFrame, seekToTime } from "../lib/playback";
import { TimecodeInput } from "./TimecodeInput";

const STRIP_H = 60;
const HANDLE_W = 16;
const SNAP_PX = 6;

type DragKind = "start" | "end" | "playhead" | null;

/** Línea de tiempo con miniaturas, handles de recorte con física de spring y playhead. */
export function Timeline() {
  const media = useSnip((s) => s.media);
  const start = useSnip((s) => s.start);
  const end = useSnip((s) => s.end);
  const thumbs = useSnip((s) => s.thumbs);
  const setStart = useSnip((s) => s.setStart);
  const setEnd = useSnip((s) => s.setEnd);
  const exportRunning = useSnip((s) => s.exportState.status === "running");
  const reduce = useReducedMotion();

  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragKind>(null);
  const grab = useRef(0);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const dur = media?.duration ?? 1;
  const fps = media?.fps ?? 30;
  const tToX = (t: number) => (dur > 0 ? (t / dur) * width : 0);

  // Posiciones con spring: siguen al puntero con un rebote sutil.
  const springCfg = reduce ? { stiffness: 10000, damping: 1000 } : { stiffness: 900, damping: 55, mass: 0.6 };
  const startX = useSpring(0, springCfg);
  const endX = useSpring(0, springCfg);
  const initialized = useRef(false);
  useEffect(() => {
    if (!width) return;
    if (!initialized.current) {
      startX.jump(tToX(start));
      endX.jump(tToX(end));
      initialized.current = true;
    } else {
      startX.set(tToX(start));
      endX.set(tToX(end));
    }
  }, [start, end, width, dur]);

  const widthMv = useMotionValue(width);
  useEffect(() => widthMv.set(Math.max(1, width)), [width, widthMv]);

  const leftDim = useTransform([startX, widthMv], ([x, w]: number[]) => Math.max(0, x / w));
  const rightDim = useTransform([endX, widthMv], ([x, w]: number[]) => Math.max(0, (w - x) / w));
  const selScale = useTransform([startX, endX, widthMv], ([a, b, w]: number[]) => Math.max(0.0001, (b - a) / w));
  const startHandleX = useTransform(startX, (x) => x - HANDLE_W);
  const playX = useTransform(playheadTime, (t) => (dur > 0 ? (t / dur) * width : 0) - 1);
  const [playheadInRange, setPlayheadInRange] = useState(true);
  useMotionValueEvent(playheadTime, "change", (t) => {
    const inside = t >= start - 1e-6 && t <= end + 1e-6;
    if (inside !== playheadInRange) setPlayheadInRange(inside);
  });

  const timeAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur));
  };

  const snapToPlayhead = (t: number) => {
    const ph = useSnip.getState().current;
    return Math.abs(tToX(t) - tToX(ph)) < SNAP_PX ? ph : t;
  };

  const onPointerDown = (kind: Exclude<DragKind, null>) => (e: PointerEvent<HTMLElement>) => {
    if (exportRunning || !media) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pause();
    setDrag(kind);
    const t = timeAt(e.clientX);
    if (kind === "start") grab.current = start - t;
    else if (kind === "end") grab.current = end - t;
    else {
      grab.current = 0;
      seekToTime(t);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag || !media) return;
    const t = timeAt(e.clientX) + grab.current;
    if (drag === "start") {
      const s = snapToPlayhead(t);
      setStart(s);
      // El preview salta al cuadro del handle en tiempo real.
      seekToTime(useSnip.getState().start);
    } else if (drag === "end") {
      const s = snapToPlayhead(t);
      setEnd(s);
      const st = useSnip.getState();
      seekToFrame(Math.max(secondsToFrame(st.start, fps), secondsToFrame(st.end, fps) - 1));
    } else {
      seekToTime(t);
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDrag(null);
  };

  const onHandleKey = (kind: "start" | "end") => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!media) return;
    const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? Math.round(fps) : 1;
    if (kind === "start") {
      setStart(frameToSeconds(secondsToFrame(start + 1e-6, fps) + delta * step, fps));
      seekToTime(useSnip.getState().start);
    } else {
      setEnd(frameToSeconds(secondsToFrame(end + 1e-6, fps) + delta * step, fps));
      const st = useSnip.getState();
      seekToFrame(secondsToFrame(st.end, fps) - 1);
    }
  };

  if (!media) return null;
  const selDur = end - start;

  return (
    <div className="timeline-card card px-5 pb-4 pt-5" data-testid="timeline">
      <div
        className="relative"
        style={{ height: STRIP_H + 16, paddingTop: 8, paddingBottom: 8, marginInline: HANDLE_W }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={track}
          className="timeline-strip relative h-full overflow-visible"
          onPointerDown={onPointerDown("playhead")}
          data-testid="timeline-strip"
        >
          {/* Miniaturas */}
          <div className="absolute inset-0 flex overflow-hidden rounded-[6px]">
            {Array.from({ length: THUMB_COUNT }, (_, i) => (
              <div key={i} className="relative h-full flex-1 overflow-hidden">
                {thumbs[i] ? (
                  <motion.img
                    src={thumbs[i]!}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.35 }}
                    data-testid="thumb"
                  />
                ) : (
                  <div className="skeleton absolute inset-0" style={{ animationDelay: `${i * 40}ms` }} data-testid="thumb-skeleton" />
                )}
                {i > 0 && <div className="absolute inset-y-0 left-0 w-px bg-black/30" />}
              </div>
            ))}
          </div>

          {/* Zonas excluidas atenuadas */}
          <motion.div className="tl-dim pointer-events-none absolute inset-y-0 left-0 w-full origin-left rounded-l-[6px]" style={{ scaleX: leftDim }} />
          <motion.div className="tl-dim pointer-events-none absolute inset-y-0 right-0 w-full origin-right rounded-r-[6px]" style={{ scaleX: rightDim }} />

          {/* Marco de la selección */}
          <motion.div className="pointer-events-none absolute -inset-y-[2px] left-0 w-full origin-left" style={{ x: startX, scaleX: selScale }}>
            <div className="tl-sel absolute inset-x-0 top-0 h-[3px]" />
            <div className="tl-sel absolute inset-x-0 bottom-0 h-[3px]" />
          </motion.div>

          {/* Playhead */}
          <motion.div
            className="absolute -top-[14px] z-20 flex h-[calc(100%+22px)] w-[2px] cursor-ew-resize justify-center"
            style={{ x: playX }}
            onPointerDown={onPointerDown("playhead")}
            data-testid="playhead"
          >
            <div className={`tl-playhead h-full w-[2px] rounded-full ${playheadInRange ? "" : "is-outside"}`} />
            <motion.div
              className="tl-playhead-knob absolute -top-[2px] h-3 w-3 rounded-full"
              animate={{ scale: drag === "playhead" ? 1.35 : 1 }}
              transition={{ type: "spring", stiffness: 600, damping: 28 }}
            />
          </motion.div>

          {/* Handles */}
          <Handle
            side="start"
            x={startHandleX}
            dragging={drag === "start"}
            onPointerDown={onPointerDown("start")}
            onKeyDown={onHandleKey("start")}
            label={`Inicio del recorte: ${secondsToTimecode(start, fps)}`}
            valueNow={start}
            max={dur}
          />
          <Handle
            side="end"
            x={endX}
            dragging={drag === "end"}
            onPointerDown={onPointerDown("end")}
            onKeyDown={onHandleKey("end")}
            label={`Fin del recorte: ${secondsToTimecode(end, fps)}`}
            valueNow={end}
            max={dur}
          />
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-4 px-1">
        <TimecodeInput
          label="Inicio"
          value={start}
          fps={fps}
          testId="tc-start"
          onCommit={(f) => {
            const endF = secondsToFrame(useSnip.getState().end + 1e-6, fps);
            if (f >= endF) return false;
            setStart(frameToSeconds(f, fps));
            seekToTime(useSnip.getState().start);
          }}
        />
        <div className="flex flex-col items-center pb-1.5 text-center">
          <span className="t-caption text-[var(--text-tertiary)]">Duración del recorte</span>
          <motion.span
            key={Math.round(selDur * fps)}
            initial={{ opacity: 0.4, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="t-body-strong tabular"
            data-testid="sel-duration"
          >
            {formatDuration(selDur)}
            <span className="t-caption ml-2 font-normal text-[var(--text-tertiary)]">{secondsToTimecode(selDur, fps)}</span>
          </motion.span>
        </div>
        <TimecodeInput
          label="Fin"
          value={end}
          fps={fps}
          inclusiveEnd
          testId="tc-end"
          onCommit={(f) => {
            const startF = secondsToFrame(useSnip.getState().start + 1e-6, fps);
            if (f <= startF) return false;
            setEnd(frameToSeconds(f, fps));
            const st = useSnip.getState();
            seekToFrame(secondsToFrame(st.end, fps) - 1);
          }}
        />
      </div>
    </div>
  );
}

interface HandleProps {
  side: "start" | "end";
  x: MotionValue<number>;
  dragging: boolean;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  label: string;
  valueNow: number;
  max: number;
}

function Handle({ side, x, dragging, onPointerDown, onKeyDown, label, valueNow, max }: HandleProps) {
  return (
    <motion.div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(valueNow * 1000) / 1000}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`tl-handle tl-handle-${side} absolute -top-[6px] z-10 flex h-[calc(100%+12px)] cursor-ew-resize items-center justify-center outline-none`}
      style={{ x, width: HANDLE_W }}
      animate={{ scaleY: dragging ? 1.06 : 1, scaleX: dragging ? 1.12 : 1 }}
      whileHover={{ scaleX: 1.08 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
      data-testid={`handle-${side}`}
      data-dragging={dragging}
    >
      <motion.span
        className="tl-handle-glow pointer-events-none absolute -inset-[3px]"
        initial={false}
        animate={{ opacity: dragging ? 1 : 0 }}
        transition={{ duration: 0.18 }}
      />
      <span className="tl-handle-body absolute inset-0" />
      <span className="relative h-6 w-[3px] rounded-full bg-[var(--text-on-accent)] opacity-55" />
    </motion.div>
  );
}
