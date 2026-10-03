import { AnimatePresence, motion } from "motion/react";
import { Dismiss12Regular, DocumentRegular, FolderOpen20Regular, VideoClip20Regular } from "@fluentui/react-icons";
import { useEditor } from "../store/editor";
import { discardProject, openPaths, openWithDialog, resumeProject } from "../store/controller";
import { mediaSrc } from "../lib/platform";
import { basename, dirname, middleEllipsis, timeAgo } from "../lib/files";
import { formatDuration } from "../lib/timecode";
import type { ProjectSummary } from "../lib/types";
import { TrimIllustration } from "./TrimIllustration";
import { Button } from "./ui/Button";
import { DocumentCopy20Regular } from "@fluentui/react-icons";
import { ProgressRing } from "./ui/Progress";
import { Tooltip } from "./ui/Tooltip";

const HINTS: [string, string][] = [
  ["Espacio", "Reproducir"],
  ["S", "Dividir"],
  ["Ctrl+Z", "Deshacer"],
  ["?", "Todos los atajos"],
];

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.1, 0.9, 0.2, 1] as const } },
};

function ProjectCard({ p, index }: { p: ProjectSummary; index: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * index, duration: 0.4, ease: [0.1, 0.9, 0.2, 1] } }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      className="group relative"
      data-testid="project-card"
    >
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        onClick={() => void resumeProject(p.id)}
        className="project-card flex w-full flex-col overflow-hidden rounded-[8px] text-left outline-none"
        aria-label={`Seguir editando ${p.name || "Sin nombre"}`}
      >
        <div className="project-thumb relative aspect-video w-full overflow-hidden">
          {p.thumbnail ? (
            <img src={mediaSrc(p.thumbnail)} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="project-thumb-empty absolute inset-0 flex items-center justify-center">
              <VideoClip20Regular className="text-[28px] opacity-60" />
            </div>
          )}
          <span className="duration-chip t-caption tabular absolute bottom-1.5 right-1.5 rounded-[4px] px-1.5">{formatDuration(p.duration)}</span>
        </div>
        <div className="px-3 pb-2.5 pt-2">
          <p className="t-body-strong truncate">{p.name || "Sin nombre"}</p>
          <p className="t-caption truncate text-[var(--text-secondary)]">
            {p.clipCount === 1 ? "1 clip" : `${p.clipCount} clips`} · editado {timeAgo(p.updatedAt)}
          </p>
        </div>
      </motion.button>
      <Tooltip content="Descartar">
        <button
          type="button"
          aria-label={`Descartar ${p.name || "proyecto"}`}
          onClick={() => void discardProject(p.id, p.name)}
          className="card-discard absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          data-testid="discard-project"
        >
          <Dismiss12Regular />
        </button>
      </Tooltip>
    </motion.div>
  );
}

/** Pantalla de bienvenida: zona de drop con la ilustración viva, proyectos sin terminar y recientes. */
export function Welcome() {
  const drag = useEditor((s) => s.drag);
  const opening = useEditor((s) => s.opening);
  const unfinished = useEditor((s) => s.unfinished);
  const recent = useEditor((s) => s.recent);
  const hasLists = unfinished.length > 0 || recent.length > 0;

  const title = drag === "valid" ? "Soltalo para abrirlo" : drag === "invalid" ? "Ese formato no se abre" : "Editá un video en segundos";
  const subtitle =
    drag === "valid"
      ? "Lo cargamos al toque."
      : drag === "invalid"
        ? "Snip abre MP4, MOV, MKV, WebM y proyectos .snip."
        : "Arrastrá videos a esta ventana, o hacé click derecho en un archivo y elegí «Editar con Snip».";

  return (
    <motion.section
      className={`welcome flex h-full flex-col items-center overflow-y-auto px-8 ${hasLists ? "pb-10 pt-8" : "justify-center pb-10"}`}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.18, ease: [0.3, 0, 1, 1] } }}
      variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } }}
      data-testid="welcome"
    >
      <motion.div variants={item} className={`relative ${hasLists ? "mb-8 mt-2 scale-[0.82]" : "mb-12"}`}>
        <div className="welcome-spot pointer-events-none absolute left-1/2 top-1/2 h-[340px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        <TrimIllustration drag={drag} />
      </motion.div>

      <motion.div variants={item} className="relative h-[52px] w-full max-w-[640px] shrink-0 text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h1
            key={title}
            className={`t-title-lg absolute inset-x-0 ${drag === "invalid" ? "text-[var(--critical)]" : ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0, 0, 0, 1] }}
            data-testid="welcome-title"
          >
            {title}
          </motion.h1>
        </AnimatePresence>
      </motion.div>

      <motion.p variants={item} className="t-body mt-3 max-w-[480px] shrink-0 text-center text-[var(--text-secondary)]" aria-live="polite">
        {subtitle}
      </motion.p>

      <motion.div variants={item} className="mt-8 flex shrink-0 items-center gap-3">
        <Button
          variant="accent"
          size="lg"
          icon={opening ? <ProgressRing size={16} stroke={2} className="!text-[var(--text-on-accent)]" /> : <FolderOpen20Regular />}
          onClick={() => void openWithDialog()}
          disabled={opening}
          data-testid="welcome-open"
          className="min-w-[180px]"
        >
          {opening ? "Abriendo…" : "Abrir video"}
          <kbd className="kbd ml-1">Ctrl+O</kbd>
        </Button>
        <Button size="lg" icon={<DocumentCopy20Regular />} onClick={() => useEditor.setState({ projectDialog: "templates" })} data-testid="welcome-template">
          Nuevo desde plantilla
        </Button>
      </motion.div>

      <motion.p variants={item} className="t-caption mt-4 shrink-0 text-[var(--text-tertiary)]">
        MP4 · MOV · MKV · WebM · Exportá sin pérdida o con tu GPU
      </motion.p>

      {hasLists ? (
        <div className="mt-12 grid w-full max-w-[980px] shrink-0 gap-10">
          {unfinished.length > 0 && (
            <motion.section variants={item} aria-labelledby="unfinished-title" data-testid="unfinished">
              <h2 id="unfinished-title" className="t-body-strong mb-3 text-[var(--text-secondary)]">
                Proyectos sin terminar
              </h2>
              <motion.div layout className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                <AnimatePresence>
                  {unfinished.slice(0, 8).map((p, i) => (
                    <ProjectCard key={p.id} p={p} index={i} />
                  ))}
                </AnimatePresence>
              </motion.div>
            </motion.section>
          )}
          {recent.length > 0 && (
            <motion.section variants={item} aria-labelledby="recent-title" data-testid="recent">
              <h2 id="recent-title" className="t-body-strong mb-2 text-[var(--text-secondary)]">
                Recientes
              </h2>
              <ul className="recent-list overflow-hidden rounded-[8px]">
                {recent.slice(0, 8).map((r) => (
                  <li key={r.path}>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.99 }}
                      onClick={() => void openPaths([r.path])}
                      className="recent-row flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none"
                      data-testid="recent-row"
                    >
                      <span className="recent-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[16px]">
                        {r.kind === "project" ? <DocumentRegular /> : <VideoClip20Regular />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="t-body block truncate">{basename(r.path)}</span>
                        <span className="t-caption block truncate text-[var(--text-tertiary)]">{middleEllipsis(dirname(r.path), 70)}</span>
                      </span>
                      <span className="t-caption shrink-0 text-[var(--text-tertiary)]">{timeAgo(r.openedAt)}</span>
                    </motion.button>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}
        </div>
      ) : (
        <motion.ul variants={item} className="mt-14 flex flex-wrap justify-center gap-x-6 gap-y-2">
          {HINTS.map(([k, label]) => (
            <li key={k} className="t-caption flex items-center gap-2 text-[var(--text-tertiary)]">
              <kbd className="kbd">{k}</kbd>
              {label}
            </li>
          ))}
        </motion.ul>
      )}
    </motion.section>
  );
}
