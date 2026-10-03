import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Clip, Look } from "../../../project/model";
import { LOOKS } from "../../../engine/color";
import { gestureEnd, gestureStart, useEditor } from "../../../store/editor";
import { player } from "../../../store/controller";
import { RangeSlider } from "../../ui/RangeSlider";
import { Field, Section } from "../Field";
import { setVideo } from "./common";

const OPTIONS: (Look | null)[] = [null, ...LOOKS.map((l) => ({ id: l.id, intensity: 1 }))];

/** Looks de un click, con miniaturas del cuadro actual; intensidad del elegido. */
export function LooksSection({ clip }: { clip: Clip }) {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const [thumbs, setThumbs] = useState<string[] | null>(null);
  const sig = JSON.stringify([clip.id, clip.video.color, clip.video.crop, clip.video.rotate, clip.video.flipH, clip.video.flipV]);

  // Miniaturas del cuadro actual (en pausa; un poco después de que se asiente).
  useEffect(() => {
    if (playing) return;
    let alive = true;
    const id = window.setTimeout(() => {
      const t = player().lookThumbs(OPTIONS, 112, 64);
      if (alive && t) setThumbs(t);
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [sig, time, playing]);

  const current = clip.video.look;
  return (
    <Section title="Looks" testId="looks-section">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Look">
        {OPTIONS.map((o, i) => {
          const sel = (o?.id ?? null) === (current?.id ?? null);
          const label = o ? LOOKS.find((l) => l.id === o.id)!.label : "Ninguno";
          return (
            <motion.button
              key={o?.id ?? "none"}
              type="button"
              role="radio"
              aria-checked={sel}
              whileTap={{ scale: 0.96 }}
              className={`look-card flex flex-col gap-1 rounded-[6px] p-1 text-left outline-none ${sel ? "is-selected" : ""}`}
              onClick={() => setVideo(clip.id, (v) => ({ ...v, look: o ? { id: o.id, intensity: current?.intensity ?? 1 } : null }))}
              data-testid={`look-${o?.id ?? "none"}`}
            >
              <span className="look-thumb block aspect-video w-full overflow-hidden rounded-[4px]">
                {thumbs?.[i] ? <img src={thumbs[i]} alt="" className="h-full w-full object-cover" draggable={false} /> : <span className={`skeleton block h-full w-full look-swatch-${o?.id ?? "none"}`} />}
              </span>
              <span className="t-caption truncate px-0.5">{label}</span>
            </motion.button>
          );
        })}
      </div>
      {current && (
        <Field label="Intensidad" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(current.intensity * 100)}%</span>}>
          <RangeSlider
            label="Intensidad del look"
            value={current.intensity}
            min={0}
            max={1}
            step={0.01}
            resetTo={1}
            onStart={gestureStart}
            onEnd={gestureEnd}
            onChange={(v) => setVideo(clip.id, (vid) => ({ ...vid, look: vid.look ? { ...vid.look, intensity: v } : null }))}
            testId="look-intensity"
          />
        </Field>
      )}
    </Section>
  );
}
