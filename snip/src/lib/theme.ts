import type { Palette } from "./types";

/** Aplica el tema y el acento de Windows como CSS variables. */
export function applyPalette(p: Palette) {
  const root = document.documentElement;
  root.dataset.theme = p.dark ? "dark" : "light";
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set("--accent", p.accent);
  set("--accent-light1", p.light1);
  set("--accent-light2", p.light2);
  set("--accent-light3", p.light3);
  set("--accent-dark1", p.dark1);
  set("--accent-dark2", p.dark2);
  set("--accent-dark3", p.dark3);
}

export function applyMaterial(material: string) {
  document.documentElement.dataset.material = material;
}

/** Sin Rust (navegador): seguir prefers-color-scheme. */
export function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
}
