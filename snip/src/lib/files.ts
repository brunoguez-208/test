/** Nombre de archivo de una ruta de Windows o POSIX. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function stem(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : "";
}

export function extension(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Videos que abre Snip: MP4, MOV, MKV y WebM. */
export function isVideo(path: string): boolean {
  return ["mp4", "mov", "mkv", "webm"].includes(extension(path));
}

export function isProjectFile(path: string): boolean {
  return extension(path) === "snip";
}

export function isAudio(path: string): boolean {
  return ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"].includes(extension(path));
}

export function isImage(path: string): boolean {
  return ["png", "jpg", "jpeg", "webp"].includes(extension(path));
}

/** Compatibilidad con Snip 1.x. */
export function isMp4(path: string): boolean {
  return extension(path) === "mp4";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits).replace(".", ",")} ${units[i]}`;
}

/** Acorta una ruta larga por el medio: "C:\Users\…\Videos\clip.mp4". */
export function middleEllipsis(text: string, max = 48): string {
  if (text.length <= max) return text;
  const keepEnd = Math.ceil(max * 0.6);
  const keepStart = max - keepEnd - 1;
  return `${text.slice(0, keepStart)}…${text.slice(text.length - keepEnd)}`;
}

/** "hace 5 minutos", "ayer", "hace 3 días". */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "recién";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "hace 1 minuto" : `hace ${m} minutos`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const d = Math.round(h / 24);
  if (d === 1) return "ayer";
  if (d < 30) return `hace ${d} días`;
  const mo = Math.round(d / 30);
  return mo <= 1 ? "hace 1 mes" : `hace ${mo} meses`;
}

/** Nombre de archivo válido en Windows (sin \ / : * ? " < > |). */
export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/\.+$/, "");
  return s || "proyecto";
}
