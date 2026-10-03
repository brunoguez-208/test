import { ArrowRotateClockwise20Regular, ArrowRotateCounterclockwise20Regular, Checkmark20Regular, Crop20Regular, FlipHorizontal20Regular, FlipVertical20Regular } from "@fluentui/react-icons";
import type { Clip, Project } from "../../../project/model";
import { ASPECTS, flipClip, rotateClip, setCropAspect } from "../../../project/imageOps";
import { edit, useEditor } from "../../../store/editor";
import { setImageEdit } from "../../../store/controller";
import { Button, IconButton } from "../../ui/Button";
import { Tooltip } from "../../ui/Tooltip";
import { Section } from "../Field";

/** Encuadre: proporción del recorte, editar el recorte sobre el preview, rotar y voltear. */
export function FramingSection({ clip }: { project: Project; clip: Clip }) {
  const editing = useEditor((s) => s.imageEdit?.mode === "crop" && s.imageEdit.clipId === clip.id);
  const current = clip.video.crop ? clip.video.crop.aspect ?? "free" : "original";
  const pick = (id: string) => {
    // Primero se entra al modo recorte: así Esc deshace también la proporción elegida.
    if (id !== "original") setImageEdit({ mode: "crop", clipId: clip.id });
    edit((p) => setCropAspect(p, clip.id, id));
    if (id === "original" && editing) setImageEdit(null);
  };
  return (
    <Section title="Encuadre" testId="framing">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Proporción del recorte">
        {[{ id: "original", label: "Original" }, ...ASPECTS].map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={current === a.id}
            className={`chip t-caption rounded-full px-3 py-1 ${current === a.id ? "is-selected" : ""}`}
            onClick={() => pick(a.id)}
            data-testid={`aspect-${a.id}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {editing ? (
          <Button variant="accent" icon={<Checkmark20Regular />} onClick={() => setImageEdit(null)} data-testid="crop-done">
            Listo
          </Button>
        ) : (
          <Button icon={<Crop20Regular />} onClick={() => setImageEdit({ mode: "crop", clipId: clip.id })} data-testid="crop-edit">
            {clip.video.crop ? "Ajustar recorte" : "Recortar"}
          </Button>
        )}
        <span className="flex-1" />
        <Tooltip content="Rotar a la izquierda">
          <IconButton label="Rotar a la izquierda" onClick={() => edit((p) => rotateClip(p, clip.id, -1))} data-testid="rotate-left">
            <ArrowRotateCounterclockwise20Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content="Rotar a la derecha">
          <IconButton label="Rotar a la derecha" onClick={() => edit((p) => rotateClip(p, clip.id, 1))} data-testid="rotate-right">
            <ArrowRotateClockwise20Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content="Voltear horizontal">
          <IconButton label="Voltear horizontal" active={clip.video.flipH} onClick={() => edit((p) => flipClip(p, clip.id, "h"))} data-testid="flip-h">
            <FlipHorizontal20Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content="Voltear vertical">
          <IconButton label="Voltear vertical" active={clip.video.flipV} onClick={() => edit((p) => flipClip(p, clip.id, "v"))} data-testid="flip-v">
            <FlipVertical20Regular />
          </IconButton>
        </Tooltip>
      </div>
      {editing && <p className="t-caption text-[var(--text-secondary)]">Arrastrá el recuadro o sus bordes sobre la vista previa. Enter confirma, Esc cancela.</p>}
    </Section>
  );
}
