# Snip

Recortador de video ultra rápido para Windows 11. Click derecho en un `.mp4` → **Recortar con Snip** → marcás inicio y fin → exportás en segundos.

- **Rápido · sin pérdida** (por defecto): copia el video sin recodificar (`-c copy`). Es instantáneo y conserva el códec original (H.264 o HEVC). El corte cae en el keyframe anterior al inicio; la app te dice exactamente dónde.
- **Preciso**: recodifica siempre a H.264 con corte exacto al cuadro, cambio de resolución (4K, 1440p, 1080p, 720p o personalizada) y de fps (120/60/30/24). Usa la GPU si puede: NVENC → Quick Sync → AMF → x264.
- Solo MP4 (decisión de la v1). La salida es siempre `.mp4` y nunca sobrescribe: `clip_snip.mp4`, `clip_snip (2).mp4`, …

## Instalación

Ejecutá `Snip_1.0.0_x64-setup.exe`. Se instala para tu usuario (no pide permisos de administrador).

Como el instalador no está firmado, Windows SmartScreen va a mostrar **«Windows protegió tu PC»**. Hacé click en **Más información** → **Ejecutar de todas formas**.

### Menú contextual en Windows 11

El instalador agrega **Recortar con Snip** al menú contextual de los `.mp4` (`HKCU\Software\Classes\SystemFileAssociations\.mp4\shell\SnipTrim`) y registra Snip en **Abrir con**, sin cambiar tu reproductor predeterminado.

En Windows 11 esa entrada aparece en **Mostrar más opciones** (o con Shift + click derecho), porque el menú moderno solo muestra extensiones que implementan `IExplorerCommand`.

**Mejora futura:** entrada en el menú moderno mediante un handler `IExplorerCommand` (DLL COM) registrado con un *sparse package* (paquete MSIX con identidad, sin mover la app). Requiere firmar el paquete.

Al desinstalar se borran la entrada del menú, el ProgID y la asociación de "Abrir con".

## Atajos

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausa |
| I / O | Marcar inicio / fin |
| ← / → | Un cuadro (con Shift, 1 segundo) |
| J / K / L | Retroceso / pausa / avance (repetir acelera hasta 8×) |
| Ctrl+E | Exportar |
| Ctrl+O | Abrir |

Los atajos se ignoran mientras escribís en un campo.

## Stack

- Tauri 2 + React 19 + TypeScript + Vite
- Tailwind 4, Motion (`motion/react`), Zustand, Fluent UI System Icons
- `window-vibrancy` (Mica, Acrylic como alternativa), `tauri-plugin-decorum` (barra de título con Snap Layouts), `tauri-plugin-single-instance`, `tauri-plugin-dialog`
- FFmpeg y FFprobe 9.0 (build *essentials* de gyan.dev, GPLv3) como sidecars

## Estructura

```
src/                     Frontend (React)
  components/            Pantallas y componentes (ui/ = controles Fluent)
  store/snip.ts          Estado (Zustand) y acciones puras
  store/controller.ts    Acciones que hablan con Rust
  lib/                   Timecode, atajos, playback, tipos, wrappers de Tauri
  mocks/tauriMock.ts     Backend simulado para tests de UI en navegador
src-tauri/
  core/                  snip-core: TODA la lógica de FFmpeg/FFprobe, sin UI
    src/export.rs        ExportRequest → argumentos de FFmpeg
    src/encoder.rs       Encoders y su detección real (encode de 1 cuadro)
    src/probe.rs         ffprobe (duración, tamaño, fps, códec, audio, rotación)
    src/progress.rs      Parser de -progress pipe:1
    src/naming.rs        Nombres de salida sin sobrescribir
    src/runner.rs        Procesos sin consola, cancelación, borrado del parcial
    tests/               Integración con FFmpeg real
  src/                   App Tauri: commands, tema (UISettings), Mica, shell
  windows/hooks.nsh      Hooks del instalador (menú contextual, Abrir con)
scripts/fetch-ffmpeg.*   Descarga FFmpeg/FFprobe y los renombra como sidecars
e2e/                     Tests de UI con Playwright
```

El frontend nunca arma comandos: manda intenciones tipadas (`ExportRequest`) y Rust valida y construye los argumentos.

## Desarrollo

Requisitos: Node 22+, Rust estable. FFmpeg: `npm run fetch-ffmpeg` (Linux/macOS) o `powershell scripts/fetch-ffmpeg.ps1` (Windows).

```bash
npm install
npm run tauri dev          # en Windows
```

### Compilar el instalador desde Linux

```bash
rustup target add x86_64-pc-windows-msvc
pip install cargo-xwin     # o: cargo install cargo-xwin
sudo apt install nsis
npm run fetch-ffmpeg
npm run build:win          # tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc
```

El instalador queda en `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

## Tests

```bash
npm test                                   # Vitest: timecode, store, atajos, escalado
npx playwright test                        # UI en navegador con el IPC de Tauri mockeado
cd src-tauri/core && cargo test            # Rust: unit + integración con FFmpeg real
cd src-tauri && cargo xwin clippy --target x86_64-pc-windows-msvc --workspace --all-targets -- -D warnings
```

Los tests de integración usan `SNIP_FFMPEG_DIR` (por defecto `/opt/ffmpeg9/bin`). También se pueden compilar para Windows (`cargo xwin test --no-run`) y correr con los `ffmpeg.exe`/`ffprobe.exe` del instalador.

## Licencias

El código de Snip es para uso personal. FFmpeg se distribuye bajo GPLv3 (build *essentials* de gyan.dev, que incluye libx264); su licencia se instala junto a la app como `FFMPEG-LICENSE.txt`.
