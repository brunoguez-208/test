// Geometría compartida del timeline: segundos ↔ píxeles, regla y arrastres.

import { useEffect, useRef, useState } from "react";
import { totalDuration } from "../../project/timeline";
import type { Project } from "../../project/model";
import { fitPps, viewport } from "./zoom";

export const GUTTER = 96;
export const PAD_X = 12;
export const RULER_H = 26;
export const VIDEO_H = 64;
export const AUDIO_H = 34;
export const MUSIC_H = 34;
export const OVERLAY_H = 26;

export interface Geo {
  pps: number;
  scroll: number;
  width: number;
  duration: number;
}

export function geometry(p: Project, width: number): Geo {
  const duration = totalDuration(p);
  const fit = fitPps(duration, width);
  const pps = p.view.zoom > 0 ? Math.max(fit, p.view.zoom) : fit;
  const maxScroll = Math.max(0, duration * pps - (width - 2 * PAD_X));
  return { pps, scroll: Math.min(p.view.scroll, maxScroll), width, duration };
}

export const tToX = (g: Geo, t: number) => PAD_X + t * g.pps - g.scroll;
export const xToT = (g: Geo, x: number) => Math.max(0, (x - PAD_X + g.scroll) / g.pps);

/** Ancho del área de pistas (sin la columna de íconos). */
export function useTrackWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const width = Math.max(100, e.contentRect.width);
      viewport.width = width;
      setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Intervalo de marcas de la regla que deja ~90 px entre etiquetas. */
export function rulerStep(pps: number): { major: number; minor: number } {
  const steps = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const major = steps.find((s) => s * pps >= 90) ?? 3600;
  const minor = steps.slice().reverse().find((s) => s < major && (major / s) % 1 < 1e-6 && s * pps >= 12) ?? major;
  return { major, minor };
}

/** Etiqueta corta de la regla: "0:05", "1:30", "12,5". */
export function rulerLabel(t: number, step: number): string {
  if (step < 1) {
    const s = Math.floor(t);
    const frac = Math.round((t - s) * 100);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")},${String(frac).padStart(2, "0").slice(0, step < 0.1 ? 2 : 1)}`;
  }
  const s = Math.round(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

/** Arrastre con pointer capture: onMove recibe el delta en px desde el inicio. */
export function useDrag<T>(handlers: {
  start: (e: React.PointerEvent) => T | null;
  move: (state: T, dx: number, e: PointerEvent) => void;
  end: (state: T, moved: boolean, e: PointerEvent) => void;
}) {
  const h = useRef(handlers);
  h.current = handlers;
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const state = h.current.start(e);
    if (state === null) return;
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      h.current.move(state, ev.clientX - x0, ev);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      h.current.end(state, moved, ev);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
}
