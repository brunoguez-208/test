// Biblioteca de medios (panel izquierdo): todo lo que se sumó al proyecto, con
// miniatura (pasar el mouse recorre el video), duración, tipo, si está en uso,
// búsqueda y orden. Se importa con el botón, arrastrando o pegando, y cada
// archivo se arrastra a cualquier pista. Doble clic abre el visor de origen.

import { motion } from "motion/react";
import { memo, useEffect, useMemo, useState } from "react";
import { Add20Regular, Dismiss16Regular, Image16Regular, MusicNote216Regular, Search16Regular, VideoClip16Regular, Warning16Filled } from "@fluentui/react-icons";
import type { MediaKind, MediaRef, Project } from "../../project/model";
import { libraryItems, mediaUsage, type LibrarySort } from "../../project/library";
import { basename } from "../../lib/files";
import { formatDuration } from "../../lib/timecode";
import { mediaSrc } from "../../lib/platform";
import { activeTab, useEditor } from "../../store/editor";
import { importToLibraryWithDialog, setOverLibrary } from "../../store/library";
import { quantizeThumbTime, relinkMedia, requestThumbs, thumbKey } from "../../store/controller";
import { Button, IconButton } from "../ui/Button";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { Segmented } from "../ui/Segmented";
import { Sounds } from "./Sounds";

export const MEDIA_MIME = "application/x-snip-media";

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "added", label: "Recientes" },
  { value: "name", label: "Nombre" },
  { value: "duration", label: "Duración" },
  { value: "type", label: "Tipo" },
];

const KIND_ICON: Record<MediaKind, typeof VideoClip16Regular> = { video: VideoClip16Regular, audio: MusicNote216Regular, image: Image16Regular };
const SCRUB_STEPS = 12;
const THUMB_H = 96;

/** Miniatura con "scrub": la posición del mouse elige el momento del video. */
function MediaThumb({ m, missing }: { m: MediaRef; missing: boolean }) {
  const [f, setF] = useState<number | null>(null);
  const step = Math.max(0.1, m.duration / SCRUB_STEPS);
  const time = m.kind === "video" ? quantizeThumbTime(f === null ? Math.min(1, m.duration * 0.1) : f * m.duration, step) : 0;
  const key = thumbKey(m.path, time, THUMB_H);
  const url = useEditor((s) => s.thumbs[key] ?? s.thumbs[thumbKey(m.path, quantizeThumbTime(Math.min(1, m.duration * 0.1), step), THUMB_H)]);
  useEffect(() => {
    if (m.kind === "video" && !missing) requestThumbs([{ path: m.path, time }], THUMB_H);
  }, [m.kind, m.path, time, missing]);
  // Al entrar, se piden todas las del recorrido (llegan en paralelo).
  const warm = () => {
    if (m.kind !== "video" || missing) return;
    requestThumbs(Array.from({ length: SCRUB_STEPS }, (_, i) => ({ path: m.path, time: quantizeThumbTime((i / SCRUB_STEPS) * m.duration, step) })), THUMB_H);
  };
  const Icon = KIND_ICON[m.kind];
  return (
    <div
      className="lib-thumb relative aspect-video w-full overflow-hidden rounded-[4px]"
      onPointerEnter={warm}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setF(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
      onPointerLeave={() => setF(null)}
      data-testid="lib-thumb"
      data-time={time.toFixed(2)}
    >
      {missing ? (
        <div className="flex h-full items-center justify-center text-[var(--text-tertiary)]">
          <Warning16Filled />
        </div>
      ) : m.kind === "image" ? (
        <img src={mediaSrc(m.path)} alt="" className="h-full w-full object-contain" draggable={false} />
      ) : m.kind === "audio" ? (
        <div className="lib-audio flex h-full items-center justify-center">
          <MusicNote216Regular className="text-[22px]" />
        </div>
      ) : url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : null}
      {f !== null && m.kind === "video" && <span className="lib-scrub pointer-events-none absolute inset-y-0 w-px" style={{ left: `${f * 100}%` }} />}
      <span className="lib-kind pointer-events-none absolute left-1 top-1 flex rounded-[3px] p-0.5">
        <Icon />
      </span>
      {m.kind !== "image" && <span className="lib-dur t-caption tabular pointer-events-none absolute bottom-1 right-1 rounded-[3px] px-1">{formatDuration(m.duration)}</span>}
    </div>
  );
}

const MediaCard = memo(function MediaCard({ m, uses, missing }: { m: MediaRef; uses: number; missing: boolean }) {
  return (
    <motion.li layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 40 }}>
      <div
        className={`lib-card group flex cursor-grab flex-col gap-1 rounded-[6px] p-1.5 ${missing ? "is-missing" : ""}`}
        draggable={!missing}
        onDragStart={(e) => {
          e.dataTransfer.setData(MEDIA_MIME, m.id);
          e.dataTransfer.setData("text/plain", basename(m.path));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => !missing && useEditor.setState({ sourceMedia: m.id })}
        title={m.path}
        data-testid="lib-item"
        data-media-id={m.id}
        data-used={uses > 0}
      >
        <MediaThumb m={m} missing={missing} />
        <div className="flex min-w-0 items-center gap-1">
          <span className="t-caption min-w-0 flex-1 truncate text-[var(--text-primary)]">{basename(m.path)}</span>
          {uses > 0 && (
            <Tooltip content={uses === 1 ? "Está en el timeline" : `Está ${uses} veces en el timeline`}>
              <span className="lib-used h-1.5 w-1.5 shrink-0 rounded-full" data-testid="lib-used" />
            </Tooltip>
          )}
        </div>
        {missing && (
          <Button className="!h-6 !text-[12px]" onClick={() => void relinkMedia(m.id)} data-testid="lib-relink">
            Buscar archivo
          </Button>
        )}
      </div>
    </motion.li>
  );
});

export function Library({ project }: { project: Project }) {
  const [view, setView] = useState<"media" | "sounds">("media");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("added");
  const missing = useEditor((s) => activeTab(s)?.missing ?? []);
  const items = useMemo(() => libraryItems(project, query, sort), [project, query, sort]);
  const usage = useMemo(() => mediaUsage(project), [project]);
  return (
    <motion.aside
      key="library"
      className="export-panel library-panel relative flex h-full w-[264px] shrink-0 flex-col overflow-hidden"
      initial={{ x: "-100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "-100%", opacity: 0, transition: { duration: 0.2, ease: [0.3, 0, 1, 1] } }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      data-testid="library"
      data-library
      onPointerEnter={() => setOverLibrary(true)}
      onPointerLeave={() => setOverLibrary(false)}
    >
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <h2 className="t-body-strong flex-1 pl-1">Biblioteca</h2>
        <Tooltip content="Importar archivos (también podés arrastrarlos o pegarlos acá)" placement="bottom">
          <IconButton label="Importar" onClick={() => void importToLibraryWithDialog()} data-testid="lib-import">
            <Add20Regular />
          </IconButton>
        </Tooltip>
        <IconButton label="Cerrar biblioteca" onClick={() => useEditor.setState({ libraryOpen: false })} data-testid="lib-close">
          <Dismiss16Regular />
        </IconButton>
      </div>
      <div className="px-3 pb-2">
        <Segmented<"media" | "sounds">
          label="Biblioteca"
          value={view}
          onChange={setView}
          options={[
            { value: "media", label: "Medios" },
            { value: "sounds", label: "Sonidos" },
          ]}
          size="sm"
          testId="lib-view"
        />
      </div>
      {view === "sounds" ? (
        <Sounds />
      ) : (
        <>
          <div className="flex flex-col gap-2 px-3 pb-2">
            <label className="tc-input relative flex h-8 items-center gap-2 rounded-[4px] px-2">
              <Search16Regular className="shrink-0 text-[var(--text-tertiary)]" />
              <input className="t-body min-w-0 flex-1 bg-transparent outline-none" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar en la biblioteca" data-testid="lib-search" />
            </label>
            <Select<LibrarySort> label="Ordenar por" value={sort} options={SORTS} onChange={setSort} testId="lib-sort" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {items.length ? (
              <ul className="grid grid-cols-2 gap-1" data-testid="lib-list">
                {items.map((m) => (
                  <MediaCard key={m.id} m={m} uses={usage.get(m.id) ?? 0} missing={missing.includes(m.id)} />
                ))}
              </ul>
            ) : (
              <p className="t-caption px-2 pt-4 text-center text-[var(--text-tertiary)]">{query ? "Nada con ese nombre." : "Arrastrá o pegá videos, audio e imágenes acá."}</p>
            )}
          </div>
        </>
      )}
    </motion.aside>
  );
}
