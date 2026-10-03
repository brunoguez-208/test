# Snip 2 — progreso

Convertir Snip (recortador de MP4) en un editor de video completo sin perder la esencia:
abrir rápido, editar y exportar. Este archivo es la fuente de verdad del avance: si la sesión
se corta, se retoma desde acá.

## Estado

- [x] Código de Snip 1.0 importado al repo (`snip/`), tests de base en verde
      (Rust 19 integración + unit, Vitest 42, Playwright 18).
- [x] **Tanda 1** — base del editor (instalador generado)
- [ ] **Tanda 2** — imagen, texto y efectos (en curso)

## Decisiones tomadas

### Entorno de build
- El entorno bloquea `download.visualstudio.microsoft.com` y `aka.ms`, que `cargo-xwin` necesita
  para bajar el SDK de Windows y la CRT de MSVC. Mientras siga bloqueado, el instalador se
  cross-compila con el target **`x86_64-pc-windows-gnu`** (mingw-w64 + NSIS). Tauri incluye
  `WebView2Loader.dll` en el instalador para ese target. Si se habilitan esos hosts, se vuelve a
  `cargo-xwin` + `x86_64-pc-windows-msvc` sin cambios de código (`npm run build:win`).
- `www.gyan.dev` también está bloqueado: FFmpeg 9.0 sale del build **GPL de BtbN** (GitHub), que
  trae libx264, NVENC, QSV (libvpl), AMF, libvpx (VP9), libopus, libmp3lame y libvidstab.
- Tests de integración con FFmpeg 9.0 de BtbN para Linux en `/opt/ffmpeg9/bin` (`SNIP_FFMPEG_DIR`).
- Playwright usa el Chromium preinstalado: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

### Arquitectura
- **Modelo de proyecto** (`snip-core/src/project.rs`, espejo en `src/project/model.ts`):
  JSON versionado (`"version": 1`) con migraciones (`migrate.rs`). Contiene medios, clips de la
  pista principal, superposiciones, música, marcadores, rangos, subtítulos, fades, lienzo,
  estado de la vista y la última configuración de exportación. El original nunca se toca.
- **Tiempo**: la pista principal es magnética (clips contiguos). Una transición se guarda en el
  clip que entra y solapa los dos clips. La matemática de tiempos está duplicada en Rust
  (`timeline.rs`) y TS (`project/timeline.ts`) con los mismos tests.
- **Motor de render en Rust** (`compile.rs`): proyecto → `filter_complex`. Cada segmento de clip
  es un input propio con `-ss/-t` (seek por input, sin `split` que acumule cuadros en memoria).
  Cada clip se normaliza al lienzo (escala lanczos + pad, fps, yuv420p) antes de unir con
  `concat`/`xfade` (+ `acrossfade` en audio).
- **Etapa pesada**: reverse, boomerang, cámara lenta interpolada, estabilización y reducción de
  ruido generan un intermedio por clip (cacheado por hash). La exportación usa ese intermedio y
  el preview lo reproduce: misma fuente para los dos, paridad garantizada.
- **Preview**: compositor WebGL2 en el frontend (color, crop, rotar, zoom/paneo, transiciones,
  fades, velocidad, desenfoque de zona, PiP). Textos, subtítulos y logos se rasterizan con el
  mismo código de canvas para el preview y para la exportación (secuencia ffconcat de PNG que
  Rust superpone): lo que se ve es lo que se exporta.
- **Modo rápido sin pérdida**: automático solo con clips de un único video, sin efectos, en
  orden, a MP4/MOV/MKV y sin tamaño objetivo (varios cortes → partes copiadas + concat).
- **Normalizar audio**: análisis previo (loudnorm, 1ª pasada) guardado en el proyecto; la
  exportación usa loudnorm lineal con esas medidas y el preview aplica la ganancia equivalente.

## Tanda 1 — checklist
- [x] 0. Modelo de proyecto + migraciones + matemática de tiempos (Rust + TS)
- [x] 1. Timeline multi-clip (agregar, unir, reordenar)
- [x] 2. Dividir (S) y borrar (Supr) con cierre de huecos
- [x] 3. Exportar fragmentos como archivos separados
- [x] 4. Deshacer / rehacer
- [x] 5. Zoom del timeline con miniaturas regeneradas
- [x] 6. Marcadores (M)
- [x] 7. Velocidad 0.25x–4x con atempo
- [x] 8. Cámara lenta suave (minterpolate)
- [x] 9. Invertir
- [x] 10. Congelar frame
- [x] 11. Loop / boomerang
- [x] 12. Audio por clip (volumen, silenciar, quitar, fades, loudnorm, afftdn)
- [x] 13. Pista de música (+ ducking)
- [x] 14. Forma de onda
- [x] 15. Extraer audio a MP3
- [x] 16. Fundido a negro
- [x] 17. Transiciones (xfade)
- [x] 18. Guardar frame como PNG
- [x] 19. Presets de tamaño por plataforma
- [x] 20. Cola de exportación + notificación de Windows
- [x] 21. Proyectos: autoguardado, sin terminar, `.snip`, recientes, pestañas
- [x] Formatos de entrada MP4/MOV/MKV/WebM, salida MP4/MOV/MKV/WebM/GIF/MP3
- [x] Menú contextual "Editar con Snip" + asociación `.snip`
- [x] Tests completos + instalador de la tanda 1 (`Snip_2.0.0_x64-setup.exe`)

### Notas de la tanda 1
- **Discord gratis: 20 MB** (subió de 10 MB en agosto de 2026; verificado el 2026-10-03).
  Nitro Basic 50 MB, Nitro 500 MB, WhatsApp 16 MB. Todo en
  `src-tauri/core/config/platform_limits.json` (MB = 1.000.000 bytes, objetivo 95 %).
- Tamaño objetivo: 2 pasadas con libx264/VP9; con NVENC, `multipass` + verificación del
  tamaño real y reintento con menos bitrate (hasta 4 veces). Nunca se entrega un archivo
  por encima del límite (test de integración con video "difícil" de ruido).
- Asociaciones: "Editar con Snip" en el menú contextual de .mp4/.mov/.mkv/.webm
  (`SnipEdit`, reemplaza al "Recortar con Snip" de la 1.0, que el instalador borra) y en
  "Abrir con" sin robar el doble click. Los `.snip` sí abren Snip con doble click y tienen
  ícono propio (`icons/snip-file.ico`).
- Notificaciones de Windows con `tauri-plugin-notification` al terminar cada exportación
  en segundo plano.

### Tests al cierre de la tanda 1
- Rust: unit tests del compilador de filtros por funcionalidad, modelo/migraciones,
  bitrate, cola; integración con FFmpeg 9 real (proyectos combinados, formatos, tamaño
  objetivo siempre bajo el límite, fragmentos, modo rápido, cancelación).
- Paridad preview ↔ exportación (`e2e/parity.spec.ts`): el compositor WebGL y FFmpeg
  renderizan el mismo proyecto; SSIM ≥ 0,95 en cada transición, velocidad ×2/×0,5,
  barras y fundidos (control negativo: un cuadro corrido da 0,85–0,93).
- Vitest: modelo, operaciones del timeline, deshacer/rehacer, timecode, atajos.
- Playwright con IPC simulado: flujos completos, claro/oscuro, movimiento reducido,
  sin errores en consola; rendimiento con 12 clips.
- `tsc` y `cargo clippy -D warnings` (target Windows) sin errores ni avisos.


## Tanda 2 — checklist
- [x] 22. Crop con proporciones
- [x] 23. Rotar / voltear
- [x] 24. Zoom y paneo con keyframes
- [x] 25. Ajustes de color
- [x] 26. Looks
- [x] 27. Estabilización (vidstab 2 pasadas)
- [x] 28. Nitidez y reducción de ruido de imagen
- [x] 29. Texto y títulos
- [x] 30. Subtítulos `.srt`
- [x] 31. Subtítulos automáticos (whisper.cpp)
- [x] 32. Marca de agua / logo
- [x] 33. Desenfocar / pixelar zona
- [x] 34. Picture-in-picture
- [ ] Tests completos + instalador final

### Notas de la tanda 2
- **Paridad por construcción**: Rust (`filters.rs`, `color.rs`) y el shader del preview siguen la
  misma cadena: rotar → voltear → recortar (píxeles pares) → nitidez de luma (`convolution`) →
  color (dos afines con `colorchannelmixer` en `gbrap`, el desplazamiento entra por el alfa, y
  curvas con `lutrgb` evaluadas con los mismos coeficientes que la tabla del preview) → encajar
  → zoom/paneo (`perspective` con expresiones por cuadro; ojo: su `in` arranca en 1).
- Los looks están en `src-tauri/core/config/looks.json` (los leen Rust y el frontend).
- **Capas (textos, subtítulos, logos)**: un solo dibujante en canvas 2D (`src/engine/raster.ts`).
  El preview lo usa en vivo; la exportación genera un PNG por estado distinto + lista ffconcat
  (cada tramo arranca medio cuadro antes) que Rust superpone. Paridad SSIM ≥ 0,987.
  Los textos van siempre por encima de los clips y del PiP; los subtítulos, arriba de todo.
- Orden de composición (preview = exportación): clips → zonas desenfocadas/pixeladas → PiP →
  textos, logos y subtítulos. Zonas: máscara rasterizada (por cuadro si tienen keyframes) +
  `boxblur`/`pixelize` + `alphamerge`; en el preview, blur separable y pixelado por bloques
  alineados al origen. PiP: rectángulo en píxeles pares calculado en TS, máscara de esquinas y
  sombra dibujadas con canvas, video escalado con lanczos; su audio se mezcla con su volumen.
- El lienzo automático sigue al tamaño visible del primer clip (rotado/recortado).
- whisper.cpp: los binarios oficiales para Windows solo traen CPU o CUDA (670 MB). Se compila
  con MinGW + Vulkan (`scripts/build-whisper.sh`): GPU de NVIDIA, AMD o Intel, y la CPU como
  respaldo automático (ggml carga los backends como DLL).
- Subtítulos automáticos: modelo `ggml-large-v3-turbo-q5_0.bin` (multilingüe, ~547 MB) desde
  Hugging Face la primera vez, con `curl.exe` de Windows (reanuda descargas cortadas) y validación
  de la firma; vive en la carpeta de datos (`models/`). El audio es la misma mezcla que se exporta
  (WAV 16 kHz mono). whisper-cli con `-ml 1 -sow` da palabras con tiempos; se agrupan en
  subtítulos de ≤ 42 caracteres y ≤ 5 s, cortando en pausas y fin de oración. GPU primero; si
  falla, se repite con `-ng` (CPU). En este entorno no se puede bajar el modelo (Hugging Face está
  bloqueado): la transcripción real queda para la prueba manual; parsing, agrupado, argumentos,
  descarga (con `file://`) y extracción de audio sí tienen tests.
