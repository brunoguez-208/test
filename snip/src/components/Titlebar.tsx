import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { FolderOpen20Regular, PanelRightContract20Regular, PanelRightExpand20Regular } from "@fluentui/react-icons";
import { useSnip } from "../store/snip";
import { openWithDialog } from "../store/controller";
import { basename } from "../lib/files";
import { AppGlyph } from "./AppGlyph";
import { IconButton, Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

/** Contenido de la barra de título (los botones de ventana los pone decorum). */
export function Titlebar() {
  const media = useSnip((s) => s.media);
  const phase = useSnip((s) => s.phase);
  const focused = useSnip((s) => s.focused);
  const panelOpen = useSnip((s) => s.panelOpen);
  const togglePanel = useSnip((s) => s.togglePanel);
  const target = document.getElementById("titlebar-content");
  if (!target) return null;

  return createPortal(
    <div className="flex h-full items-center pl-4 pr-1">
      <motion.div
        className="flex min-w-0 items-center gap-3"
        animate={{ opacity: focused ? 1 : 0.55 }}
        transition={{ duration: 0.2 }}
      >
        <AppGlyph />
        <span className="t-caption shrink-0 text-[var(--text-primary)]">Snip</span>
        <AnimatePresence mode="popLayout">
          {phase === "editor" && media && (
            <motion.span
              key={media.path}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.25, ease: [0, 0, 0, 1] }}
              className="t-caption min-w-0 truncate text-[var(--text-secondary)]"
              title={media.path}
              data-testid="titlebar-file"
            >
              {basename(media.path)}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
      <div className="flex-1" />
      <AnimatePresence>
        {phase === "editor" && (
          <motion.div
            className="flex items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Tooltip content={<>Abrir otro video <kbd className="kbd ml-1">Ctrl+O</kbd></>} placement="bottom">
              <Button variant="subtle" className="!h-8" icon={<FolderOpen20Regular />} onClick={() => void openWithDialog()} data-testid="titlebar-open">
                Abrir
              </Button>
            </Tooltip>
            <Tooltip content={panelOpen ? "Ocultar exportación" : "Mostrar exportación"} placement="bottom">
              <IconButton label={panelOpen ? "Ocultar panel de exportación" : "Mostrar panel de exportación"} onClick={() => togglePanel()} data-testid="toggle-panel">
                {panelOpen ? <PanelRightContract20Regular /> : <PanelRightExpand20Regular />}
              </IconButton>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    target,
  );
}
