/** Nombre de archivo de una ruta de Windows o POSIX. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : "";
}

/** Solo MP4, sin importar mayúsculas. */
export function isMp4(path: string): boolean {
  return /\.mp4$/i.test(path.trim());
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
