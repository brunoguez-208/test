// Efectos de un clic (temblor, zoom punch, flash, glitch, viñeta): se agregan
// en el playhead como bloques de la pista de capas; el elegido se ajusta acá.

import { motion } from "motion/react";
import { ArrowMaximize16Regular, CircleShadow20Regular, Delete16Regular, Flash16Regular, Phone16Regular, Sparkle16Regular } from "@fluentui/react-icons";
import type { EffectKind, EffectLayer, Overlay, Project } from "../../../project/model";
import { EFFECTS, effectLabel } from "../../../project/effects";
import { MIN_OVERLAY, updateOverlay } from "../../../project/overlayOps";
import { deleteClips } from "../../../project/ops";
import { totalDuration } from "../../../project/timeline";
import { activeTab, edit, gestureEnd, gestureStart, setSelection, useEditor } from "../../../store/editor";
import { addEffectAtPlayhead } from "../../../store/controller";
import { IconButton } from "../../ui/Button";
import { RangeSlider } from "../../ui/RangeSlider";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section, fmtNum } from "../Field";

type EffectOverlay = Overlay & EffectLayer;

export const EFFECT_ICON: Record<EffectKind, typeof Flash16Regular> = {
  shake: Phone16Regular,
  zoomPunch: ArrowMaximize16Regular,
  flash: Flash16Regular,
  glitch: Sparkle16Regular,
  vignette: CircleShadow20Regular,
};

function setEffect(id: string, f: (o: EffectOverlay) => EffectOverlay) {
  edit((p) => updateOverlay(p, id, (o) => (o.type === "effect" ? f(o as EffectOverlay) : o)));
}

function EffectEditor({ project, o }: { project: Project; o: EffectOverlay }) {
  const maxD = Math.max(MIN_OVERLAY, Math.min(10, totalDuration(project) - o.start));
  return (
    <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="effect-editor">
      <div className="flex items-center gap-2">
        <p className="t-body-strong flex-1 truncate" data-testid="effect-name">
          {effectLabel(o.kind)}
        </p>
        <Tooltip content="Quitar el efecto">
          <IconButton
            label="Quitar el efecto"
            onClick={() => {
              edit((p) => deleteClips(p, [o.id]));
              setSelection([]);
            }}
            data-testid="effect-delete"
          >
            <Delete16Regular />
          </IconButton>
        </Tooltip>
      </div>
      <Field label="Intensidad" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(o.intensity * 100)}%</span>}>
        <RangeSlider label="Intensidad del efecto" value={o.intensity} min={0.05} max={1} step={0.01} resetTo={0.7} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setEffect(o.id, (z) => ({ ...z, intensity: v }))} testId="effect-intensity" />
      </Field>
      <Field label="Duración" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(o.duration, 2)} s</span>}>
        <RangeSlider
          label="Duración del efecto"
          value={Math.min(o.duration, maxD)}
          min={MIN_OVERLAY}
          max={maxD}
          step={0.05}
          resetTo={EFFECTS.find((e) => e.kind === o.kind)?.duration ?? 0.6}
          onStart={gestureStart}
          onEnd={gestureEnd}
          onChange={(v) => setEffect(o.id, (z) => ({ ...z, duration: v }))}
          testId="effect-duration"
        />
      </Field>
      <p className="t-caption text-[var(--text-secondary)]">También podés moverlo o estirarlo en la pista de capas.</p>
    </div>
  );
}

export function EffectsSection({ project }: { project: Project }) {
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const sel = project.overlays.find((o) => o.type === "effect" && selection.includes(o.id)) as EffectOverlay | undefined;
  const disabled = !project.clips.length;
  return (
    <Section title="Efectos" testId="effects-section">
      <div className="grid grid-cols-3 gap-1.5">
        {EFFECTS.map((e) => {
          const Icon = EFFECT_ICON[e.kind];
          return (
            <motion.button
              key={e.kind}
              type="button"
              whileTap={{ scale: 0.95 }}
              disabled={disabled}
              className={`chip t-caption flex flex-col items-center gap-1 rounded-[6px] px-1 py-2 ${sel?.kind === e.kind ? "is-selected" : ""}`}
              onClick={() => addEffectAtPlayhead(e.kind)}
              title={`Agregar ${e.label.toLowerCase()} en el playhead`}
              data-testid={`add-effect-${e.kind}`}
            >
              <Icon className="text-[18px]" />
              {e.label}
            </motion.button>
          );
        })}
      </div>
      {sel && <EffectEditor key={sel.id} project={project} o={sel} />}
    </Section>
  );
}
