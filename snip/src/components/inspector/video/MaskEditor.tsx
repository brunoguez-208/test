// Máscara de forma del PiP: círculo, rectángulo o redondeado, con borde suave,
// invertible y con keyframes de posición y tamaño (por ejemplo, la cámara en
// un círculo que sigue a la cara).

import { AnimatePresence, motion } from "motion/react";
import type { MaskShape, Overlay, PipLayer, Project } from "../../../project/model";
import { addMaskKey, pipRect, removeMaskKeys, setPipMask, updateOverlay } from "../../../project/overlayOps";
import { defaultMask } from "../../../engine/mask";
import { edit, gestureEnd, gestureStart, useEditor } from "../../../store/editor";
import { Button } from "../../ui/Button";
import { RangeSlider } from "../../ui/RangeSlider";
import { Segmented } from "../../ui/Segmented";
import { Toggle } from "../../ui/Toggle";
import { Field } from "../Field";

type PipOverlay = Overlay & PipLayer;
type ShapeChoice = "none" | MaskShape;

const pct = (v: number) => <span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(v * 100)}%</span>;

export function MaskSection({ project, o }: { project: Project; o: PipOverlay }) {
  const m = o.mask ?? null;
  const editing = useEditor((s) => s.maskEdit === o.id);
  const time = useEditor((s) => s.time);
  const u = time - o.start;
  const inside = u >= 0 && u <= o.duration;
  const set = (f: (x: NonNullable<PipLayer["mask"]>) => NonNullable<PipLayer["mask"]>) =>
    edit((p) => updateOverlay(p, o.id, (z) => (z.type === "video" && z.mask ? { ...z, mask: f(z.mask) } : z)));
  const choose = (v: ShapeChoice) => {
    if (v === "none") {
      edit((p) => setPipMask(p, o.id, null));
      useEditor.setState({ maskEdit: null });
      return;
    }
    const media = project.media.find((x) => x.id === o.mediaId);
    const r = media ? pipRect(o, media, project.canvas.width, project.canvas.height) : { w: 16, h: 9 };
    // Cambiar de forma conserva el rectángulo; un círculo nuevo arranca redondo de verdad.
    edit((p) => setPipMask(p, o.id, m ? { ...m, shape: v } : defaultMask(v, r.w, r.h)));
    useEditor.setState({ maskEdit: o.id });
  };
  return (
    <div className="flex flex-col gap-3" data-testid="mask-section">
      <Field label="Máscara">
        <Segmented<ShapeChoice>
          label="Forma de la máscara"
          value={m?.shape ?? "none"}
          onChange={choose}
          options={[
            { value: "none", label: "No" },
            { value: "circle", label: "Círculo" },
            { value: "rect", label: "Rect.", title: "Rectángulo" },
            { value: "rounded", label: "Redond.", title: "Rectángulo redondeado" },
          ]}
          size="sm"
          testId="mask-shape"
        />
      </Field>
      <AnimatePresence initial={false}>
        {m && (
          <motion.div key="mask" className="flex flex-col gap-3" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Button variant={editing ? "accent" : undefined} onClick={() => useEditor.setState({ maskEdit: editing ? null : o.id })} data-testid="mask-edit">
              {editing ? "Listo" : "Acomodar en la vista previa"}
            </Button>
            <Field label="Borde suave" aside={pct(m.feather)}>
              <RangeSlider
                label="Borde suave de la máscara"
                value={m.feather}
                min={0}
                max={1}
                step={0.01}
                resetTo={0.1}
                onStart={gestureStart}
                onEnd={gestureEnd}
                onChange={(v) => set((x) => ({ ...x, feather: v }))}
                testId="mask-feather"
              />
            </Field>
            {m.shape === "rounded" && (
              <Field label="Esquinas" aside={pct(m.radius * 2)}>
                <RangeSlider
                  label="Esquinas de la máscara"
                  value={m.radius}
                  min={0}
                  max={0.5}
                  step={0.01}
                  resetTo={0.2}
                  onStart={gestureStart}
                  onEnd={gestureEnd}
                  onChange={(v) => set((x) => ({ ...x, radius: v }))}
                  testId="mask-radius"
                />
              </Field>
            )}
            <Field inline label="Invertir" hint="Muestra lo de afuera de la forma.">
              <Toggle checked={m.invert} onChange={(v) => set((x) => ({ ...x, invert: v }))} label="Invertir la máscara" testId="mask-invert" />
            </Field>
            {m.keys.length === 0 ? (
              <Button onClick={() => edit((p) => addMaskKey(p, o.id, u))} disabled={!inside} data-testid="mask-track">
                Animar posición y tamaño
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <p className="t-caption flex-1 text-[var(--text-secondary)]" data-testid="mask-keys">
                  {m.keys.length} {m.keys.length === 1 ? "keyframe" : "keyframes"}. Mové el playhead y acomodá la máscara: se interpola entre keyframes.
                </p>
                <Button variant="subtle" onClick={() => edit((p) => removeMaskKeys(p, o.id, Math.max(0, u)))} data-testid="mask-untrack">
                  Quitar
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
