// Chroma key de un PiP: activar, tomar el color con el gotero sobre la vista
// previa, similitud, suavidad y quitar el reflejo verde/azul.

import { AnimatePresence, motion } from "motion/react";
import { Eyedropper20Regular } from "@fluentui/react-icons";
import { DEFAULT_CHROMA, type ChromaKey, type Overlay, type PipLayer } from "../../../project/model";
import { updateOverlay } from "../../../project/overlayOps";
import { MAX_SIMILARITY, MAX_SMOOTHNESS, MIN_SIMILARITY, parseColor, spillOf } from "../../../engine/chroma";
import { edit, gestureEnd, gestureStart, useEditor } from "../../../store/editor";
import { Button } from "../../ui/Button";
import { RangeSlider } from "../../ui/RangeSlider";
import { Toggle } from "../../ui/Toggle";
import { Field } from "../Field";

type PipOverlay = Overlay & PipLayer;

export function setChroma(id: string, f: (k: ChromaKey | null) => ChromaKey | null) {
  edit((p) => updateOverlay(p, id, (o) => (o.type === "video" ? { ...o, chroma: f(o.chroma ?? null) } : o)));
}

const pct = (v: number) => <span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(v * 100)}%</span>;

export function ChromaEditor({ o }: { o: PipOverlay }) {
  const k = o.chroma ?? null;
  const picking = useEditor((s) => s.eyedropper === o.id);
  const rgb = k ? parseColor(k.color) : null;
  const canDespill = !!rgb && spillOf(rgb) >= 0;
  const set = (patch: Partial<ChromaKey>) => setChroma(o.id, (c) => (c ? { ...c, ...patch } : c));
  return (
    <div className="flex flex-col gap-3" data-testid="chroma-editor">
      <Field inline label="Chroma key" hint="Quita el fondo verde o azul.">
        <Toggle checked={!!k} onChange={(on) => setChroma(o.id, () => (on ? { ...DEFAULT_CHROMA } : null))} label="Chroma key" testId="chroma-toggle" />
      </Field>
      <AnimatePresence initial={false}>
        {k && (
          <motion.div key="chroma" className="flex flex-col gap-3" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <div className="flex items-center gap-2">
              <span className="chroma-swatch h-8 w-8 shrink-0 rounded-[4px]" style={{ background: k.color }} data-testid="chroma-color" data-color={k.color} />
              <Button
                className={`flex-1 ${picking ? "is-active" : ""}`}
                variant={picking ? "accent" : undefined}
                icon={<Eyedropper20Regular />}
                onClick={() => useEditor.setState({ eyedropper: picking ? null : o.id })}
                data-testid="chroma-pick"
              >
                {picking ? "Tocá el fondo en la vista previa" : "Tomar color de la vista previa"}
              </Button>
            </div>
            <Field label="Similitud" aside={pct(k.similarity)}>
              <RangeSlider label="Similitud" value={k.similarity} min={MIN_SIMILARITY} max={MAX_SIMILARITY} step={0.005} resetTo={DEFAULT_CHROMA.similarity} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set({ similarity: v })} testId="chroma-similarity" />
            </Field>
            <Field label="Suavidad del borde" aside={pct(k.smoothness)}>
              <RangeSlider label="Suavidad del borde" value={k.smoothness} min={0} max={MAX_SMOOTHNESS} step={0.005} resetTo={DEFAULT_CHROMA.smoothness} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set({ smoothness: v })} testId="chroma-smoothness" />
            </Field>
            {canDespill && (
              <Field label="Quitar reflejo" aside={pct(k.despill)}>
                <RangeSlider label="Quitar reflejo" value={k.despill} min={0} max={1} step={0.01} resetTo={DEFAULT_CHROMA.despill} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => set({ despill: v })} testId="chroma-despill" />
              </Field>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
