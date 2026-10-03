// Efectos de un clic (bloques en la pista de capas): nombre y duración típica.
// Las fórmulas de imagen están en engine/fx.ts y snip-core/src/fx.rs.

import type { EffectKind } from "./model";

export const EFFECTS: { kind: EffectKind; label: string; duration: number }[] = [
  { kind: "shake", label: "Temblor", duration: 0.6 },
  { kind: "zoomPunch", label: "Zoom punch", duration: 0.5 },
  { kind: "flash", label: "Flash", duration: 0.35 },
  { kind: "glitch", label: "Glitch", duration: 0.6 },
  { kind: "vignette", label: "Viñeta", duration: 3 },
];
export const effectLabel = (k: EffectKind) => EFFECTS.find((e) => e.kind === k)?.label ?? "Efecto";
