import type { Project } from "../../project/model";
import { canvasFps } from "../../project/model";
import { totalDuration } from "../../project/timeline";
import { formatFps } from "../../lib/timecode";
import { edit, gestureEnd, gestureStart } from "../../store/editor";
import { RangeSlider } from "../ui/RangeSlider";
import { basename } from "../../lib/files";
import { Field, Section, fmtNum } from "./Field";
import { useTargetClip } from "./useTarget";
import { FramingSection } from "./video/FramingSection";
import { ZoomSection } from "./video/ZoomSection";
import { ColorSection } from "./video/ColorSection";
import { LooksSection } from "./video/LooksSection";
import { EnhanceSection } from "./video/EnhanceSection";

export function VideoTab({ project }: { project: Project }) {
  const total = totalDuration(project);
  const max = Math.max(0.1, Math.min(10, total / 2));
  const f = project.fades;
  const { clip, index, explicit } = useTargetClip(project);
  const media = clip ? project.media.find((m) => m.id === clip.mediaId) : null;
  return (
    <div className="flex flex-col gap-6" data-testid="video-tab">
      {clip && (
        <>
          <div className="min-w-0">
            <p className="t-body-strong truncate" title={media?.path}>
              {clip.kind === "freeze" ? "Cuadro congelado" : media ? basename(media.path) : "Clip"}
            </p>
            <p className="t-caption tabular text-[var(--text-secondary)]">
              Imagen del clip {index + 1} de {project.clips.length}
              {!explicit && " · bajo el playhead"}
            </p>
          </div>
          <FramingSection project={project} clip={clip} />
          <ZoomSection project={project} clip={clip} index={index} />
          <ColorSection clip={clip} />
          <LooksSection clip={clip} />
          <EnhanceSection clip={clip} />
        </>
      )}
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
