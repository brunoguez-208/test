# Descarga FFmpeg 9.0 para Windows (build GPL "shared" de BtbN) y lo deja en
# src-tauri\binaries\ffmpeg\ (ffmpeg.exe, ffprobe.exe y las DLL que comparten).
param([switch]$Force)
$ErrorActionPreference = "Stop"
$Url  = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip"
$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root "src-tauri\binaries\ffmpeg"
if ((Test-Path (Join-Path $Dest "ffmpeg.exe")) -and -not $Force) { Write-Host "FFmpeg ya está en $Dest (-Force para volver a bajarlo)."; exit 0 }
$Tmp = Join-Path $env:TEMP ("snip-ffmpeg-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Tmp, $Dest | Out-Null
try {
  Invoke-WebRequest -Uri $Url -OutFile (Join-Path $Tmp "ffmpeg.zip")
  Expand-Archive -Path (Join-Path $Tmp "ffmpeg.zip") -DestinationPath (Join-Path $Tmp "x")
  $Bin = (Get-ChildItem -Recurse -Path (Join-Path $Tmp "x") -Filter ffmpeg.exe | Select-Object -First 1).DirectoryName
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Dest "*.exe"), (Join-Path $Dest "*.dll")
  Copy-Item (Join-Path $Bin "ffmpeg.exe"), (Join-Path $Bin "ffprobe.exe") $Dest
  Copy-Item (Join-Path $Bin "*.dll") $Dest
  $Lic = Get-ChildItem -Recurse -Depth 1 -Path (Join-Path $Tmp "x") -Filter "LICENSE*" | Select-Object -First 1
  if ($Lic) { Copy-Item $Lic.FullName (Join-Path $Dest "FFMPEG-LICENSE.txt") }
  Split-Path -Leaf (Split-Path -Parent $Bin) | Set-Content (Join-Path $Dest "FFMPEG-VERSION.txt")
  Write-Host "Listo → $Dest"
} finally { Remove-Item -Recurse -Force $Tmp }
