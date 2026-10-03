import { ArrowReset20Regular } from "@fluentui/react-icons";
import type { Clip, ColorAdjust } from "../../../project/model";
import { DEFAULT_COLOR } from "../../../project/model";
import { gestureEnd, gestureStart } from "../../../store/editor";
import { RangeSlider } from "../../ui/RangeSlider";
import { IconButton } from "../../ui/Button";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section } from "../Field";
import { setVideo } from "./common";

const SLIDERS: { key: keyof ColorAdjust; label: string }[] = [
  { key: "exposure", label: "Exposición" },
  { key: "brightness", label: "Brillo" },
  { key: "contrast", label: "Contraste" },
  { key: "saturation", label: "Saturación" },
  { key: "temperature", label: "Temperatura" },
];

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;

/** Ajustes de color: doble click en un slider lo vuelve a 0. */
export function ColorSection({ clip }: { clip: Clip }) {
  const c = clip.video.color;
  const touched = SLIDERS.some((s) => Math.abs(c[s.key]) > 1e-6);
  return (
    <Section title="Color" testId="color-section">
      {SLIDERS.map((s) => (
        <Field key={s.key} label={s.label} aside={<span className="t-caption tabular text-[var(--text-secondary)]">{pct(c[s.key])}</span>}>
          <RangeSlider
            label={s.label}
            value={c[s.key]}
            min={-1}
            max={1}
            step={0.01}
            origin={0}
            resetTo={0}
            onStart={gestureStart}
            onEnd={gestureEnd}
            onChange={(v) => setVideo(clip.id, (vid) => ({ ...vid, color: { ...vid.color, [s.key]: v } }))}
            testId={`color-${s.key}`}
          />
        </Field>
      ))}
      {touched && (
        <div className="flex justify-end">
          <Tooltip content="Restablecer el color">
            <IconButton label="Restablecer el color" onClick={() => setVideo(clip.id, (v) => ({ ...v, color: DEFAULT_COLOR }))} data-testid="color-reset">
              <ArrowReset20Regular />
            </IconButton>
          </Tooltip>
        </div>
      )}
    </Section>
  );
}
