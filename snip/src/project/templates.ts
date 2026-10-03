// Plantillas de texto: estilo + posición + animaciones de un click.

import type { TextAnim, TextStyle } from "./model";

export const FONTS = [
  "Segoe UI Variable Display",
  "Segoe UI",
  "Bahnschrift",
  "Arial",
  "Arial Black",
  "Impact",
  "Georgia",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Comic Sans MS",
  "Consolas",
  "Cascadia Code",
  "Segoe Script",
  "Gabriola",
];

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Segoe UI Variable Display",
  size: 0.08,
  weight: 700,
  italic: false,
  color: "#FFFFFF",
  align: "center",
  stroke: null,
  shadow: { color: "rgba(0,0,0,0.55)", blur: 0.18, offsetX: 0, offsetY: 0.05 },
  background: null,
};

export interface TextTemplate {
  id: string;
  label: string;
  text: string;
  style: TextStyle;
  x: number;
  y: number;
  animIn: TextAnim | null;
  animOut: TextAnim | null;
}

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: "title",
    label: "Título",
    text: "Tu título",
    style: { ...DEFAULT_TEXT_STYLE, size: 0.11, weight: 800 },
    x: 0.5,
    y: 0.5,
    animIn: { kind: "pop", duration: 0.45 },
    animOut: { kind: "fade", duration: 0.35 },
  },
  {
    id: "lowerThird",
    label: "Zócalo",
    text: "Nombre Apellido\nCargo o lugar",
    style: {
      ...DEFAULT_TEXT_STYLE,
      size: 0.05,
      weight: 600,
      align: "left",
      shadow: null,
      background: { color: "#000000", opacity: 0.6, padding: 0.5, radius: 0.25 },
    },
    x: 0.24,
    y: 0.8,
    animIn: { kind: "slide", duration: 0.4 },
    animOut: { kind: "fade", duration: 0.3 },
  },
  {
    id: "quote",
    label: "Cita",
    text: "«Una frase que valga la pena»",
    style: { ...DEFAULT_TEXT_STYLE, fontFamily: "Georgia", size: 0.065, weight: 400, italic: true },
    x: 0.5,
    y: 0.5,
    animIn: { kind: "fade", duration: 0.6 },
    animOut: { kind: "fade", duration: 0.6 },
  },
  {
    id: "label",
    label: "Etiqueta",
    text: "NUEVO",
    style: {
      ...DEFAULT_TEXT_STYLE,
      size: 0.045,
      weight: 700,
      color: "#111111",
      shadow: null,
      background: { color: "#FFD60A", opacity: 1, padding: 0.55, radius: 0.6 },
    },
    x: 0.14,
    y: 0.12,
    animIn: { kind: "pop", duration: 0.35 },
    animOut: null,
  },
  {
    id: "impact",
    label: "Impacto",
    text: "¡MIRÁ ESTO!",
    style: { ...DEFAULT_TEXT_STYLE, fontFamily: "Impact", size: 0.12, weight: 400, shadow: null, stroke: { color: "#000000", width: 0.08 } },
    x: 0.5,
    y: 0.2,
    animIn: { kind: "pop", duration: 0.3 },
    animOut: { kind: "pop", duration: 0.25 },
  },
  {
    id: "neon",
    label: "Neón",
    text: "Neón",
    style: { ...DEFAULT_TEXT_STYLE, size: 0.1, weight: 600, color: "#FFFFFF", shadow: { color: "#FF2DAA", blur: 0.45, offsetX: 0, offsetY: 0 } },
    x: 0.5,
    y: 0.5,
    animIn: { kind: "fade", duration: 0.5 },
    animOut: { kind: "fade", duration: 0.5 },
  },
  {
    id: "typewriter",
    label: "Máquina de escribir",
    text: "Había una vez…",
    style: { ...DEFAULT_TEXT_STYLE, fontFamily: "Consolas", size: 0.06, weight: 400 },
    x: 0.5,
    y: 0.5,
    animIn: { kind: "typewriter", duration: 1.2 },
    animOut: { kind: "fade", duration: 0.3 },
  },
];
