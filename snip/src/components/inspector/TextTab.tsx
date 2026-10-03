import type { Overlay, Project, TextLayer } from "../../project/model";
import { TEXT_TEMPLATES } from "../../project/templates";
import { activeTab, useEditor } from "../../store/editor";
import { addTextAtPlayhead } from "../../store/controller";
import { fontString } from "../../engine/raster";
import { Section } from "./Field";
import { TextLayerEditor } from "./text/TextLayerEditor";
import { SubtitlesSection } from "./text/SubtitlesSection";

type TextOverlay = Overlay & TextLayer;

/** Pestaña Texto: plantillas, la capa de texto seleccionada y los subtítulos. */
export function TextTab({ project }: { project: Project }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const selected = project.overlays.find((o) => o.type === "text" && selection.includes(o.id)) as TextOverlay | undefined;
  return (
    <div className="flex flex-col gap-6" data-testid="text-tab">
      <Section title="Agregar texto">
        <div className="grid grid-cols-2 gap-2" data-testid="text-templates">
          {TEXT_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="template-card flex flex-col gap-1 rounded-[6px] p-1.5 text-left outline-none"
              onClick={() => addTextAtPlayhead(t.id)}
              disabled={!project.clips.length}
              data-testid={`template-${t.id}`}
            >
              <span className="template-preview flex h-12 items-center justify-center overflow-hidden rounded-[4px] px-2">
                <span
                  className="truncate"
                  style={{
                    font: fontString(t.style, 17),
                    color: t.style.color,
                    background: t.style.background ? t.style.background.color : undefined,
                    padding: t.style.background ? "1px 6px" : undefined,
                    borderRadius: t.style.background ? 6 : undefined,
                    WebkitTextStroke: t.style.stroke ? `1px ${t.style.stroke.color}` : undefined,
                    textShadow: t.style.shadow ? `0 1px 6px ${t.style.shadow.color}` : undefined,
                  }}
                >
                  {t.text.split("\n")[0]}
                </span>
              </span>
              <span className="t-caption px-0.5">{t.label}</span>
            </button>
          ))}
        </div>
      </Section>
      {selected && <TextLayerEditor key={selected.id} project={project} o={selected} />}
      <SubtitlesSection project={project} />
    </div>
  );
}
