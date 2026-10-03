// Diálogos de proyecto: guardar versión, versiones (restaurar), guardar como
// plantilla, "Nuevo desde plantilla" y el progreso de "Empaquetar proyecto".

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowCounterclockwise16Regular, Delete16Regular, DocumentCopy20Regular, History16Regular } from "@fluentui/react-icons";
import { useEditor } from "../store/editor";
import { mediaSrc, api } from "../lib/platform";
import { formatDuration } from "../lib/timecode";
import {
  newFromTemplate,
  refreshTemplates,
  refreshVersions,
  restoreVersion,
  saveTemplate,
  saveVersion,
  type TemplateChoice,
  type TemplateInfo,
  type VersionInfo,
} from "../store/projectFiles";
import { Dialog } from "./ui/Dialog";
import { Button, IconButton } from "./ui/Button";
import { Toggle } from "./ui/Toggle";
import { ProgressBar } from "./ui/Progress";

const close = () => useEditor.setState({ projectDialog: null });

function when(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString("es-UY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Thumb({ src }: { src: string | null }) {
  return (
    <span className="version-thumb flex h-[42px] w-[74px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-black/30">
      {src ? <img src={src.startsWith("data:") ? src : mediaSrc(src)} alt="" className="h-full w-full object-cover" /> : <History16Regular className="text-[var(--text-tertiary)]" />}
    </span>
  );
}

function VersionRow({ v }: { v: VersionInfo }) {
  return (
    <li className="flex items-center gap-3 rounded-[6px] px-2 py-1.5 hover:bg-[var(--subtle-fill-hover)]" data-testid="version-row">
      <Thumb src={v.thumbnail} />
      <div className="min-w-0 flex-1">
        <p className="t-body-strong truncate text-[var(--text-primary)]">{v.name ?? (v.auto ? "Automática" : "Sin nombre")}</p>
        <p className="t-caption text-[var(--text-secondary)]">
          {when(v.createdAt)} · {formatDuration(v.duration)} · {v.clipCount} {v.clipCount === 1 ? "clip" : "clips"}
          {v.auto && " · al exportar"}
        </p>
      </div>
      <Button className="!h-7" icon={<ArrowCounterclockwise16Regular />} onClick={() => void restoreVersion(v).then(close)} data-testid="version-restore">
        Restaurar
      </Button>
    </li>
  );
}

function TemplateRow({ t }: { t: TemplateInfo }) {
  return (
    <li className="flex items-center gap-3 rounded-[6px] px-2 py-1.5 hover:bg-[var(--subtle-fill-hover)]" data-testid="template-row">
      <Thumb src={t.thumbnail} />
      <div className="min-w-0 flex-1">
        <p className="t-body-strong truncate text-[var(--text-primary)]">{t.name}</p>
        <p className="t-caption truncate text-[var(--text-secondary)]">{t.summary}</p>
      </div>
      <Button variant="accent" className="!h-7" onClick={() => void newFromTemplate(t)} data-testid="template-use">
        Usar
      </Button>
      <IconButton
        label="Borrar plantilla"
        size={28}
        onClick={() => void api.deleteTemplate(t.id).then(refreshTemplates)}
        data-testid="template-delete"
      >
        <Delete16Regular />
      </IconButton>
    </li>
  );
}

export function ProjectDialogs() {
  const dlg = useEditor((s) => s.projectDialog);
  const versions = useEditor((s) => s.versions);
  const templates = useEditor((s) => s.templates);
  const packaging = useEditor((s) => s.packaging);
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<TemplateChoice>({ name: "", intro: true, outro: true, texts: true, exportPreset: true });

  useEffect(() => {
    setName("");
    if (dlg === "versions") void refreshVersions();
    if (dlg === "templates") void refreshTemplates();
    if (dlg === "template") setChoice((c) => ({ ...c, name: "" }));
  }, [dlg]);

  return (
    <>
      <Dialog
        open={dlg === "version"}
        dialogKey="version"
        title="Guardar versión"
        primary="Guardar"
        onPrimary={() => void saveVersion(name.trim() || null).then(close)}
        onClose={close}
      >
        <p className="mb-3">Una foto del proyecto tal como está. Podés volver a ella cuando quieras, sin perder las demás.</p>
        <input
          className="tc-input t-body h-8 w-full rounded-[4px] px-2.5 outline-none"
          placeholder="Nombre (opcional), por ejemplo «Antes del color»"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void saveVersion(name.trim() || null).then(close)}
          autoFocus
          data-testid="version-name"
        />
      </Dialog>

      <Dialog
        open={dlg === "versions"}
        dialogKey="versions"
        title="Versiones del proyecto"
        primary="Guardar versión nueva"
        secondary="Cerrar"
        onPrimary={() => useEditor.setState({ projectDialog: "version" })}
        onClose={close}
      >
        <p className="mb-2">Restaurar es una edición más: Ctrl+Z vuelve atrás y ninguna versión se pisa. Cada exportación guarda una versión automática.</p>
        {versions.length ? (
          <ul className="-mx-2 max-h-[320px] overflow-auto" data-testid="versions-list">
            {versions.map((v) => (
              <VersionRow key={v.id} v={v} />
            ))}
          </ul>
        ) : (
          <p className="t-caption text-[var(--text-tertiary)]" data-testid="versions-empty">
            Todavía no hay versiones.
          </p>
        )}
      </Dialog>

      <Dialog
        open={dlg === "template"}
        dialogKey="template"
        title="Guardar como plantilla"
        primary="Guardar plantilla"
        onPrimary={() => void saveTemplate(choice).then(close)}
        onClose={close}
      >
        <p className="mb-3">Para arrancar videos nuevos con lo mismo. Se copian los archivos que usa (intro, outro, logos).</p>
        <input
          className="tc-input t-body mb-3 h-8 w-full rounded-[4px] px-2.5 outline-none"
          placeholder="Nombre de la plantilla"
          value={choice.name}
          onChange={(e) => setChoice({ ...choice, name: e.target.value })}
          autoFocus
          data-testid="template-name"
        />
        {(
          [
            ["intro", "Intro (el primer clip)"],
            ["outro", "Outro (el último clip)"],
            ["texts", "Textos, logos y estilo de subtítulos"],
            ["exportPreset", "Configuración de exportación"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between py-1">
            <span className="t-body text-[var(--text-primary)]">{label}</span>
            <Toggle checked={choice[k]} onChange={(v) => setChoice({ ...choice, [k]: v })} label={label} testId={`template-${k}`} />
          </div>
        ))}
      </Dialog>

      <Dialog open={dlg === "templates"} dialogKey="templates" title="Nuevo desde plantilla" primary="Cerrar" secondary="Cancelar" onPrimary={close} onClose={close}>
        {templates.length ? (
          <ul className="-mx-2 max-h-[320px] overflow-auto" data-testid="templates-list">
            {templates.map((t) => (
              <TemplateRow key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2" data-testid="templates-empty">
            <DocumentCopy20Regular /> Todavía no hay plantillas. En un proyecto: menú Proyecto → «Guardar como plantilla».
          </p>
        )}
      </Dialog>

      <AnimatePresence>
        {packaging !== null && (
          <motion.div
            className="card fixed bottom-6 left-1/2 z-[75] w-[360px] -translate-x-1/2 p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            data-testid="packaging"
          >
            <p className="t-body-strong mb-2">Empaquetando el proyecto… {Math.round(packaging)}%</p>
            <ProgressBar value={packaging} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
