# Descarga FFmpeg + FFprobe (build "essentials" de gyan.dev) y los deja como
# sidecars de Tauri en src-tauri\binaries\ con el sufijo del target triple.
param([string]$Triple = "x86_64-pc-windows-msvc", [switch]$Force)
$ErrorActionPreference = "Stop"
$Url  = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$Dest = Join-Path $PSScriptRoot "..\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
if ((Test-Path "$Dest\ffmpeg-$Triple.exe") -and -not $Force) { Write-Host "FFmpeg ya está."; exit 0 }
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("snip-ffmpeg-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Invoke-WebRequest -Uri $Url -OutFile "$Tmp\ffmpeg.zip"
  Expand-Archive "$Tmp\ffmpeg.zip" -DestinationPath "$Tmp\x"
  $bin = (Get-ChildItem "$Tmp\x" -Recurse -Filter ffmpeg.exe | Select-Object -First 1).DirectoryName
  Copy-Item "$bin\ffmpeg.exe"  "$Dest\ffmpeg-$Triple.exe"  -Force
  Copy-Item "$bin\ffprobe.exe" "$Dest\ffprobe-$Triple.exe" -Force
  Write-Host "Listo → $Dest"
} finally { Remove-Item -Recurse -Force $Tmp }
