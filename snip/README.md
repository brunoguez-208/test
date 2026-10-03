# Snip

Editor de video rápido para Windows 11. Click derecho en un video → **Editar con Snip** → editás → exportás. Sin perder la esencia de la versión 1: abrir rápido, editar y exportar.

- **Timeline multi-clip**: agregar (arrastrando o con el botón), unir, reordenar, dividir (S), borrar (Supr), marcadores (M), zoom con miniaturas, deshacer/rehacer ilimitado.
- **Por clip**: velocidad 0,25×–4× (con cámara lenta suave interpolada), invertir, congelar cuadro, loop y boomerang, transiciones, audio (volumen, silenciar, quitar, fundidos, normalizar, reducir ruido).
- **Proyecto**: pista de música con ducking, fundido a negro, guardar el cuadro actual como PNG, extraer el audio a MP3, exportar fragmentos como archivos separados.
- **Exportación**: MP4 / MOV (H.264), MKV, WebM (VP9), GIF de alta calidad, MP3. Presets de tamaño para Discord (gratis / Nitro Basic / Nitro) y WhatsApp, o un tamaño a medida. Cola en segundo plano con notificación de Windows.
- **Modo rápido sin pérdida**: si exportás un solo video con cortes y sin efectos, se copia sin recodificar (como en Snip 1). Si no, recodifica con la GPU si puede: NVENC → Quick Sync → AMF → x264.
- **Imagen**: recortar con proporciones (16:9, 9:16, 1:1, 4:5 o libre) arrastrando sobre la vista previa, rotar y voltear, zoom y paneo con keyframes, color (exposición, brillo, contraste, saturación, temperatura), looks de un click con intensidad, estabilizar, nitidez y reducción de ruido.
- **Textos y subtítulos**: títulos con plantillas, fuente, contorno, sombra, fondo y animaciones; subtítulos `.srt` (importar, editar, guardar) o **automáticos** con whisper.cpp (en tu equipo, con la placa de video si puede), con estilo palabra por palabra.
- **Capas**: logo o marca de agua, zonas desenfocadas o pixeladas (que pueden seguir algo que se mueve) y picture-in-picture con esquinas redondeadas y sombra.
- **Proyectos**: autoguardado, "Proyectos sin terminar" en la bienvenida, `.snip` junto al video exportado (Ctrl+S para guardarlo cuando quieras), recientes y pestañas.
- Entrada: MP4, MOV, MKV y WebM.

## Instalación

Ejecutá `Snip_2.0.0_x64-setup.exe`. Se instala para tu usuario (no pide permisos de administrador) y actualiza Snip 1 si lo tenías.

Como el instalador no está firmado, Windows SmartScreen va a mostrar **«Windows protegió tu PC»**. Hacé click en **Más información** → **Ejecutar de todas formas**.

### Menú contextual y asociaciones

- **Editar con Snip** en el menú contextual de `.mp4`, `.mov`, `.mkv` y `.webm` (`HKCU\Software\Classes\SystemFileAssociations\.<ext>\shell\SnipEdit`), y Snip en **Abrir con**, sin cambiar tu reproductor predeterminado. Reemplaza al «Recortar con Snip» de la versión 1.
- Los proyectos **`.snip`** se abren con doble click y tienen su propio ícono.

En Windows 11 la entrada del menú aparece en **Mostrar más opciones** (o con Shift + click derecho), porque el menú moderno solo muestra extensiones que implementan `IExplorerCommand` (requiere un paquete MSIX firmado).

Al desinstalar se borran las entradas del menú, los ProgID y las asociaciones.

## Atajos

`?` abre el panel de atajos dentro de la app.

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausa |
| J / K / L | Atrás / pausa / adelante (repetir acelera) |
| ← / → | Un cuadro (con Shift, 1 segundo) |
| S | Dividir en el playhead |
| Supr | Borrar la selección o el rango I/O |
| I / O | Marcar inicio / fin del rango |
| M | Marcador (Shift+M siguiente, Ctrl+Shift+M anterior) |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| + / − | Zoom del timeline (también Ctrl + rueda) |
| Ctrl+S | Guardar el proyecto (`.snip`) |
| Ctrl+E | Exportar |
| Ctrl+O | Abrir video o proyecto |
| Ctrl+Tab / Ctrl+W | Pestaña siguiente / cerrar pestaña |
| Enter / Esc | Confirmar / cancelar el recorte |

Los atajos se ignoran mientras escribís en un campo.

## Stack

- Tauri 2 + React 19 + TypeScript + Vite
- Tailwind 4, Motion (`motion/react`), Zustand, Fluent UI System Icons
- `window-vibrancy` (Mica, Acrylic como alternativa), `tauri-plugin-decorum` (barra de título con Snap Layouts), `tauri-plugin-single-instance`, `tauri-plugin-dialog`, `tauri-plugin-notification`
- Preview: compositor WebGL2 propio (transiciones con las mismas fórmulas que `xfade`, color, zonas y PiP); textos y subtítulos con canvas 2D, el mismo código que genera las capas de la exportación
- FFmpeg y FFprobe 9.0 (build GPL "shared" de BtbN: libx264, NVENC, QSV, AMF, libvpx, libopus, libmp3lame, libvidstab) en la carpeta `ffmpeg\` de la instalación
- whisper.cpp 1.9.2 (compilado con MinGW-w64: backend Vulkan + CPU) en `whisper\`; el modelo `large-v3-turbo` cuantizado se baja la primera vez que se usan los subtítulos automáticos

## Estructura

```
src/                     Frontend (React)
  project/               Modelo de proyecto (espejo del de Rust), operaciones, historial
  engine/                Reproductor del preview, compositor WebGL2 y capas (raster.ts)
  components/            Pantallas: bienvenida, editor, timeline, inspector, cola
  store/editor.ts        Estado (Zustand): pestañas, historial, selección, cola
  store/controller.ts    Acciones que hablan con Rust (abrir, autoguardar, exportar…)
  mocks/                 Backend simulado (tests de UI) y arnés de paridad
src-tauri/
  core/                  snip-core: TODA la lógica de FFmpeg/FFprobe, sin UI
    src/project.rs       Modelo de proyecto versionado (JSON, "version": 1)
    src/migrate.rs       Migraciones (incluye los proyectos de Snip 1)
    src/compile.rs       Proyecto → filter_complex (el frontend nunca arma comandos)
    src/filters.rs       Efectos por clip (recorte, color, nitidez, zoom), zonas, PiP y capas
    src/color.rs         Ajustes de color y looks (config/looks.json, compartido con el preview)
    src/transcribe.rs    Subtítulos automáticos: modelo, audio, whisper-cli, agrupado
    src/raster.rs        Carpetas de capas rasterizadas por trabajo (nombres validados)
    src/heavy.rs         Etapa pesada cacheada (invertir, cámara lenta, estabilizar…)
    src/sizing.rs        Bitrate para tamaño objetivo (2 pasadas / verificación)
    src/project_export.rs  Exportación completa con reintentos y modo rápido
    src/queue.rs         Cola de exportación en segundo plano
    src/store.rs         Autoguardado, proyectos sin terminar, recientes, .snip
    config/platform_limits.json  Límites de Discord/WhatsApp (único lugar a editar)
    examples/snip_render.rs      CLI de desarrollo (tests de paridad)
    tests/               Integración con FFmpeg real
  src/                   App Tauri: commands, tema (UISettings), Mica, shell
  windows/hooks.nsh      Hooks del instalador (menú contextual, Abrir con, .snip)
scripts/fetch-ffmpeg.*   Descarga FFmpeg (shared) a src-tauri/binaries/ffmpeg
scripts/build-whisper.sh Compila whisper.cpp para Windows (Vulkan + CPU) a src-tauri/binaries/whisper
e2e/                     Tests de UI, paridad y rendimiento con Playwright
```

## Desarrollo

Requisitos: Node 22+, Rust estable. FFmpeg: `npm run fetch-ffmpeg` (Linux/macOS) o `powershell scripts/fetch-ffmpeg.ps1` (Windows).

```bash
npm install
npm run tauri dev          # en Windows
```

### Compilar el instalador desde Linux

```bash
rustup target add x86_64-pc-windows-gnu
sudo apt install mingw-w64 nsis
npm run fetch-ffmpeg
bash scripts/build-whisper.sh   # necesita además cmake, ninja-build, glslc y libvulkan-dev
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
```

El instalador queda en `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/`. Con acceso a los servidores de Microsoft también funciona `npm run build:win` (cargo-xwin + MSVC).

## Tests

```bash
npm test                                   # Vitest: modelo, timeline, historial, atajos
PW_CHROMIUM_PATH=… npx playwright test     # UI con IPC mockeado + paridad SSIM + rendimiento
cd src-tauri/core && cargo test            # Rust: unit + integración con FFmpeg real
cd src-tauri && cargo clippy --target x86_64-pc-windows-gnu --workspace --all-targets -- -D warnings
```

Los tests de integración y de paridad usan `SNIP_FFMPEG_DIR` (por defecto `/opt/ffmpeg9/bin`); `SNIP_SKIP_INTEGRATION=1` los saltea.

## Licencias

El código de Snip es para uso personal. FFmpeg se distribuye bajo GPLv3 (build de BtbN, que incluye libx264); su licencia se instala como `ffmpeg\FFMPEG-LICENSE.txt`. whisper.cpp es MIT (`whisper\WHISPER-LICENSE.txt`); el modelo de reconocimiento de voz es de OpenAI (MIT), convertido por el proyecto whisper.cpp.
