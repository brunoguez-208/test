import { Delete16Regular, ImageAdd20Regular } from "@fluentui/react-icons";
import type { ImageLayer, Overlay, Project } from "../../../project/model";
import { updateOverlay } from "../../../project/overlayOps";
import { deleteClips } from "../../../project/ops";
import { basename } from "../../../lib/files";
import { activeTab, edit, gestureEnd, gestureStart, setSelection, useEditor } from "../../../store/editor";
import { addLogoWithDialog } from "../../../store/controller";
import { Button, IconButton } from "../../ui/Button";
import { RangeSlider } from "../../ui/RangeSlider";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section } from "../Field";

type ImageOverlay = Overlay & ImageLayer;

const CORNERS: { id: string; label: string; x: number; y: number }[] = [
  { id: "tl", label: "↖", x: 0, y: 0 },
  { id: "tr", label: "↗", x: 1, y: 0 },
  { id: "c", label: "•", x: 0.5, y: 0.5 },
  { id: "bl", label: "↙", x: 0, y: 1 },
  { id: "br", label: "↘", x: 1, y: 1 },
];

function setImage(id: string, f: (o: ImageOverlay) => ImageOverlay) {
  edit((p) => updateOverlay(p, id, (o) => (o.type === "image" ? f(o as ImageOverlay) : o)));
}

/** Logo / marca de agua: agregar y ajustar la imagen seleccionada. */
export function ImageOverlaySection({ project }: { project: Project }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const o = project.overlays.find((x) => x.type === "image" && selection.includes(x.id)) as ImageOverlay | undefined;
  const m = o ? project.media.find((x) => x.id === o.mediaId) : undefined;
  // Ubica la imagen en una esquina con el mismo margen en píxeles en los dos ejes.
  const place = (cx: number, cy: number) => {
    if (!o || !m) return;
    const W = project.canvas.width;
    const H = project.canvas.height;
    const wPx = o.width * W;
    const hPx = wPx * (m.height / Math.max(1, m.width));
    const margin = 0.03 * W;
    const x = cx === 0.5 ? 0.5 : cx === 0 ? (margin + wPx / 2) / W : 1 - (margin + wPx / 2) / W;
    const y = cy === 0.5 ? 0.5 : cy === 0 ? (margin + hPx / 2) / H : 1 - (margin + hPx / 2) / H;
    setImage(o.id, (z) => ({ ...z, x, y }));
  };
  return (
    <Section title="Logo o marca de agua" testId="image-overlay-section">
      <Button icon={<ImageAdd20Regular />} onClick={() => void addLogoWithDialog()} disabled={!project.clips.length} data-testid="add-logo">
        Agregar imagen
      </Button>
      {o && m && (
        <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="image-editor">
          <p className="t-body-strong truncate" title={m.path}>
            {basename(m.path)}
          </p>
          <Field label="Tamaño" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.width * 100)}%</span>}>
            <RangeSlider label="Tamaño de la imagen" value={o.width} min={0.03} max={1} step={0.005} resetTo={0.16} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setImage(o.id, (z) => ({ ...z, width: v }))} testId="image-size" />
          </Field>
          <Field label="Opacidad" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.opacity * 100)}%</span>}>
            <RangeSlider label="Opacidad de la imagen" value={o.opacity} min={0.05} max={1} step={0.01} resetTo={0.9} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setImage(o.id, (z) => ({ ...z, opacity: v }))} testId="image-opacity" />
          </Field>
          <Field label="Esquinas redondeadas" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.radius * 200)}%</span>}>
            <RangeSlider label="Esquinas redondeadas" value={o.radius} min={0} max={0.5} step={0.01} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setImage(o.id, (z) => ({ ...z, radius: v }))} testId="image-radius" />
          </Field>
          <Field inline label="Sombra">
            <Toggle checked={o.shadow} onChange={(on) => setImage(o.id, (z) => ({ ...z, shadow: on }))} label="Sombra de la imagen" testId="image-shadow" />
          </Field>
          <div className="flex items-center gap-1" role="group" aria-label="Ubicar en">
            <span className="t-caption mr-1 text-[var(--text-secondary)]">Ubicar</span>
            {CORNERS.map((c) => (
              <button key={c.id} type="button" className="chip t-caption h-7 w-7 rounded-[4px]" onClick={() => place(c.x, c.y)} aria-label={`Ubicar ${c.id}`} data-testid={`image-place-${c.id}`}>
                {c.label}
              </button>
            ))}
            <span className="flex-1" />
            <Tooltip content="Quitar la imagen">
              <IconButton
                label="Quitar la imagen"
                onClick={() => {
                  edit((p) => deleteClips(p, [o.id]));
                  setSelection([]);
                }}
                data-testid="image-delete"
              >
                <Delete16Regular />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      )}
    </Section>
  );
}
