import type { Project } from "../../project/model";
import { canvasFps } from "../../project/model";
import { totalDuration } from "../../project/timeline";
import { formatFps } from "../../lib/timecode";
import { edit, gestureEnd, gestureStart } from "../../store/editor";
import { RangeSlider } from "../ui/RangeSlider";
import { Field, Section, fmtNum } from "./Field";

export function VideoTab({ project }: { project: Project }) {
  const total = totalDuration(project);
  const max = Math.max(0.1, Math.min(10, total / 2));
  const f = project.fades;
  return (
    <div className="flex flex-col gap-6" data-testid="video-tab">
      <Section title="Fundido a negro">
        <Field label="Al inicio" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{f.fadeIn ? `${fmtNum(f.fadeIn)} s` : "No"}</span>}>
          <RangeSlider
            label="Fundido desde negro al inicio"
            value={f.fadeIn}
            min={0}
            max={max}
            step={0.1}
            resetTo={0}
            onStart={gestureStart}
            onEnd={gestureEnd}
            onChange={(v) => edit((p) => ({ ...p, fades: { ...p.fades, fadeIn: v } }))}
            testId="global-fade-in"
          />
        </Field>
        <Field label="Al final" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{f.fadeOut ? `${fmtNum(f.fadeOut)} s` : "No"}</span>}>
          <RangeSlider
            label="Fundido a negro al final"
            value={f.fadeOut}
            min={0}
            max={max}
            step={0.1}
            resetTo={0}
            onStart={gestureStart}
            onEnd={gestureEnd}
            onChange={(v) => edit((p) => ({ ...p, fades: { ...p.fades, fadeOut: v } }))}
            testId="global-fade-out"
          />
        </Field>
        <p className="t-caption text-[var(--text-secondary)]">El sonido también se funde.</p>
      </Section>
      <Section title="Lienzo">
        <div className="setting-row t-caption tabular flex justify-between rounded-[6px] px-3.5 py-2.5 text-[var(--text-secondary)]">
          <span>
            {project.canvas.width}×{project.canvas.height}
          </span>
          <span>{formatFps(canvasFps(project.canvas))} fps</span>
        </div>
        <p className="t-caption text-[var(--text-secondary)]">Toma el tamaño y los fps del primer clip. Los clips de otro tamaño se encajan sin deformarse.</p>
      </Section>
    </div>
  );
}
