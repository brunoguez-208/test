import { animate, motion, useMotionValue, useReducedMotion, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useEffect } from "react";
import type { DragHint } from "../store/editor";

const W = 400;
const H = 104;

// "Escenas" abstractas para los cuadros de la tira.
const FRAMES = [
  "linear-gradient(160deg,#ffb36b 0%,#ff6f91 55%,#6a4cff 100%)",
  "linear-gradient(170deg,#ffd27a 0%,#ff8a5b 60%,#c2416b 100%)",
  "linear-gradient(180deg,#7ad7ff 0%,#3a8dde 55%,#1f3b73 100%)",
  "linear-gradient(165deg,#9ef0c4 0%,#38b48b 50%,#14594f 100%)",
  "linear-gradient(175deg,#c6b5ff 0%,#7b6cf6 50%,#2c2a6e 100%)",
  "linear-gradient(160deg,#ffe1a8 0%,#f7a35c 50%,#7a3e2a 100%)",
  "linear-gradient(185deg,#a8e6ff 0%,#5cb6f7 50%,#20406e 100%)",
  "linear-gradient(170deg,#ffc2d4 0%,#f76f9c 50%,#6b2142 100%)",
];

/**
 * Ilustración viva de la bienvenida: una tira de video con dos handles que
 * recortan en loop. Al arrastrar un MP4 se abre con un glow del acento; si el
 * archivo no es válido, se cierra.
 */
export function TrimIllustration({ drag }: { drag: DragHint }) {
  const reduce = useReducedMotion();
  // Con movimiento reducido, la tira arranca ya recortada y queda quieta.
  const l = useMotionValue(reduce ? 0.2 : 0.06);
  const r = useMotionValue(reduce ? 0.78 : 0.94);
  const p = useMotionValue(reduce ? 0.35 : 0);

  useEffect(() => {
    const anims: AnimationPlaybackControls[] = [];
    const spring = { type: "spring" as const, stiffness: 260, damping: 22 };
    if (drag === "valid") {
      anims.push(animate(l, 0.015, spring), animate(r, 0.985, spring), animate(p, 0, { duration: 0.3 }));
    } else if (drag === "invalid") {
      anims.push(animate(l, 0.43, spring), animate(r, 0.57, spring), animate(p, 0, { duration: 0.2 }));
    } else if (reduce) {
      l.jump(0.2);
      r.jump(0.78);
      p.jump(0.35);
    } else {
      const t = { duration: 4.2, repeat: Infinity, ease: "easeInOut" as const, times: [0, 0.18, 0.5, 0.68, 1] };
      anims.push(
        animate(l, [l.get(), 0.24, 0.24, 0.06, 0.06], t),
        animate(r, [r.get(), r.get(), 0.72, 0.94, 0.94], t),
        animate(p, [0, 1], { duration: 2.1, repeat: Infinity, ease: "linear" }),
      );
    }
    return () => anims.forEach((a) => a.stop());
  }, [drag, reduce, l, r, p]);

  const leftDim = useTransform(l, (v) => v);
  const rightDim = useTransform(r, (v) => 1 - v);
  const selX = useTransform(l, (v) => v * W);
  const selScale = useTransform([l, r], ([a, b]: number[]) => Math.max(0.001, b - a));
  const lx = useTransform(l, (v) => v * W - 9);
  const rx = useTransform(r, (v) => v * W - 9);
  const px = useTransform([l, r, p], ([a, b, c]: number[]) => (a + (b - a) * c) * W - 1);

  return (
    <motion.div
      className="relative"
      style={{ width: W, height: H }}
      animate={{ scale: drag === "valid" ? 1.04 : 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      data-testid="trim-illustration"
      data-drag={drag}
    >
      {/* Glow del acento */}
      <motion.div
        className="illus-glow pointer-events-none absolute -inset-3 rounded-[18px]"
        initial={false}
        animate={{ opacity: drag === "valid" ? 1 : 0 }}
        transition={{ duration: 0.25 }}
      />
      <motion.div
        className="absolute inset-0"
        animate={drag === "invalid" && !reduce ? { x: [0, -10, 9, -6, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <div className="illus-strip absolute inset-0 flex overflow-hidden rounded-[10px]">
          {FRAMES.map((bg, i) => (
            <div key={i} className="relative h-full flex-1" style={{ background: bg }}>
              <div className="absolute inset-x-[18%] bottom-[22%] h-[24%] rounded-t-full bg-black/20" />
              <div className="absolute right-[20%] top-[16%] aspect-square w-[22%] rounded-full bg-white/55" />
              {i > 0 && <div className="absolute inset-y-0 left-0 w-px bg-black/25" />}
            </div>
          ))}
        </div>
        {/* Zonas excluidas, atenuadas */}
        <motion.div className="illus-dim absolute inset-y-0 left-0 w-full origin-left rounded-l-[10px]" style={{ scaleX: leftDim }} />
        <motion.div className="illus-dim absolute inset-y-0 right-0 w-full origin-right rounded-r-[10px]" style={{ scaleX: rightDim }} />
        {/* Marco de la selección */}
        <motion.div className="pointer-events-none absolute inset-y-0 left-0 w-full origin-left" style={{ x: selX, scaleX: selScale }}>
          <div className="illus-sel absolute inset-x-0 top-0 h-[3px]" />
          <div className="illus-sel absolute inset-x-0 bottom-0 h-[3px]" />
        </motion.div>
        {/* Playhead */}
        <motion.div className="absolute -top-2 h-[calc(100%+16px)] w-[2px] rounded-full bg-white shadow-[0_0_6px_rgba(0,0,0,0.5)]" style={{ x: px, opacity: drag === "none" ? 1 : 0 }} />
        {/* Handles */}
        {[lx, rx].map((x, i) => (
          <motion.div
            key={i}
            className="illus-handle absolute -top-[5px] flex h-[calc(100%+10px)] w-[18px] items-center justify-center rounded-[6px]"
            style={{ x }}
          >
            <motion.span
              className="illus-handle-off absolute inset-0 rounded-[6px]"
              initial={false}
              animate={{ opacity: drag === "invalid" ? 1 : 0 }}
              transition={{ duration: 0.2 }}
            />
            <span className="relative h-7 w-[3px] rounded-full bg-black/35" />
          </motion.div>
        ))}
        {/* Tinte de error si el archivo no sirve */}
        <motion.div
          className="illus-invalid pointer-events-none absolute inset-0 rounded-[10px]"
          initial={false}
          animate={{ opacity: drag === "invalid" ? 1 : 0 }}
        />
      </motion.div>
    </motion.div>
  );
}
