import { AnimatePresence, motion } from "motion/react";
import { cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  placement?: "top" | "bottom";
  delay?: number;
  maxWidth?: number;
}

/** Tooltip de Fluent: aparece tras una pausa, se posiciona respecto del trigger. */
export function Tooltip({ content, children, placement = "top", delay = 450, maxWidth = 280 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; place: "top" | "bottom" } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const anchor = useRef<HTMLElement | null>(null);
  const id = useId();

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const place = placement === "top" && r.top < 80 ? "bottom" : placement;
      setPos({ x: r.left + r.width / 2, y: place === "top" ? r.top - 8 : r.bottom + 8, place });
      setOpen(true);
    }, delay);
  }, [delay, placement]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const child = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchor.current = node;
    },
    onPointerEnter: show,
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: show,
    onBlur: hide,
    "aria-describedby": open ? id : undefined,
  });

  return (
    <>
      {child}
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <div
              key="tooltip"
              className="pointer-events-none fixed z-[100]"
              style={{
                left: pos.x,
                top: pos.y,
                transform: `translate(-50%, ${pos.place === "top" ? "-100%" : "0"})`,
              }}
            >
              <motion.div
                id={id}
                role="tooltip"
                initial={{ opacity: 0, y: pos.place === "top" ? 4 : -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
                transition={{ duration: 0.16, ease: [0, 0, 0, 1] }}
                className="tooltip t-caption"
                style={{ maxWidth }}
              >
                {content}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
