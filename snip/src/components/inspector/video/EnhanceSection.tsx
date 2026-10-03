import type { Clip } from "../../../project/model";
import { gestureEnd, gestureStart } from "../../../store/editor";
import { RangeSlider } from "../../ui/RangeSlider";
import { Toggle } from "../../ui/Toggle";
import { Field, Section } from "../Field";
import { setVideo } from "./common";

const pct = (v: number) => (v > 0 ? `${Math.round(v * 100)}%` : "No");

/** Estabilizar (2 pasadas de vidstab), nitidez y reducción de ruido de imagen. */
export function EnhanceSection({ clip }: { clip: Clip }) {
  const v = clip.video;
  const freeze = clip.kind === "freeze";
  return (
    <Section title="Mejoras" testId="enhance-section">
      {!freeze && (
        <Field inline label="Estabilizar" hint="Suaviza el temblor de la cámara. Se procesa en segundo plano." testId="stabilize-row">
          <Toggle checked={!!v.stabilize} onChange={(on) => setVideo(clip.id, (x) => ({ ...x, stabilize: on ? { strength: 0.5 } : null }))} label="Estabilizar" testId="stabilize" />
        </Field>
      )}
      {v.stabilize && (
        <Field label="Intensidad de la estabilización" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(v.stabilize.strength * 100)}%</span>}>
          <RangeSlider
            label="Intensidad de la estabilización"
            value={v.stabilize.strength}
            min={0.1}
            max={1}
            step={0.05}
            resetTo={0.5}
            onStart={gestureStart}
            onEnd={gestureEnd}
            onChange={(s) => setVideo(clip.id, (x) => ({ ...x, stabilize: { strength: s } }))}
            testId="stabilize-strength"
          />
        </Field>
      )}
      <Field label="Nitidez" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{pct(v.sharpen)}</span>}>
        <RangeSlider label="Nitidez" value={v.sharpen} min={0} max={1} step={0.01} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(s) => setVideo(clip.id, (x) => ({ ...x, sharpen: s }))} testId="sharpen" />
      </Field>
      {!freeze && (
        <Field label="Reducir ruido" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{pct(v.denoise)}</span>} hint="Para videos con poca luz. Se procesa en segundo plano.">
          <RangeSlider label="Reducir ruido" value={v.denoise} min={0} max={1} step={0.05} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(s) => setVideo(clip.id, (x) => ({ ...x, denoise: s }))} testId="denoise" />
        </Field>
      )}
    </Section>
  );
}
