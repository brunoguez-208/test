// "Automático" (pestaña Audio): detectar jugadas, cortar silencios y marcar los
// beats de la música. Todo se analiza en el equipo.

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Project } from "../../project/model";
import { activeProject, useEditor } from "../../store/editor";
import { applySilences, cancelSilences, clearAutoMarkers, currentSilences, markBeats, previewSilences, runDetectPlays } from "../../store/autoTools";
import { Button } from "../ui/Button";
import { ProgressRing } from "../ui/Progress";
import { RangeSlider } from "../ui/RangeSlider";
import { Stepper } from "../ui/Stepper";
import { Toggle } from "../ui/Toggle";
import { Field, Section, fmtNum } from "./Field";

const aside = (s: string) => <span className="t-caption tabular text-[var(--text-secondary)]">{s}</span>;

function Busy({ on }: { on: boolean }) {
  return on ? <ProgressRing size={16} stroke={2} /> : null;
}

export function AutoSection({ project }: { project: Project }) {
  const busy = useEditor((s) => s.autoBusy);
  const prev = useEditor((s) => s.silencePreview);
  const silences = currentSilences(activeProject(), prev);
  const [sens, setSens] = useState(0.5);
  const [makeRanges, setMakeRanges] = useState(false);
  const [pad, setPad] = useState(5);
  const [thr, setThr] = useState(-42);
  const [minDur, setMinDur] = useState(0.6);
  const [margin, setMargin] = useState(0.15);
  const plays = project.markers.filter((m) => m.kind === "play").length;
  const beats = project.markers.filter((m) => m.kind === "beat").length;
  const noClips = !project.clips.length;
  const cutTotal = silences?.reduce((s, [a, b]) => s + (b - a), 0) ?? 0;
  return (
    <Section title="Automático" testId="auto-section">
      <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="auto-plays">
        <p className="t-body-strong">Detectar jugadas</p>
        <p className="t-caption -mt-2 text-[var(--text-secondary)]">Busca los momentos más fuertes del audio (gritos, disparos, festejos) y les pone un marcador.</p>
        <Field label="Sensibilidad" aside={aside(`${Math.round(sens * 100)}%`)}>
          <RangeSlider label="Sensibilidad" value={sens} min={0} max={1} step={0.05} resetTo={0.5} onChange={setSens} testId="plays-sensitivity" />
        </Field>
        <Field inline label="Crear fragmentos" hint="Uno por jugada, listos para exportar.">
          <Toggle checked={makeRanges} onChange={setMakeRanges} label="Crear fragmentos" testId="plays-ranges" />
        </Field>
        {makeRanges && (
          <div className="flex items-center justify-between">
            <span className="t-caption text-[var(--text-secondary)]">Segundos antes y después</span>
            <Stepper label="segundos" value={pad} min={1} max={30} onChange={setPad} suffix=" s" testId="plays-pad" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button variant="accent" className="flex-1" onClick={() => void runDetectPlays({ sensitivity: sens, pad: makeRanges ? pad : null })} disabled={noClips || !!busy} data-testid="plays-run">
            Detectar jugadas
          </Button>
          <Busy on={busy === "plays"} />
        </div>
        {plays > 0 && (
          <div className="flex items-center gap-2">
            <span className="t-caption flex-1 text-[var(--text-secondary)]" data-testid="plays-count">
              {plays} {plays === 1 ? "jugada marcada" : "jugadas marcadas"} · Shift+M salta a la siguiente
            </span>
            <Button variant="subtle" className="!h-7" onClick={() => clearAutoMarkers("play")} data-testid="plays-clear">
              Quitar
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="auto-silences">
        <p className="t-body-strong">Cortar silencios</p>
        <Field label="Más bajo que" aside={aside(`${thr} dB`)}>
          <RangeSlider label="Umbral de silencio" value={thr} min={-70} max={-20} step={1} resetTo={-42} onChange={setThr} testId="silence-threshold" />
        </Field>
        <Field label="Durante al menos" aside={aside(`${fmtNum(minDur, 1)} s`)}>
          <RangeSlider label="Duración mínima del silencio" value={minDur} min={0.2} max={3} step={0.1} resetTo={0.6} onChange={setMinDur} testId="silence-min" />
        </Field>
        <Field label="Dejar de margen" aside={aside(`${fmtNum(margin, 2)} s`)}>
          <RangeSlider label="Margen alrededor de los cortes" value={margin} min={0} max={0.5} step={0.05} resetTo={0.15} onChange={setMargin} testId="silence-margin" />
        </Field>
        <div className="flex items-center gap-2">
          <Button className="flex-1" onClick={() => void previewSilences({ thresholdDb: thr, minDuration: minDur, margin })} disabled={noClips || !!busy} data-testid="silence-find">
            Buscar silencios
          </Button>
          <Busy on={busy === "silences"} />
        </div>
        <AnimatePresence initial={false}>
          {silences && (
            <motion.div key="prev" className="flex flex-col gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <p className="t-caption text-[var(--text-secondary)]" data-testid="silence-summary">
                {silences.length
                  ? `${silences.length} ${silences.length === 1 ? "silencio" : "silencios"} (en rojo en el timeline) · se quitan ${fmtNum(cutTotal, 1)} s`
                  : "No hay silencios con esos valores."}
              </p>
              <div className="flex gap-2">
                <Button variant="accent" className="flex-1" onClick={applySilences} disabled={!silences.length} data-testid="silence-apply">
                  Cortar
                </Button>
                <Button className="flex-1" onClick={cancelSilences} data-testid="silence-cancel">
                  Cancelar
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-3 rounded-[6px] border border-[var(--stroke-card)] p-3" data-testid="auto-beats">
        <p className="t-body-strong">Beats de la música</p>
        <p className="t-caption -mt-2 text-[var(--text-secondary)]">Marca cada beat: con el imán prendido, los cortes y las capas se pegan al ritmo.</p>
        <div className="flex items-center gap-2">
          <Button className="flex-1" onClick={() => void markBeats()} disabled={!project.music.length || !!busy} data-testid="beats-run">
            {project.music.length ? "Marcar beats" : "Agregá música primero"}
          </Button>
          <Busy on={busy === "beats"} />
        </div>
        {beats > 0 && (
          <div className="flex items-center gap-2">
            <span className="t-caption flex-1 text-[var(--text-secondary)]" data-testid="beats-count">
              {beats} beats marcados
            </span>
            <Button variant="subtle" className="!h-7" onClick={() => clearAutoMarkers("beat")} data-testid="beats-clear">
              Quitar
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
