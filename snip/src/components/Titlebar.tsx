import { createPortal } from "react-dom";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import {
  Add16Regular,
  ArrowDownload20Regular,
  Dismiss12Regular,
  PanelRightContract20Regular,
  PanelRightExpand20Regular,
  QuestionCircle20Regular,
  DocumentBulletList20Regular,
} from "@fluentui/react-icons";
import { openContextMenu, type MenuEntry } from "./ui/ContextMenu";
import { packageProject } from "../store/projectFiles";
import { saveProject } from "../store/controller";
import { isDirty, useEditor } from "../store/editor";
import { activateTab, closeTab, openWithDialog } from "../store/controller";
import { AppGlyph } from "./AppGlyph";
import { IconButton } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import { ProgressRing } from "./ui/Progress";

function projectMenu(): MenuEntry[] {
  const dlg = (d: "version" | "versions" | "template") => () => useEditor.setState({ projectDialog: d });
  return [
    { label: "Guardar", hint: "Ctrl+S", run: () => void saveProject(), testId: "menu-save" },
    { label: "Guardar proyecto como…", hint: "Ctrl+Shift+S", run: () => void saveProject(true), testId: "menu-save-as" },
    "separator",
    { label: "Guardar versión…", run: dlg("version"), testId: "menu-save-version" },
    { label: "Versiones…", run: dlg("versions"), testId: "menu-versions" },
    "separator",
    { label: "Empaquetar en una carpeta…", run: () => void packageProject(false), testId: "menu-package-folder" },
    { label: "Empaquetar en un ZIP…", run: () => void packageProject(true), testId: "menu-package-zip" },
    "separator",
    { label: "Guardar como plantilla…", run: dlg("template"), testId: "menu-save-template" },
  ];
}

function QueueButton() {
  const queue = useEditor((s) => s.queue);
  const open = useEditor((s) => s.queueOpen);
  const running = queue.find((q) => q.status.state === "running");
  const waiting = queue.filter((q) => q.status.state === "queued").length;
  const pct = running?.status.state === "running" ? running.status.progress?.percent ?? 0 : 0;
  if (!queue.length) return null;
  return (
    <Tooltip content={running ? `Exportando… ${Math.floor(pct)}%${waiting ? ` · ${waiting} en espera` : ""}` : "Cola de exportación"} placement="bottom">
      <IconButton
        label="Cola de exportación"
        active={open}
        onClick={() => useEditor.setState({ queueOpen: !open })}
        data-testid="queue-button"
        className="relative"
      >
        {running ? <ProgressRing size={18} stroke={2} /> : <ArrowDownload20Regular />}
        {waiting + (running ? 1 : 0) > 0 && (
          <motion.span
            key={waiting}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="queue-badge t-caption absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
          >
            {waiting + (running ? 1 : 0)}
          </motion.span>
        )}
      </IconButton>
    </Tooltip>
  );
}

/** Barra de título: pestañas de proyectos + cola + ayuda (los botones de ventana los pone decorum). */
export function Titlebar() {
  const tabs = useEditor((s) => s.tabs);
  const active = useEditor((s) => s.active);
  const phase = useEditor((s) => s.phase);
  const focused = useEditor((s) => s.focused);
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const target = document.getElementById("titlebar-content");
  if (!target) return null;

  return createPortal(
    <div className="flex h-full items-end pl-3 pr-1">
      <motion.div className="mb-[11px] mr-3 flex shrink-0 items-center gap-2.5" animate={{ opacity: focused ? 1 : 0.55 }} transition={{ duration: 0.2 }}>
        <AppGlyph />
        <AnimatePresence initial={false}>
          {tabs.length === 0 && (
            <motion.span key="name" className="t-caption text-[var(--text-primary)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Snip
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
      <LayoutGroup id="tabs">
        <div className="flex h-[34px] min-w-0 items-end gap-0.5" role="tablist" aria-label="Proyectos abiertos" data-testid="tabs">
          <AnimatePresence initial={false}>
            {tabs.map((t) => {
              const sel = t.id === active && phase === "editor";
              const dirty = isDirty(t);
              const name = t.history.present.name || "Sin nombre";
              return (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: focused || sel ? 1 : 0.6, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                  className={`tab group relative flex h-[34px] min-w-[96px] max-w-[220px] items-center ${sel ? "is-active" : ""}`}
                  data-testid="tab"
                  data-active={sel}
                  data-dirty={dirty}
                >
                  {sel && <motion.span layoutId="tab-bg" className="tab-bg absolute inset-0" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sel}
                    className="t-caption relative z-[1] flex h-full min-w-0 flex-1 items-center pl-3 pr-1 text-left outline-none"
                    title={t.file ?? name}
                    onClick={() => activateTab(t.id)}
                    onAuxClick={(e) => {
                      if (e.button === 1) void closeTab(t.id);
                    }}
                  >
                    <span className="truncate">{name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Cerrar ${name}`}
                    onClick={() => void closeTab(t.id)}
                    className="tab-close relative z-[1] mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] outline-none"
                    data-testid="tab-close"
                  >
                    {dirty && <span className="tab-dirty absolute h-2 w-2 rounded-full transition-opacity group-hover:opacity-0" />}
                    <Dismiss12Regular className={`transition-opacity ${dirty ? "opacity-0 group-hover:opacity-100" : ""}`} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {tabs.length > 0 && (
            <motion.div layout className="mb-[5px] ml-1">
              <Tooltip content={<>Abrir otro video o proyecto <kbd className="kbd ml-1">Ctrl+O</kbd></>} placement="bottom">
                <IconButton label="Abrir" size={28} onClick={() => void openWithDialog()} data-testid="tab-new">
                  <Add16Regular />
                </IconButton>
              </Tooltip>
            </motion.div>
          )}
        </div>
      </LayoutGroup>
      <div className="flex-1" />
      <div className="mb-[4px] flex items-center gap-1">
        <QueueButton />
        <AnimatePresence>
          {phase === "editor" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Tooltip content="Proyecto: guardar, versiones, empaquetar, plantillas" placement="bottom">
                <IconButton
                  label="Menú del proyecto"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    openContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} }, projectMenu());
                  }}
                  data-testid="project-menu"
                >
                  <DocumentBulletList20Regular />
                </IconButton>
              </Tooltip>
            </motion.div>
          )}
        </AnimatePresence>
        <Tooltip content={<>Atajos de teclado <kbd className="kbd ml-1">?</kbd></>} placement="bottom">
          <IconButton label="Atajos de teclado" onClick={() => useEditor.setState((s) => ({ shortcutsOpen: !s.shortcutsOpen }))} data-testid="help-button">
            <QuestionCircle20Regular />
          </IconButton>
        </Tooltip>
        <AnimatePresence>
          {phase === "editor" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Tooltip content={inspectorOpen ? "Ocultar panel" : "Mostrar panel"} placement="bottom">
                <IconButton
                  label={inspectorOpen ? "Ocultar panel" : "Mostrar panel"}
                  onClick={() => useEditor.setState({ inspectorOpen: !inspectorOpen })}
                  data-testid="toggle-panel"
                >
                  {inspectorOpen ? <PanelRightContract20Regular /> : <PanelRightExpand20Regular />}
                </IconButton>
              </Tooltip>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>,
    target,
  );
}
