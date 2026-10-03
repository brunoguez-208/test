// Editor de la rampa de velocidad: presets de un clic, curva con puntos
// arrastrables (doble clic agrega/borra) y qué hacer con el audio.

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import type { Clip, RampAudio, SpeedKey } from "../../project/model";
import { MAX_SPEED, MIN_SPEED, RAMP_PRESETS, rampDuration, speedAt } from "../../project/ramp";
import { addSpeedKey, clearRamp, moveSpeedKey, removeSpeedKey, setRampAudio, setRampPreset } from "../../project/rampOps";
import { edit, gestureEnd, gestureStart } from "../../store/editor";
import { formatDuration } from "../../lib/timecode";
import { Segmented } from "../ui/Segmented";
import { Field, fmtNum } from "./Field";

const W = 248;
const H = 96;
// Escala logarítmica de 0,1× a 10× (1× en el medio).
const yOf = (v: number) => H * (1 - (Math.log10(v) + 1) / 2);
const vOf = (y: number) => Math.pow(10, (1 - y / H) * 2 - 1);
const snapV = (v: number) => {
  for (const s of [0.25, 0.5, 1, 2, 4]) if (Math.abs(Math.log10(v / s)) < 0.03) return s;
  return Math.round(v * 100) / 100;
};

function Curve({ clip }: { clip: Clip }) {
  const keys = clip.speedKeys ?? [];
  const len = Math.max(1e-3, clip.outPoint - clip.inPoint);
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const xOf = (t: number) => (t / len) * W;
  const pts: string[] = [];
  for (let x = 0; x <= W; x += 2) pts.push(`${x},${yOf(speedAt(keys, (x / W) * len)).toFixed(1)}`);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return {
      t: ((e.clientX - r.left) / r.width) * len,
      v: snapV(Math.min(MAX_SPEED, Math.max(MIN_SPEED, vOf(((e.clientY - r.top) / r.height) * H)))),
    };
  };
  const drag = (k: SpeedKey) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setActive(k.id);
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        started = true;
        gestureStart();
      }
      const { t, v } = at(ev);
      edit((p) => moveSpeedKey(p, clip.id, k.id, t, v));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (started) gestureEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const sel = keys.find((k) => k.id === active);
  return (
    <div className="flex flex-col gap-1">
      <svg
        ref={svg}
        className="ramp-curve w-full rounded-[4px]"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
        onDoubleClick={(e) => {
          const { t, v } = at(e);
          edit((p) => {
            const [q, id] = addSpeedKey(p, clip.id, t, v);
            setActive(id);
            return q;
          });
        }}
        data-testid="ramp-curve"
      >
        <line x1={0} x2={W} y1={yOf(1)} y2={yOf(1)} className="ramp-one" />
        <polyline points={pts.join(" ")} className="ramp-line" fill="none" vectorEffect="non-scaling-stroke" />
        {keys.map((k) => (
          <circle
            key={k.id}
            cx={xOf(k.t)}
            cy={yOf(k.v)}
            r={4.5}
            className={`ramp-key ${k.id === active ? "is-active" : ""}`}
            vectorEffect="non-scaling-stroke"
            onPointerDown={drag(k)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              edit((p) => removeSpeedKey(p, clip.id, k.id));
            }}
            data-testid="ramp-key"
            data-v={k.v.toFixed(2)}
          >
            <title>{`${fmtNum(k.v, 2)}× · doble clic para borrar`}</title>
          </circle>
        ))}
      </svg>
      <div className="t-caption flex justify-between text-[var(--text-tertiary)]">
        <span>{sel ? `Punto: ${fmtNum(sel.v, 2)}×` : "Doble clic en la curva agrega un punto"}</span>
        <span className="tabular" data-testid="ramp-duration">
          {formatDuration(rampDuration(keys, len))}
        </span>
      </div>
    </div>
  );
}

export function RampEditor({ clip }: { clip: Clip }) {
  const on = !!clip.speedKeys?.length;
  return (
    <div className="flex flex-col gap-3" data-testid="ramp-editor">
      <Field label="Rampa de velocidad">
        <div className="flex flex-wrap gap-1">
          {RAMP_PRESETS.map((r) => (
            <motion.button
              key={r.id}
              type="button"
              whileTap={{ scale: 0.95 }}
              className="chip t-caption rounded-[4px] px-2 py-1"
              onClick={() => edit((p) => setRampPreset(p, clip.id, r.id))}
              data-testid={`ramp-${r.id}`}
            >
              {r.label}
            </motion.button>
          ))}
          {on && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              className="chip t-caption rounded-[4px] px-2 py-1"
              onClick={() => edit((p) => clearRamp(p, clip.id))}
              data-testid="ramp-clear"
            >
              Quitar rampa
            </motion.button>
          )}
        </div>
      </Field>
      <AnimatePresence initial={false}>
        {on && (
          <motion.div key="ramp" className="flex flex-col gap-3" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Curve clip={clip} />
            <Field label="Audio durante la rampa">
              <Segmented<RampAudio>
                label="Audio durante la rampa"
                value={clip.rampAudio ?? "mute"}
                onChange={(v) => edit((p) => setRampAudio(p, clip.id, v))}
                options={[
                  { value: "mute", label: "Silenciado" },
                  {
                    value: "pitch",
                    label: "Mantener tono",
                    title: "Cada tramo con su velocidad, sin cambiar el tono",
                  },
                ]}
                size="sm"
                testId="ramp-audio"
              />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
