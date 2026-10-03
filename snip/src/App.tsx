import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useEditor } from "./store/editor";
import { api } from "./lib/platform";
import { useAppShell } from "./hooks/useAppShell";
import { useDragDrop } from "./hooks/useDragDrop";
import { useShortcuts } from "./hooks/useShortcuts";
import { ContextMenuHost } from "./components/ui/ContextMenu";
import { WindowControls } from "./components/WindowControls";
import { Titlebar } from "./components/Titlebar";
import { Welcome } from "./components/Welcome";
import { Editor } from "./components/editor/Editor";
import { DropOverlay } from "./components/DropOverlay";
import { Toasts } from "./components/Toasts";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { QueuePanel } from "./components/QueuePanel";
import { installPasteHandler } from "./store/clipboard";
import { ShortcutsPanel } from "./components/ShortcutsPanel";

export function App() {
  useAppShell();
  useDragDrop();
  useShortcuts();
  useEffect(() => installPasteHandler(), []);
  const phase = useEditor((s) => s.phase);
  const active = useEditor((s) => s.active);
  const [shown, setShown] = useState(false);

  // La ventana arranca oculta: la mostramos recién después del primer paint,
  // así nunca se ve un cuadro en blanco. Después entra con fade + scale.
  useEffect(() => {
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      api
        .showMainWindow()
        .catch(() => {})
        .finally(() => setShown(true));
    };
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(show);
    });
    const t = window.setTimeout(show, 120);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <Titlebar />
      <WindowControls />
      <ContextMenuHost />
      <motion.div
        className="workspace h-full"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={shown ? { opacity: 1, scale: 1 } : undefined}
        transition={{ duration: 0.4, ease: [0.1, 0.9, 0.2, 1] }}
        data-ready={shown}
      >
        <AnimatePresence mode="wait">{phase === "welcome" ? <Welcome key="welcome" /> : <Editor key={`editor-${active}`} />}</AnimatePresence>
      </motion.div>
      <DropOverlay />
      <QueuePanel />
      <Toasts />
      <ShortcutsPanel />
      <ConfirmDialog />
    </MotionConfig>
  );
}
