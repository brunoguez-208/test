import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowUndo16Regular, Delete16Regular, Cut16Regular, Image16Regular, VideoClip20Regular } from "@fluentui/react-icons";
import type { Clip, LoopMode, Project, TransitionKind } from "../../project/model";
import { MAX_LOOP_COUNT, TRANSITIONS } from "../../project/model";
import { deleteClips, freezeAt, setFreezeDuration, setTransition, updateClip } from "../../project/ops";
import { clipDuration, effectiveTransition } from "../../project/timeline";
import { needsHeavy } from "../../project/heavy";
import { basename } from "../../lib/files";
import { formatDuration } from "../../lib/timecode";
import { edit, gestureEnd, gestureStart, setSelection, useEditor } from "../../store/editor";
import { notifyEditError } from "../../store/controller";
import { runShortcut } from "../../hooks/useShortcuts";
import { Button, IconButton } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { RangeSlider } from "../ui/RangeSlider";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Stepper } from "../ui/Stepper";
import { Toggle } from "../ui/Toggle";
import { InfoBar } from "../ui/InfoBar";
import { Empty, Field, Section, fmtNum } from "./Field";
import { useTargetClip } from "./useTarget";
import { RampEditor } from "./RampEditor";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
// Escala logarítmica: 0.25 → 0, 1 → 0.5, 4 → 1.
const speedToPos = (v: number) => (Math.log2(v) + 2) / 4;
const posToSpeed = (p: number) => Math.pow(2, p * 4 - 2);

function setClip(id: string, f: (c: Clip) => Clip) {
  edit((p) => updateClip(p, id, f));
}

export function ClipTab({ project }: { project: Project }) {
  const { clip, index, explicit } = useTargetClip(project);
  const heavy = useEditor((s) => (clip ? s.heavy[clip.id] : undefined));
  const transitionRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const on = () => {
      transitionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlash(true);
      window.setTimeout(() => setFlash(false), 900);
    };
    window.addEventListener("snip:focus-transition", on);
    return () => window.removeEventListener("snip:focus-transition", on);
  }, []);

  if (!clip) {
    return <Empty icon={<VideoClip20Regular />} title="Ningún clip" body="Agregá videos al proyecto o tocá un clip del timeline para ver sus opciones." />;
  }
  const media = project.media.find((m) => m.id === clip.mediaId);
  const freeze = clip.kind === "freeze";
  const dur = clipDuration(clip);
  const tr = effectiveTransition(project.clips, index);

  return (
    <div className="flex flex-col gap-6" data-testid="clip-tab">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="t-body-strong truncate" title={media?.path}>
            {freeze ? "Cuadro congelado" : media ? basename(media.path) : "Clip"}
          </p>
          <p className="t-caption tabular text-[var(--text-secondary)]">
            Clip {index + 1} de {project.clips.length} · {formatDuration(dur)}
            {!explicit && " · bajo el playhead"}
          </p>
        </div>
        <Tooltip content={<>Dividir en el playhead <kbd className="kbd ml-1">S</kbd></>}>
          <IconButton label="Dividir" onClick={() => runShortcut({ type: "split" })} data-testid="clip-split">
            <Cut16Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content={<>Borrar el clip <kbd className="kbd ml-1">Supr</kbd></>}>
          <IconButton
            label="Borrar el clip"
            onClick={() => {
              edit((p) => deleteClips(p, [clip.id]));
              setSelection([]);
            }}
            data-testid="clip-delete"
          >
            <Delete16Regular />
          </IconButton>
        </Tooltip>
      </div>

      {needsHeavy(clip) && heavy?.status === "error" && (
        <InfoBar severity="critical" title="No se pudo preparar la vista previa" message={heavy.error.message} />
      )}

      {freeze ? (
        <Section title="Congelado">
          <Field label="Duración" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(clip.freezeDuration)} s</span>}>
            <RangeSlider
              label="Duración del cuadro congelado"
              value={clip.freezeDuration}
              min={0.5}
              max={10}
              step={0.1}
              onStart={gestureStart}
              onEnd={gestureEnd}
              onChange={(v) => edit((p) => setFreezeDuration(p, clip.id, v))}
              testId="freeze-duration"
            />
          </Field>
        </Section>
      ) : (
        <>
          <Section title="Velocidad">
            {!clip.speedKeys?.length && (
              <>
                <Field label="Velocidad" aside={<span className="t-caption tabular text-[var(--text-secondary)]" data-testid="speed-value">{fmtNum(clip.speed, 2)}×</span>}>
                  <RangeSlider
                    label="Velocidad"
                    value={clip.speed}
                    min={0.25}
                    max={4}
                    step={0.05}
                    resetTo={1}
                    origin={1}
                    toPos={speedToPos}
                    fromPos={(p) => Math.round(posToSpeed(p) * 20) / 20}
                    onStart={gestureStart}
                    onEnd={gestureEnd}
                    onChange={(v) => setClip(clip.id, (c) => ({ ...c, speed: v }))}
                    testId="speed-slider"
                  />
                  <div className="flex gap-1">
                    {SPEEDS.map((s) => (
                      <motion.button
                        key={s}
                        type="button"
                        whileTap={{ scale: 0.95 }}
                        className={`chip t-caption tabular flex-1 rounded-[4px] py-1 ${Math.abs(clip.speed - s) < 1e-6 ? "is-selected" : ""}`}
                        onClick={() => setClip(clip.id, (c) => ({ ...c, speed: s }))}
                        data-testid={`speed-${s}`}
                      >
                        {String(s).replace(".", ",")}×
                      </motion.button>
                    ))}
                  </div>
                </Field>
                <p className="t-caption text-[var(--text-secondary)]">El audio mantiene el tono al cambiar la velocidad.</p>
              </>
            )}
            <RampEditor clip={clip} />
            <AnimatePresence initial={false}>
              {clip.speed < 1 && !clip.speedKeys?.length && (
                <motion.div key="smooth" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <Field inline label="Cámara lenta suave" hint="Inventa cuadros intermedios. Es lenta de procesar." testId="smooth-row">
                    <Toggle checked={clip.smoothSlowmo} onChange={(v) => setClip(clip.id, (c) => ({ ...c, smoothSlowmo: v }))} label="Cámara lenta suave" testId="smooth-toggle" />
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>

          <Section title="Reproducción">
            <Field inline label="Invertir" hint="Reproduce el clip al revés.">
              <Toggle checked={clip.reverse} onChange={(v) => setClip(clip.id, (c) => ({ ...c, reverse: v }))} label="Invertir" testId="reverse-toggle" />
            </Field>
            <Field label="Repetir">
              <Segmented<LoopMode>
                label="Repetir"
                value={clip.loopMode}
                onChange={(v) => setClip(clip.id, (c) => ({ ...c, loopMode: v, loopCount: v === "none" ? 1 : Math.max(2, c.loopCount === 1 && v === "loop" ? 2 : c.loopCount) }))}
                options={[
                  { value: "none", label: "No" },
                  { value: "loop", label: "Loop" },
                  { value: "boomerang", label: "Boomerang", title: "Ida y vuelta" },
                ]}
                testId="loop-mode"
              />
              <AnimatePresence initial={false}>
                {clip.loopMode !== "none" && (
                  <motion.div key="count" className="flex items-center justify-between" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <span className="t-caption text-[var(--text-secondary)]">{clip.loopMode === "boomerang" ? "Idas y vueltas" : "Repeticiones"}</span>
                    <Stepper label="repeticiones" value={clip.loopCount} min={1} max={MAX_LOOP_COUNT} onChange={(v) => setClip(clip.id, (c) => ({ ...c, loopCount: v }))} suffix="×" testId="loop-count" />
                  </motion.div>
                )}
              </AnimatePresence>
            </Field>
            <Button
              icon={<Image16Regular />}
              onClick={() => {
                try {
                  edit((p) => freezeAt(p, useEditor.getState().time, 2));
                } catch (e) {
                  notifyEditError(e);
                }
              }}
              data-testid="freeze-btn"
            >
              Congelar este cuadro (2 s)
            </Button>
          </Section>
        </>
      )}

      {index > 0 && (
        <motion.div ref={transitionRef} animate={flash ? { scale: [1, 1.02, 1] } : {}} transition={{ duration: 0.4 }}>
          <Section title="Transición de entrada" testId="transition-section">
            <Field label="Tipo">
              <Select<TransitionKind | "none">
                label="Transición"
                testId="transition-select"
                value={clip.transition?.kind ?? "none"}
                options={[{ value: "none", label: "Corte directo" }, ...TRANSITIONS.map((t) => ({ value: t.kind, label: t.label }))]}
                onChange={(k) =>
                  edit((p) => setTransition(p, clip.id, k === "none" ? null : { kind: k, duration: clip.transition?.duration ?? 0.8 }))
                }
              />
            </Field>
            <AnimatePresence initial={false}>
              {clip.transition && (
                <motion.div key="dur" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <Field label="Duración" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(tr || clip.transition.duration, 2)} s</span>}>
                    <RangeSlider
                      label="Duración de la transición"
                      value={clip.transition.duration}
                      min={0.1}
                      max={3}
                      step={0.05}
                      resetTo={0.8}
                      onStart={gestureStart}
                      onEnd={gestureEnd}
                      onChange={(v) => edit((p) => setTransition(p, clip.id, { kind: clip.transition!.kind, duration: v }))}
                      testId="transition-duration"
                    />
                  </Field>
                  {tr > 0 && tr < clip.transition.duration - 0.01 && (
                    <p className="t-caption text-[var(--text-secondary)]">Se acorta a {fmtNum(tr, 2)} s porque un clip es muy corto.</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </Section>
        </motion.div>
      )}

      {explicit && (
        <button type="button" className="t-caption flex items-center gap-1 self-start text-[var(--accent-text)] hover:underline" onClick={() => setSelection([])}>
          <ArrowUndo16Regular /> Volver al clip bajo el playhead
        </button>
      )}
    </div>
  );
}
