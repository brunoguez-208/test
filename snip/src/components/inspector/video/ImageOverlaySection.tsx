import { Delete16Regular, ImageAdd20Regular } from "@fluentui/react-icons";
import type { ImageLayer, Overlay, Project } from "../../../project/model";
import { MIN_OVERLAY, setWatermark, updateOverlay } from "../../../project/overlayOps";
import { totalDuration } from "../../../project/timeline";
import { AnimField, ANIMS } from "../text/TextLayerEditor";
import { deleteClips } from "../../../project/ops";
import { basename } from "../../../lib/files";
import { activeTab, edit, gestureEnd, gestureStart, setSelection, useEditor } from "../../../store/editor";
import { addImageWithDialog } from "../../../store/controller";
import { Button, IconButton } from "../../ui/Button";
import { RangeSlider } from "../../ui/RangeSlider";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section } from "../Field";

type ImageOverlay = Overlay & ImageLayer;

const IMAGE_ANIMS = ANIMS.filter((a) => a.value !== "typewriter");

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

/** Imagen: una capa más (posición, tamaño, rotación, opacidad, duración, animación) o marca de agua. */
export function ImageOverlaySection({ project }: { project: Project }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const o = project.overlays.find((x) => x.type === "image" && selection.includes(x.id)) as ImageOverlay | undefined;
  const m = o ? project.media.find((x) => x.id === o.mediaId) : undefined;
  // Ubica la imagen en una esquina con el mismo margen en píxeles en los dos ejes.
  const corner = (cx: number, cy: number) => {
    if (!o || !m) return null;
    const W = project.canvas.width;
    const H = project.canvas.height;
    const wPx = o.width * W;
    const hPx = wPx * (m.height / Math.max(1, m.width));
    const margin = 0.03 * W;
    const x = cx === 0.5 ? 0.5 : cx === 0 ? (margin + wPx / 2) / W : 1 - (margin + wPx / 2) / W;
    const y = cy === 0.5 ? 0.5 : cy === 0 ? (margin + hPx / 2) / H : 1 - (margin + hPx / 2) / H;
    return { x, y };
  };
  const place = (cx: number, cy: number) => {
    const c = corner(cx, cy);
    if (o && c) setImage(o.id, (z) => ({ ...z, ...c }));
  };
  return (
    <Section title="Imagen" testId="image-overlay-section">
      <Button icon={<ImageAdd20Regular />} onClick={() => void addImageWithDialog()} disabled={!project.clips.length} data-testid="add-logo">
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
          <Field label="Rotación" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.rotation ?? 0)}°</span>}>
            <RangeSlider label="Rotación de la imagen" value={o.rotation ?? 0} min={-180} max={180} step={1} resetTo={0} origin={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setImage(o.id, (z) => ({ ...z, rotation: v }))} testId="image-rotation" />
          </Field>
          <Field inline label="Sombra">
            <Toggle checked={o.shadow} onChange={(on) => setImage(o.id, (z) => ({ ...z, shadow: on }))} label="Sombra de la imagen" testId="image-shadow" />
          </Field>
          <Field inline label="Usar como marca de agua" hint={o.watermark ? "Dura todo el video y se ajusta sola si cambia el largo." : "La imagen pasa a durar todo el video, en una esquina."}>
            <Toggle
              checked={!!o.watermark}
              onChange={(on) => {
                // Un solo paso de deshacer: marca de agua + abajo a la derecha.
                const c = on ? corner(1, 1) : null;
                edit((p) => {
                  const q = setWatermark(p, o.id, on);
                  return c ? updateOverlay(q, o.id, (z) => ({ ...z, ...c })) : q;
                });
              }}
              label="Usar como marca de agua"
              testId="image-watermark"
            />
          </Field>
          {!o.watermark && (
            <>
              <Field label="Duración" aside={<span className="t-caption tabular text-[var(--text-secondary)]" data-testid="image-duration-value">{o.duration.toFixed(1)} s</span>}>
                <RangeSlider
                  label="Duración de la imagen"
                  value={o.duration}
                  min={MIN_OVERLAY}
                  max={Math.max(MIN_OVERLAY, totalDuration(project) - o.start)}
                  step={0.1}
                  resetTo={5}
                  onStart={gestureStart}
                  onEnd={gestureEnd}
                  onChange={(v) => setImage(o.id, (z) => ({ ...z, duration: v }))}
                  testId="image-duration"
                />
              </Field>
              <AnimField label="Entrada" value={o.animIn ?? null} options={IMAGE_ANIMS} onChange={(a) => setImage(o.id, (z) => ({ ...z, animIn: a }))} testId="image-anim-in" />
              <AnimField label="Salida" value={o.animOut ?? null} options={IMAGE_ANIMS} onChange={(a) => setImage(o.id, (z) => ({ ...z, animOut: a }))} testId="image-anim-out" />
            </>
          )}
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
