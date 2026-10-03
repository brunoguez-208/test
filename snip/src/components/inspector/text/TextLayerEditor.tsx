import { useEffect, useRef } from "react";
import { Delete16Regular, TextAlignCenter20Regular, TextAlignLeft20Regular, TextAlignRight20Regular, TextBold20Regular, TextItalic20Regular } from "@fluentui/react-icons";
import type { Overlay, Project, TextAnim, TextAnimKind, TextLayer, TextStyle } from "../../../project/model";
import { FONTS } from "../../../project/templates";
import { updateOverlay } from "../../../project/overlayOps";
import { deleteClips } from "../../../project/ops";
import { totalDuration } from "../../../project/timeline";
import { edit, gestureEnd, gestureStart, setSelection } from "../../../store/editor";
import { takeTextFocus } from "../../../store/controller";
import { IconButton } from "../../ui/Button";
import { ColorField } from "../../ui/ColorField";
import { RangeSlider } from "../../ui/RangeSlider";
import { Select } from "../../ui/Select";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { Field, Section, fmtNum } from "../Field";

type TextOverlay = Overlay & TextLayer;

const ANIMS: { value: TextAnimKind | "none"; label: string }[] = [
  { value: "none", label: "Ninguna" },
  { value: "fade", label: "Fundido" },
  { value: "slide", label: "Deslizar" },
  { value: "pop", label: "Pop" },
  { value: "typewriter", label: "Máquina de escribir" },
];

function setText(id: string, f: (o: TextOverlay) => TextOverlay) {
  edit((p) => updateOverlay(p, id, (o) => (o.type === "text" ? f(o as TextOverlay) : o)));
}
const setStyle = (id: string, patch: Partial<TextStyle>) => setText(id, (o) => ({ ...o, style: { ...o.style, ...patch } }));

function AnimField({ label, value, onChange, testId }: { label: string; value: TextAnim | null; onChange: (a: TextAnim | null) => void; testId: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Select
          className="min-w-0 flex-1"
          label={label}
          value={value?.kind ?? "none"}
          options={ANIMS}
          onChange={(k) => onChange(k === "none" ? null : { kind: k, duration: value?.duration ?? 0.4 })}
          testId={testId}
        />
      </div>
      {value && (
        <RangeSlider
          label={`Duración: ${label}`}
          value={value.duration}
          min={0.1}
          max={2}
          step={0.05}
          resetTo={0.4}
          onStart={gestureStart}
          onEnd={gestureEnd}
          onChange={(d) => onChange({ ...value, duration: d })}
          testId={`${testId}-duration`}
        />
      )}
    </Field>
  );
}

/** Opciones de una capa de texto: contenido, fuente, colores, contorno, sombra, fondo y animaciones. */
export function TextLayerEditor({ project, o }: { project: Project; o: TextOverlay }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const s = o.style;
  const total = totalDuration(project);

  // "Agregar texto" lleva el foco al cuadro de texto, con todo seleccionado.
  useEffect(() => {
    const on = () => {
      if (!area.current || !takeTextFocus()) return;
      area.current.focus();
      area.current.select();
    };
    on();
    window.addEventListener("snip:focus-text", on);
    return () => window.removeEventListener("snip:focus-text", on);
  }, []);

  return (
    <Section title="Texto seleccionado" testId="text-editor">
      <textarea
        ref={area}
        className="tc-input t-body min-h-[64px] w-full rounded-[4px] px-2.5 py-2 outline-none"
        value={o.text}
        rows={2}
        aria-label="Texto"
        onFocus={gestureStart}
        onBlur={gestureEnd}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
        }}
        onChange={(e) => setText(o.id, (x) => ({ ...x, text: e.target.value }))}
        data-testid="text-content"
      />
      <Field label="Fuente">
        <Select label="Fuente" value={s.fontFamily} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(f) => setStyle(o.id, { fontFamily: f })} testId="text-font" />
      </Field>
      <Field label="Tamaño" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{Math.round(s.size * 1000) / 10}%</span>}>
        <RangeSlider label="Tamaño del texto" value={s.size} min={0.02} max={0.25} step={0.002} resetTo={0.08} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setStyle(o.id, { size: v })} testId="text-size" />
      </Field>
      <div className="flex items-center gap-1">
        <Tooltip content="Negrita">
          <IconButton label="Negrita" active={s.weight >= 600} onClick={() => setStyle(o.id, { weight: s.weight >= 600 ? 400 : 700 })} data-testid="text-bold">
            <TextBold20Regular />
          </IconButton>
        </Tooltip>
        <Tooltip content="Cursiva">
          <IconButton label="Cursiva" active={s.italic} onClick={() => setStyle(o.id, { italic: !s.italic })} data-testid="text-italic">
            <TextItalic20Regular />
          </IconButton>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-[var(--stroke-divider)]" />
        {(["left", "center", "right"] as const).map((a) => {
          const Icon = a === "left" ? TextAlignLeft20Regular : a === "center" ? TextAlignCenter20Regular : TextAlignRight20Regular;
          const label = a === "left" ? "Alinear a la izquierda" : a === "center" ? "Centrar" : "Alinear a la derecha";
          return (
            <Tooltip key={a} content={label}>
              <IconButton label={label} active={s.align === a} onClick={() => setStyle(o.id, { align: a })} data-testid={`text-align-${a}`}>
                <Icon />
              </IconButton>
            </Tooltip>
          );
        })}
        <span className="flex-1" />
        <ColorField label="Color del texto" value={s.color} onChange={(c) => setStyle(o.id, { color: c })} testId="text-color" />
      </div>

      <Field inline label="Contorno">
        <Toggle checked={!!s.stroke} onChange={(on) => setStyle(o.id, { stroke: on ? { color: "#000000", width: 0.08 } : null })} label="Contorno" testId="text-stroke" />
      </Field>
      {s.stroke && (
        <div className="flex items-center gap-3">
          <ColorField label="Color del contorno" value={s.stroke.color} onChange={(c) => setStyle(o.id, { stroke: { ...s.stroke!, color: c } })} />
          <RangeSlider label="Grosor del contorno" value={s.stroke.width} min={0.01} max={0.2} step={0.005} resetTo={0.08} onStart={gestureStart} onEnd={gestureEnd} onChange={(w) => setStyle(o.id, { stroke: { ...s.stroke!, width: w } })} testId="text-stroke-width" />
        </div>
      )}
      <Field inline label="Sombra">
        <Toggle checked={!!s.shadow} onChange={(on) => setStyle(o.id, { shadow: on ? { color: "rgba(0,0,0,0.55)", blur: 0.18, offsetX: 0, offsetY: 0.05 } : null })} label="Sombra" testId="text-shadow" />
      </Field>
      <Field inline label="Fondo">
        <Toggle checked={!!s.background} onChange={(on) => setStyle(o.id, { background: on ? { color: "#000000", opacity: 0.6, padding: 0.4, radius: 0.25 } : null })} label="Fondo" testId="text-background" />
      </Field>
      {s.background && (
        <div className="flex items-center gap-3">
          <ColorField label="Color del fondo" value={s.background.color} onChange={(c) => setStyle(o.id, { background: { ...s.background!, color: c } })} />
          <RangeSlider label="Opacidad del fondo" value={s.background.opacity} min={0.1} max={1} step={0.01} resetTo={0.6} onStart={gestureStart} onEnd={gestureEnd} onChange={(v) => setStyle(o.id, { background: { ...s.background!, opacity: v } })} testId="text-background-opacity" />
        </div>
      )}

      <AnimField label="Entrada" value={o.animIn} onChange={(a) => setText(o.id, (x) => ({ ...x, animIn: a }))} testId="text-anim-in" />
      <AnimField label="Salida" value={o.animOut} onChange={(a) => setText(o.id, (x) => ({ ...x, animOut: a }))} testId="text-anim-out" />

      <Field label="Duración en pantalla" aside={<span className="t-caption tabular text-[var(--text-secondary)]">{fmtNum(o.duration)} s</span>}>
        <RangeSlider
          label="Duración en pantalla"
          value={o.duration}
          min={0.2}
          max={Math.max(0.3, total - o.start)}
          step={0.1}
          onStart={gestureStart}
          onEnd={gestureEnd}
          onChange={(d) => setText(o.id, (x) => ({ ...x, duration: d }))}
          testId="text-duration"
        />
      </Field>
      <div className="flex items-center justify-between">
        <p className="t-caption text-[var(--text-secondary)]">Arrastralo en la vista previa para ubicarlo.</p>
        <Tooltip content="Borrar el texto">
          <IconButton
            label="Borrar el texto"
            onClick={() => {
              edit((p) => deleteClips(p, [o.id]));
              setSelection([]);
            }}
            data-testid="text-delete"
          >
            <Delete16Regular />
          </IconButton>
        </Tooltip>
      </div>
    </Section>
  );
}
