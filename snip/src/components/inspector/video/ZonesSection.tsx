import { Blur20Regular, Delete16Regular, Grid16Regular, PictureInPicture20Regular } from "@fluentui/react-icons";
import type { BlurLayer, Overlay, PipLayer, Project } from "../../../project/model";
import { addBlurKey, removeBlurKeys, updateOverlay } from "../../../project/overlayOps";
import { deleteClips } from "../../../project/ops";
import { basename } from "../../../lib/files";
import { activeTab, edit, gestureEnd, gestureStart, setSelection, useEditor } from "../../../store/editor";
import { addBlurAtPlayhead, addPipWithDialog } from "../../../store/controller";
import { Button, IconButton } from "../../ui/Button";
import { RangeSlider } from "../../ui/RangeSlider";
import { Segmented } from "../../ui/Segmented";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section } from "../Field";
import { ChromaEditor } from "./ChromaEditor";
import { MaskSection } from "./MaskEditor";

type BlurOverlay = Overlay & BlurLayer & { type: "blur" };
type PipOverlay = Overlay & PipLayer;

function setOverlay<T extends Overlay>(id: string, f: (o: T) => T) {
  edit((p) => updateOverlay(p, id, (o) => f(o as T)));
}

function RemoveButton({ id, label }: { id: string; label: string }) {
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        onClick={() => {
          edit((p) => deleteClips(p, [id]));
          setSelection([]);
        }}
        data-testid="zone-delete"
      >
        <Delete16Regular />
      </IconButton>
    </Tooltip>
  );
}

function BlurEditor({ o }: { o: BlurOverlay }) {
  const time = useEditor((s) => s.time);
  const u = time - o.start;
  const inside = u >= 0 && u < o.duration;
  return (
    <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="blur-editor">
      <Segmented
        label="Tipo"
        value={o.mode}
        options={[
          { value: "blur", label: "Desenfocar" },
          { value: "pixelate", label: "Pixelar" },
        ]}
        onChange={(mode) => setOverlay<BlurOverlay>(o.id, (z) => ({ ...z, mode }))}
        testId="blur-mode"
      />
      <Field label="Intensidad" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.strength * 100)}%</span>}>
        <RangeSlider label="Intensidad" value={o.strength} min={0.05} max={1} step={0.01} resetTo={0.6} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setOverlay<BlurOverlay>(o.id, (z) => ({ ...z, strength: v }))} testId="blur-strength" />
      </Field>
      {o.keys.length === 0 ? (
        <Button onClick={() => edit((p) => addBlurKey(p, o.id, u))} disabled={!inside} data-testid="blur-track">
          Seguir algo que se mueve
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <p className="t-caption flex-1 text-[var(--text-secondary)]" data-testid="blur-keys">
            {o.keys.length} {o.keys.length === 1 ? "keyframe" : "keyframes"}. Mové el playhead y acomodá la zona: se interpola entre keyframes.
          </p>
          <Button variant="subtle" onClick={() => edit((p) => removeBlurKeys(p, o.id))} data-testid="blur-untrack">
            Quitar
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="t-caption text-[var(--text-secondary)]">Arrastrá la zona y sus bordes en la vista previa.</p>
        <RemoveButton id={o.id} label="Quitar la zona" />
      </div>
    </div>
  );
}

function PipEditor({ project, o }: { project: Project; o: PipOverlay }) {
  const m = project.media.find((x) => x.id === o.mediaId);
  const maxIn = Math.max(0, (m?.duration ?? 0) - o.duration);
  return (
    <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="pip-editor">
      <p className="t-body-strong truncate" title={m?.path}>
        {m ? basename(m.path) : "Video"}
      </p>
      <Field label="Tamaño" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.width * 100)}%</span>}>
        <RangeSlider label="Tamaño del PiP" value={o.width} min={0.1} max={1} step={0.005} resetTo={0.32} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setOverlay<PipOverlay>(o.id, (z) => ({ ...z, width: v }))} testId="pip-size" />
      </Field>
      <Field label="Esquinas redondeadas" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.radius * 200)}%</span>}>
        <RangeSlider label="Esquinas redondeadas del PiP" value={o.radius} min={0} max={0.5} step={0.01} resetTo={0.08} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setOverlay<PipOverlay>(o.id, (z) => ({ ...z, radius: v }))} testId="pip-radius" />
      </Field>
      {!o.mask && (
        <Field inline label="Sombra">
          <Toggle checked={o.shadow} onChange={(on) => setOverlay<PipOverlay>(o.id, (z) => ({ ...z, shadow: on }))} label="Sombra del PiP" testId="pip-shadow" />
        </Field>
      )}
      {m?.hasAudio && (
        <Field label="Volumen" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{o.volume ? `${Math.round(o.volume * 100)}%` : "Sin sonido"}</span>}>
          <RangeSlider label="Volumen del PiP" value={o.volume} min={0} max={1.5} step={0.01} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setOverlay<PipOverlay>(o.id, (z) => ({ ...z, volume: v }))} testId="pip-volume" />
        </Field>
      )}
      {maxIn > 0.05 && (
        <Field label="Empieza en el video" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{o.inPoint.toFixed(1).replace(".", ",")} s</span>}>
          <RangeSlider label="Desde qué segundo del video" value={o.inPoint} min={0} max={maxIn} step={0.1} resetTo={0} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setOverlay<PipOverlay>(o.id, (z) => ({ ...z, inPoint: v }))} testId="pip-in" />
        </Field>
      )}
      <MaskSection project={project} o={o} />
      <ChromaEditor o={o} />
      <div className="flex items-center justify-between">
        <p className="t-caption text-[var(--text-secondary)]">Arrastralo en la vista previa; la esquina lo agranda.</p>
        <RemoveButton id={o.id} label="Quitar el PiP" />
      </div>
    </div>
  );
}

/** Zonas desenfocadas/pixeladas y picture-in-picture. */
export function ZonesSection({ project }: { project: Project }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const sel = project.overlays.find((o) => (o.type === "blur" || o.type === "video") && selection.includes(o.id));
  const disabled = !project.clips.length;
  return (
    <Section title="Zonas y picture-in-picture" testId="zones-section">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Blur20Regular />} onClick={() => addBlurAtPlayhead("blur")} disabled={disabled} data-testid="add-blur">
          Desenfocar zona
        </Button>
        <Button icon={<Grid16Regular />} onClick={() => addBlurAtPlayhead("pixelate")} disabled={disabled} data-testid="add-pixelate">
          Pixelar zona
        </Button>
        <Button icon={<PictureInPicture20Regular />} onClick={() => void addPipWithDialog()} disabled={disabled} data-testid="add-pip">
          Picture-in-picture
        </Button>
      </div>
      {sel?.type === "blur" && <BlurEditor key={sel.id} o={sel as BlurOverlay} />}
      {sel?.type === "video" && <PipEditor key={sel.id} project={project} o={sel as PipOverlay} />}
    </Section>
  );
}
