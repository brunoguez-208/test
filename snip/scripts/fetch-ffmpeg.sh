#!/usr/bin/env bash
# Descarga FFmpeg 9.0 para Windows (build GPL "shared" de BtbN: libx264, NVENC,
# QSV, AMF, libvpx, libopus, libmp3lame, libvidstab) y lo deja en
# src-tauri/binaries/ffmpeg/ (ffmpeg.exe, ffprobe.exe y las DLL que comparten).
# El instalador lo copia a la carpeta ffmpeg\ de la instalación.
set -euo pipefail

URL="${FFMPEG_URL:-https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/binaries/ffmpeg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -f "$DEST/ffmpeg.exe" && -f "$DEST/ffprobe.exe" && "${FORCE:-0}" != "1" ]]; then
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
rm -f "$DEST"/*.exe "$DEST"/*.dll
cp "$BIN/ffmpeg.exe" "$BIN/ffprobe.exe" "$BIN"/*.dll "$DEST/"
find "$TMP/x" -maxdepth 2 -iname 'LICENSE*' -exec cp {} "$DEST/FFMPEG-LICENSE.txt" \; -quit || true
basename "$(dirname "$BIN")" > "$DEST/FFMPEG-VERSION.txt"
echo "Listo: $(cat "$DEST/FFMPEG-VERSION.txt") → $DEST"
