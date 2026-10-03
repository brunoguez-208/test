import { useMemo } from "react";
import { Add16Regular, ArrowDownload16Regular, ArrowUpload16Regular, Delete16Regular } from "@fluentui/react-icons";
import type { Project } from "../../../project/model";
import { FONTS } from "../../../project/templates";
import { addCue, removeCue, setSubtitleStyle, shiftCues, updateCue } from "../../../project/overlayOps";
import { edit, gestureEnd, gestureStart, setSelection, useEditor, activeTab } from "../../../store/editor";
import { exportSrt, importSrtWithDialog, player } from "../../../store/controller";
import { Button, IconButton } from "../../ui/Button";
import { ColorField } from "../../ui/ColorField";
import { RangeSlider } from "../../ui/RangeSlider";
import { Select } from "../../ui/Select";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section } from "../Field";

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0").replace(".", ",")}`;
}

/** Edita un tiempo "m:ss,s" (o segundos sueltos). */
function TimeInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      key={value}
      className="tc-input t-caption tabular h-7 w-[62px] rounded-[4px] px-1.5 text-center outline-none"
      defaultValue={fmtTime(value)}
      aria-label={label}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => {
        const raw = e.target.value.trim().replace(",", ".");
        const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(raw);
        if (m) onChange(Number(m[1] ?? 0) * 60 + Number(m[2]));
        else e.target.value = fmtTime(value);
      }}
    />
  );
}

/** Subtítulos: importar/exportar .srt, editar cada uno, estilo y palabra por palabra. */
export function SubtitlesSection({ project }: { project: Project }) {
  const subs = project.subtitles;
  const st = subs.style;
  // Solo el subtítulo activo (no el tiempo): la lista no se redibuja en cada cuadro.
  const activeId = useEditor((s) => subs.cues.find((c) => s.time >= c.start && s.time < c.end)?.id ?? null);
  const selection = useEditor((s) => activeTab(s)?.selection ?? []);
  const hasWords = useMemo(() => subs.cues.some((c) => c.words.length > 0), [subs.cues]);
  const setStyle = (patch: Partial<typeof st>) => edit((p) => setSubtitleStyle(p, patch));

  return (
    <Section title="Subtítulos" testId="subtitles-section">
      <div className="flex flex-wrap gap-2">
        <Button icon={<ArrowUpload16Regular />} onClick={() => void importSrtWithDialog()} data-testid="srt-import">
          Importar .srt
        </Button>
        {subs.cues.length > 0 && (
          <Button icon={<ArrowDownload16Regular />} onClick={() => void exportSrt()} data-testid="srt-export">
            Guardar .srt
          </Button>
        )}
      </div>

      {subs.cues.length > 0 && (
        <>
          <ul className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto pr-1" data-testid="cue-list">
            {subs.cues.map((c) => {
              const active = c.id === activeId;
              const sel = selection.includes(c.id);
              return (
                <li key={c.id} className={`cue-row flex flex-col gap-1 rounded-[4px] px-2 py-1.5 ${active ? "is-active" : ""} ${sel ? "is-selected" : ""}`} data-testid="cue-row">
                  <div className="flex items-center gap-1">
                    <TimeInput label="Inicio del subtítulo" value={c.start} onChange={(v) => edit((p) => updateCue(p, c.id, { start: v }))} />
                    <span className="t-caption text-[var(--text-tertiary)]">→</span>
                    <TimeInput label="Fin del subtítulo" value={c.end} onChange={(v) => edit((p) => updateCue(p, c.id, { end: v }))} />
                    <button
                      type="button"
                      className="t-caption ml-1 text-[var(--accent-text)] hover:underline"
                      onClick={() => {
                        setSelection([c.id]);
                        player().pause();
                        player().seek(c.start);
                      }}
                    >
                      Ir
                    </button>
                    <span className="flex-1" />
                    <IconButton label="Borrar el subtítulo" size={26} onClick={() => edit((p) => removeCue(p, c.id))} data-testid="cue-delete">
                      <Delete16Regular />
                    </IconButton>
                  </div>
                  <textarea
                    className="tc-input t-body w-full rounded-[4px] px-2 py-1 outline-none"
                    rows={Math.min(3, c.text.split("\n").length)}
                    value={c.text}
                    aria-label="Texto del subtítulo"
                    onFocus={() => {
                      gestureStart();
                      setSelection([c.id]);
                    }}
                    onBlur={gestureEnd}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => edit((p) => updateCue(p, c.id, { text: e.target.value }))}
                    data-testid="cue-text"
                  />
                </li>
              );
            })}
          </ul>
          <Button icon={<Add16Regular />} onClick={() => edit((p) => addCue(p, useEditor.getState().time)[0])} data-testid="cue-add">
            Agregar en el playhead
          </Button>
          <div className="flex items-center gap-1">
            <span className="t-caption mr-1 text-[var(--text-secondary)]">Correr todos</span>
            <Tooltip content="Correr todos 0,1 s antes">
              <Button variant="subtle" onClick={() => edit((p) => shiftCues(p, -0.1))} data-testid="cue-shift-back">
                −0,1 s
              </Button>
            </Tooltip>
            <Tooltip content="Correr todos 0,1 s después">
              <Button variant="subtle" onClick={() => edit((p) => shiftCues(p, 0.1))} data-testid="cue-shift-forward">
                +0,1 s
              </Button>
            </Tooltip>
          </div>

          <Field inline label="Palabra por palabra" hint={hasWords ? "Resalta la palabra que se dice (estilo TikTok)." : "Disponible con subtítulos generados automáticamente."}>
            <Toggle checked={subs.wordByWord} onChange={(on) => edit((p) => ({ ...p, subtitles: { ...p.subtitles, wordByWord: on } }))} label="Palabra por palabra" testId="word-by-word" />
          </Field>
          <Field label="Fuente">
            <Select label="Fuente de los subtítulos" value={st.fontFamily} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(f) => setStyle({ fontFamily: f })} testId="sub-font" />
          </Field>
          <Field label="Tamaño" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(st.size * 1000) / 10}%</span>}>
            <RangeSlider label="Tamaño de los subtítulos" value={st.size} min={0.025} max={0.12} step={0.001} resetTo={0.055} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setStyle({ size: v })} testId="sub-size" />
          </Field>
          <Field label="Posición" aside={<span className="t-caption text-[var(--text-secondary)]">{st.y > 0.66 ? "Abajo" : st.y < 0.33 ? "Arriba" : "Centro"}</span>}>
            <RangeSlider label="Posición vertical de los subtítulos" value={st.y} min={0.08} max={0.94} step={0.01} resetTo={0.86} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setStyle({ y: v })} testId="sub-y" />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="t-caption text-[var(--text-secondary)]">Texto</span>
              <ColorField label="Color de los subtítulos" value={st.color} onChange={(c) => setStyle({ color: c })} testId="sub-color" />
            </div>
            {subs.wordByWord && (
              <div className="flex flex-col gap-1">
                <span className="t-caption text-[var(--text-secondary)]">Resaltado</span>
                <ColorField label="Color de la palabra resaltada" value={st.highlight} onChange={(c) => setStyle({ highlight: c })} testId="sub-highlight" />
              </div>
            )}
          </div>
          <Field inline label="Contorno">
            <Toggle checked={!!st.stroke} onChange={(on) => setStyle({ stroke: on ? { color: "#000000", width: 0.12 } : null })} label="Contorno de los subtítulos" testId="sub-stroke" />
          </Field>
          <Field inline label="Fondo">
            <Toggle checked={!!st.background} onChange={(on) => setStyle({ background: on ? { color: "#000000", opacity: 0.55, padding: 0.35, radius: 0.2 } : null })} label="Fondo de los subtítulos" testId="sub-background" />
          </Field>
          <Field inline label="Mayúsculas">
            <Toggle checked={st.uppercase} onChange={(on) => setStyle({ uppercase: on })} label="Subtítulos en mayúsculas" testId="sub-uppercase" />
          </Field>
        </>
      )}
    </Section>
  );
}
