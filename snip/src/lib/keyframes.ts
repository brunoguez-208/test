/** Último keyframe anterior (o igual) a `t`: donde empieza de verdad un corte sin recodificar. */
export function keyframeAtOrBefore(keyframes: number[], t: number): number | null {
  let found: number | null = null;
  for (const k of keyframes) {
    if (k <= t + 1e-4) found = k;
    else break;
  }
  return found;
}
