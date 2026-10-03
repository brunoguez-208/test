import { Add16Regular, Delete16Regular, Diamond16Filled, ZoomIn20Regular } from "@fluentui/react-icons";
import type { Clip, Easing, Project } from "../../../project/model";
import { addZoomKey, kenBurns, MAX_ZOOM, removeZoomKey, updateZoomKey } from "../../../project/imageOps";
import { layout } from "../../../project/timeline";
import { canvasFps } from "../../../project/model";
import { edit, gestureEnd, gestureStart, useEditor } from "../../../store/editor";
import { setImageEdit } from "../../../store/controller";
import { Button, IconButton } from "../../ui/Button";
import { RangeSlider } from "../../ui/RangeSlider";
import { Select } from "../../ui/Select";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section, fmtNum } from "../Field";

const EASINGS: { value: Easing; label: string }[] = [
  { value: "easeInOut", label: "Suave" },
  { value: "linear", label: "Lineal" },
  { value: "easeIn", label: "Acelera" },
  { value: "easeOut", label: "Frena" },
];

/** Zoom y paneo con keyframes: cada keyframe guarda zoom y centro; entre ellos se interpola. */
export function ZoomSection({ project, clip, index }: { project: Project; clip: Clip; index: number }) {
  const time = useEditor((s) => s.time);
  const sel = useEditor((s) => (s.imageEdit?.mode === "zoom" && s.imageEdit.clipId === clip.id ? s.imageEdit.keyId : null));
  const span = layout(project.clips)[index];
  const u = Math.min(span.duration, Math.max(0, time - span.start));
  const inside = time >= span.start - 1e-6 && time < span.end;
  const keys = clip.video.zoom;
  const key = keys.find((k) => k.id === sel) ?? null;
  const add = () => {
    let id = -1;
    edit((p) => {
      const [q, k] = addZoomKey(p, clip.id, u, 1 / canvasFps(p.canvas));
      id = k;
      return q;
    });
    if (id >= 0) setImageEdit({ mode: "zoom", clipId: clip.id, keyId: id });
  };
  return (
    <Section title="Zoom y paneo" testId="zoom-section">
      {keys.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button icon={<Add16Regular />} onClick={add} disabled={!inside} data-testid="zoom-add">
            Keyframe en el playhead
          </Button>
          <Button icon={<ZoomIn20Regular />} onClick={() => edit((p) => kenBurns(p, clip.id))} data-testid="zoom-kenburns">
            Acercamiento lento
          </Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1" data-testid="zoom-keys">
            {keys.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  className={`zoom-key t-body flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left ${k.id === sel ? "is-selected" : ""}`}
                  onClick={() => setImageEdit(k.id === sel ? null : { mode: "zoom", clipId: clip.id, keyId: k.id })}
                  data-testid="zoom-key"
                >
                  <Diamond16Filled className="zoom-diamond shrink-0" />
                  <span className="tabular">{fmtNum(k.t, 1)} s</span>
                  <span className="t-caption tabular ml-auto text-[var(--text-secondary)]">{fmtNum(k.zoom, 2)}×</span>
                </button>
              </li>
            ))}
          </ul>
          <Button icon={<Add16Regular />} onClick={add} disabled={!inside} data-testid="zoom-add">
            Keyframe en el playhead
          </Button>
        </>
      )}
      {key && (
        <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="zoom-key-editor">
          <Field label="Zoom" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(key.zoom, 2)}×</span>}>
            <RangeSlider
              label="Zoom del keyframe"
              value={key.zoom}
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              resetTo={1}
              onStart={gestureStart}
              onEnd={gestureEnd}
              onChange={(v) => edit((p) => updateZoomKey(p, clip.id, key.id, { zoom: v }))}
              testId="zoom-amount"
            />
          </Field>
          <Field label="Hasta el siguiente">
            <Select label="Curva hasta el siguiente keyframe" value={key.easing} options={EASINGS} onChange={(v) => edit((p) => updateZoomKey(p, clip.id, key.id, { easing: v }))} testId="zoom-easing" />
          </Field>
          <div className="flex items-center gap-2">
            <p className="t-caption flex-1 text-[var(--text-secondary)]">Arrastrá el recuadro en la vista previa para elegir qué se ve.</p>
            <Tooltip content="Borrar keyframe">
              <IconButton
                label="Borrar keyframe"
                onClick={() => {
                  setImageEdit(null);
                  edit((p) => removeZoomKey(p, clip.id, key.id));
                }}
                data-testid="zoom-remove"
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
