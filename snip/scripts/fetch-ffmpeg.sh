#!/usr/bin/env bash
# Descarga FFmpeg + FFprobe (build "essentials" de gyan.dev) y los deja como
# sidecars de Tauri en src-tauri/binaries/ con el sufijo del target triple.
set -euo pipefail

TRIPLE="${1:-x86_64-pc-windows-msvc}"
URL="${FFMPEG_URL:-https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/binaries"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -f "$DEST/ffmpeg-$TRIPLE.exe" && -f "$DEST/ffprobe-$TRIPLE.exe" && "${FORCE:-0}" != "1" ]]; then
  echo "FFmpeg ya está en $DEST (FORCE=1 para volver a bajarlo)."
  exit 0
fi

mkdir -p "$DEST"
echo "Descargando $URL ..."
curl -fL --retry 3 -o "$TMP/ffmpeg.zip" "$URL"

if [[ -n "${FFMPEG_SHA256:-}" ]]; then
  echo "$FFMPEG_SHA256  $TMP/ffmpeg.zip" | sha256sum -c -
fi

unzip -q "$TMP/ffmpeg.zip" -d "$TMP/x"
BIN="$(dirname "$(find "$TMP/x" -type f -name ffmpeg.exe | head -n1)")"
cp "$BIN/ffmpeg.exe"  "$DEST/ffmpeg-$TRIPLE.exe"
cp "$BIN/ffprobe.exe" "$DEST/ffprobe-$TRIPLE.exe"
# Guardamos la licencia y la versión junto a los binarios.
find "$TMP/x" -maxdepth 2 -iname 'LICENSE*' -exec cp {} "$DEST/FFMPEG-LICENSE.txt" \; -quit || true
basename "$(dirname "$BIN")" > "$DEST/FFMPEG-VERSION.txt"
echo "Listo: $(cat "$DEST/FFMPEG-VERSION.txt") → $DEST"
