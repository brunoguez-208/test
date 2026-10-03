# Snip 2 — progreso

Convertir Snip (recortador de MP4) en un editor de video completo sin perder la esencia:
abrir rápido, editar y exportar. Este archivo es la fuente de verdad del avance: si la sesión
se corta, se retoma desde acá.

## Estado

- [x] Código de Snip 1.0 importado al repo (`snip/`), tests de base en verde
      (Rust 19 integración + unit, Vitest 42, Playwright 18).
- [x] **Tanda 1** — base del editor (instalador generado)
- [x] **Tanda 2** — imagen, texto y efectos (instalador final generado)
- [x] **Actualización 2.1 — tanda A** (grabaciones NVIDIA, ventana, portapapeles, imagen,
      audio, pistas, proyecto/versiones/plantillas) — instalador `Snip_2.1.0-tandaA_x64-setup.exe`
- [ ] **Actualización 2.1 — tanda B** (biblioteca, visor de origen, rampas, chroma, presets,
      máscaras, herramientas automáticas, sonidos)

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
- [x] Tests completos + instalador final (`Snip_2.0.0_x64-setup.exe`, 62,5 MB)

### Tests al cierre de la tanda 2
- Rust: 131 unit (compilador de filtros por efecto, color/looks, zonas, PiP, capas,
  transcripción, descarga, carpetas de capas) + 17 integración con FFmpeg real (incluye un
  export que combina todo lo de la tanda 2 y la extracción de audio para transcribir).
- Paridad SSIM preview ↔ exportación: 8 escenarios (transiciones, velocidad/fundidos,
  geometría, color y cada look, zoom con keyframes, textos/logo/subtítulos, zonas y PiP),
  todos ≥ 0,95.
- Vitest: 78. Playwright con IPC simulado: 50 (incluye imagen, textos, subtítulos,
  subtítulos automáticos, zonas, PiP, tema claro/oscuro, movimiento reducido, rendimiento).
- Windows (con wine): `ffmpeg.exe` shared con sus DLL procesa los filtros nuevos;
  `whisper-cli.exe` carga y, sin GPU, cae solo al backend de CPU.
- No probado acá: transcripción real (Hugging Face bloqueado en este entorno), GPU real
  (NVENC, Vulkan), notificaciones de Windows, asociaciones y menú contextual.

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


## Actualización 2.1 — tanda A — checklist
Reglas: mismo diseño y animaciones, todo lo existente sigue andando, tests como regresión,
un commit por funcionalidad. Al terminar la tanda A: tests completos + instalador, y seguir con B.

- [x] A1. Grabaciones de NVIDIA (ShadowPlay / Instant Replay) que fallaban con NVENC
- [x] A2. Controles de ventana duplicados al maximizar
- [x] A3. Copiar / cortar / pegar / duplicar / agrupar + portapapeles de Windows + pegar efectos
- [x] A4. "Agregar imagen" como capa normal (+ "Usar como marca de agua") y arrastrar a la pista
- [x] A5. Edición de audio (pistas, separar audio, keyframes de volumen, crossfade, "Mejorar voz")
- [x] A6. Pistas: ocultar, silenciar, bloquear; Q/W; atajos en el panel `?`
- [x] A7. Proyecto .snip desde Exportar, "Guardar como…", empaquetar, versiones y plantillas
- [x] Cierre: tests completos + instalador de la tanda A

### Notas de A1 (grabaciones de NVIDIA)
- Causa: ShadowPlay graba VFR; el promedio sale como fracciones enormes (`1300000/21667`) y
  algunas herramientas reportan la base de tiempo (`90000/1`) como fps. Ese valor terminaba en
  el lienzo y en el `fps=` del filtro, y NVENC no inicializa con esas fracciones (x264 sí).
  Además 10 bits / HDR y las dos pistas de audio (juego + micrófono) no estaban contempladas.
- `probe.rs`: `avg_frame_rate` → cuadros/duración → `r_frame_rate` (se descarta > 1000 fps);
  si es VFR con cuadros salteados y la nominal es apenas mayor, se usa la nominal. Todo pasa por
  `standard_fps` (la estándar más cercana ±1,5 %, si no un entero, tope 240). También detecta
  pistas de audio, bits por componente y HDR (PQ/HLG). `Canvas::fps()` normaliza siempre, así
  que proyectos viejos con 90000/1 exportan bien. Espejo en TS (`standardFps`).
- Antes de cualquier encoder: HDR → SDR (zscale + tonemap Hable, BT.709) y `format=yuv420p`
  (8 bits 4:2:0). Las pistas de audio se mezclan con `amix` (sin normalizar) por defecto, en el
  render directo y en la etapa pesada; en la pestaña Audio se puede elegir una sola pista.
  El modo rápido no copia archivos con varias pistas (quedaría audible solo la primera).
- Preview = exportación: para medios con varias pistas o HDR se genera solo un proxy 720p que
  mezcla/convierte igual (el preview sigue andando mientras tanto, con un aviso chico).
- **Fallback obligatorio**: cualquier error con el encoder por hardware (salvo cancelar, disco
  lleno, permisos o archivo faltante) se reintenta con libx264, también en la etapa pesada y en
  el proxy. NVENC se descarta solo en esa sesión y solo si falló el encoder en sí (antes quedaba
  desactivado para siempre en la caché).
- Errores útiles: "Ver detalles" con el texto real de FFmpeg (hasta 4000 caracteres), botón
  "Copiar" y "Abrir log", en el aviso flotante y en la cola. Log rotativo en
  `%APPDATA%\com.snip.app\logs\snip.log` (1 MB × 3) con cada comando de FFmpeg que falló.
- Nombres con varios puntos (`Desktop 2026.10.03 - 04.28.16.07.mp4`): la extensión es solo lo
  último en Rust y TS (tests en los dos lados).
- Tests: `tests/nvidia_integration.rs` genera HEVC VFR con base de tiempo 90000 y dos pistas,
  HEVC 10 bits HDR 4K120 y AV1 10 bits 4K144; exporta pidiendo NVENC (acá falla de verdad, sin
  GPU) y verifica con ffprobe H.264, yuv420p, fps estándar, una pista con las dos mezcladas
  (tonos de 440 Hz y 1 kHz), elegir una sola pista, la etapa pesada y proyectos viejos.
  Unit tests de probe con JSON real de ShadowPlay (`r_frame_rate` 90000/1), Vitest y Playwright
  (`e2e/nvidia.spec.ts`).

### Notas de A2 (controles de ventana duplicados)
- Causa: para que Mica se vea detrás del contenido, `system.rs` extiende el marco de DWM a toda
  la ventana (márgenes −1), y tao deja siempre `WS_CAPTION | WS_SYSMENU`. En ese modo DWM dibuja
  sus propios botones de ventana en el "vidrio", que se veían a través del webview transparente
  detrás de los de decorum; al maximizar (el marco cambia) quedaban corridos. Además decorum
  inyectaba sus botones por JS en cada evento de carga de página (inicio y fin).
- Arreglo: `hide_native_caption_buttons` quita `WS_SYSMENU` (sin él DWM no dibuja botones) y una
  subclase de la ventana lo vuelve a quitar en cada `WM_STYLECHANGING` (tao reescribe el estilo
  al maximizar/restaurar). `WS_THICKFRAME`, `WS_CAPTION`, min/max se mantienen: Snap con
  Win+flechas y arrastrando a los bordes, animaciones y sombra siguen iguales. Al maximizar,
  tao ya ajusta el área cliente al área de trabajo del monitor (nada queda cortado).
- Los botones los dibuja React (`WindowControls`): un solo juego, mismos glifos de Segoe Fluent
  Icons, mismos ids/estilos de siempre; el de maximizar cambia a "restaurar" y, igual que antes,
  al quedarse encima abre Snap Layouts (se usa solo el comando `show_snap_overlay` de decorum).
- Test de Playwright: un solo juego, alineado al borde derecho y sin tapar la barra en normal,
  maximizado y restaurado, y sin duplicarse al recargar. La verificación visual real (Windows 11
  con Mica, maximizar/restaurar/Snap) queda en el checklist manual.

### Notas de A3 (portapapeles y grupos)
- `project/clipboard.ts` (puro, con tests): copiar guarda clips de la pista principal, capas,
  audio y subtítulos con sus tiempos relativos, efectos, keyframes y estilos, más los medios que
  usan. Pegar en el playhead: los clips se insertan ahí (si cae dentro de un clip, se divide); lo
  demás conserva sus distancias y su fila si está libre (si no, la primera libre). Ids nuevos,
  todo es una edición (Ctrl+Z). Ctrl+D duplica a continuación; Ctrl+X corta.
- Lo copiado también va como JSON al portapapeles del sistema: se puede pegar en otra pestaña.
- Pegar desde Windows (`store/clipboard.ts`): primero lo copiado en Snip; si no, archivos del
  Explorador (CF_HDROP leído en Rust: videos a la pista principal, audio a una pista de audio
  libre, imágenes como capa); si no, una imagen (captura con Win+Shift+S → PNG en
  `%APPDATA%\com.snip.app\pegados\` → capa de imagen); si no, texto → capa de texto. Se usa el
  evento `paste` del WebView, con respaldo por teclado + Clipboard API. En un campo de texto,
  Ctrl+V pega en el campo.
- Ctrl+Alt+V pega solo efectos (color, look, nitidez, ruido, estabilización, velocidad, volumen)
  del último clip copiado, sin tocar cortes ni encuadre.
- Grupos (`project.groups`, también en el modelo de Rust): elegir uno elige el grupo; arrastrar
  una capa o un audio corre a los demás; copiar/borrar va completo; Ctrl+Shift+G desagrupa.
- Menú contextual (clic derecho) en clips, capas, audio y subtítulos con las mismas acciones.
- El audio ya admite varias filas (`track`): pegar o arrastrar hacia abajo usa otra pista.
- Se sacó Ctrl+G de los atajos del navegador que se bloquean (si no, nunca llegaba a la app).

### Notas de A4 (imagen como capa y arrastrar a la pista)
- "Agregar imagen" (pestaña Video) suma una capa normal en el playhead, centrada, por 5 s; se
  puede repetir (una o varias imágenes por vez). Posición (arrastrando en el preview), tamaño,
  rotación, opacidad, esquinas, sombra, duración y animación de entrada/salida (fundido,
  deslizar, pop). Todo lo dibuja el mismo raster del preview y de la exportación, así que la
  paridad es por construcción; la clave por cuadro incluye las animaciones de imágenes.
- "Usar como marca de agua": la imagen pasa a durar todo el video (abajo a la derecha, 85 %) y se
  re-ajusta sola en cada edición si el video cambia de largo (`syncWatermarks`). Las esquinas
  rápidas siguen ahí. Un solo paso de deshacer.
- Arrastrar desde el Explorador: si se suelta sobre una pista del timeline va a esa pista en el
  tiempo del puntero (se ve una guía): imágenes a esa fila de capas, video sobre las capas →
  picture-in-picture, audio (o el sonido de un video) a esa pista de audio, video a la pista
  principal en ese punto. Fuera del timeline, como antes (ahora también acepta imágenes y
  mezclas de archivos). Tauri da la posición en píxeles físicos: se divide por devicePixelRatio.
- Modelo (Rust y TS): `ImageLayer.rotation`, `animIn`, `animOut`, `watermark`.

### Notas de A5 (edición de audio)
- Modelo (Rust y TS): `project.tracks` (estado por pista: nombre, volumen, silenciar, solo,
  ocultar, bloquear), y en los clips de audio `track`, `volumeKeys`, `enhance`, `linkedClip`,
  `sourceTrack`, `muted`; en los clips de video `audio.enhance` y `audio.detached`.
- Los clips de audio se editan como los de video: S divide el audio elegido bajo el playhead
  (la curva de volumen se reparte), Supr, recortar bordes, mover (también entre pistas,
  arrastrando hacia arriba/abajo), copiar/pegar, imán y deshacer.
- "Separar audio" (clic derecho o pestaña Audio): el sonido del clip pasa a su propia pista, en el
  mismo lugar y tramo, y el clip queda mudo; "Unir audio" lo devuelve (solo clips sin velocidad,
  reversa ni repeticiones).
- Varias pistas de audio, cada una con volumen, silenciar y solo (cabecera en el timeline y
  mezclador en la pestaña Audio; el audio del video es una pista más). Solo = suenan solo las
  pistas en solo.
- Curva de volumen sobre la forma de onda: doble clic agrega un punto (la altura es el nivel,
  0–200 %), se arrastra, doble clic lo borra. Curva suave (smoothstep) idéntica en el preview
  (`keyGain`) y en la exportación (`volume=eval=frame` con la misma expresión).
- Crossfade corto automático (30 ms) donde dos audios de la misma pista se tocan.
- "Mejorar voz": reducción de ruido (afftdn), pasa-altos, menos "barro" en 300 Hz, presencia en
  3,5 kHz, aire, compresor y nivel de voz a −16 LUFS (con la medición del tramo), con intensidad.
  Parámetros en `config/voice.json` (Rust + TS). El preview usa los mismos biquads RBJ en
  WebAudio; el compresor de WebAudio agrega su propio makeup y se compensa midiéndolo una vez.
- Paridad de audio: `e2e/audio-parity.spec.ts` pasa una señal multitono por el preview
  (OfflineAudioContext) y por la exportación real: diferencia ≤ 0,2 dB por frecuencia.
  `tests/audio_integration.rs`: separado = original, curva (−20 dB), volumen/silenciar/solo de
  pistas, y "Mejorar voz" baja el zumbido de 60 Hz bastante más que la voz.
- El área de pistas usa `overflow: clip`: antes un `scrollIntoView` (foco por teclado o un
  elemento más ancho que la vista) podía correr todo el timeline y dejar la pista de video fuera.

### Notas de A6 (pistas, Q/W, atajos)
- Cabecera de cada pista (columna izquierda, ahora de 96 px): ojo en video, capas y
  subtítulos; silenciar y solo en el audio del video y en cada pista de audio; candado en todas.
- Ojo: la pista no se ve ni en el preview ni en la exportación (video → negro con las capas
  encima; capas y subtítulos no se rasterizan; el PiP oculto tampoco suena). Silenciar/solo: ver A5.
- Candado: lo de esa pista se puede elegir pero no mover, recortar, dividir, cortar ni borrar
  (aviso "Esa pista está bloqueada"). Se ve con un rayado suave.
- Q / W: recortan el inicio / final del clip bajo el playhead hasta el playhead (con ripple en
  la pista principal; si hay audio, capas o subtítulos elegidos bajo el playhead, recortan esos).
- Panel `?`: secciones nuevas "Portapapeles" y "Pistas y audio", y Q / W en Edición.

### Notas de A7 (proyecto, versiones y plantillas)
- Exportar → formato "Proyecto": guarda solo el `.snip` al instante (junto al video que se
  exportaría, o el `.snip` de la pestaña), sin pasar por la cola. Ctrl+E respeta la elección.
- Menú "Proyecto" en la barra de título: Guardar (Ctrl+S), Guardar proyecto como… (Ctrl+Shift+S),
  Guardar versión…, Versiones…, Empaquetar en una carpeta… / en un ZIP…, Guardar como plantilla…
- Empaquetar (`snip-core/src/package.rs`): `.snip` + copia de cada medio en `media/` con rutas
  relativas (nombres repetidos → "(2)"), en una carpeta nueva (nunca pisa una existente) o en un
  ZIP (medios sin recomprimir, ZIP64 para archivos de más de 4 GB). Al abrir un `.snip`, las
  rutas relativas se resuelven desde su carpeta: se abre en otra PC tal cual.
- Versiones (carpeta de datos `versions/<proyecto>/`): manual con nombre opcional y una
  automática por cada exportación (se guardan las últimas 20 automáticas; las manuales, todas);
  lista con miniatura y fecha. Restaurar es una edición más (Ctrl+Z) y no toca las demás.
- Plantillas (`templates/<id>/`): intro (primer clip), outro (último), textos/logos y estilo de
  subtítulos, preset de exportación; los medios se copian a la plantilla. En la bienvenida,
  "Nuevo desde plantilla": se eligen los videos y queda intro + videos + outro con todo aplicado.

### Cierre de la tanda A
- Rust: 149 unit + integración (4 audio, 19 FFmpeg, 9 NVIDIA, 17 proyectos) en verde;
  `cargo clippy -D warnings` (core y app para Windows) sin avisos; `tsc` (app y tests) limpio.
- Vitest 108; Playwright 67 (chromium + paridad de video y de audio + rendimiento).
- Versión 2.1.0. Instalador `Snip_2.1.0-tandaA_x64-setup.exe` (62,7 MB, SHA-256
  `065656fb…81ad6`) en la rama `instaladores`; la 2.0.0 quedó en `anteriores/`.


## Actualización 2.1 — tanda B — checklist
- [x] B1. Biblioteca de medios
- [ ] B2. Visor de origen
- [ ] B3. Rampas de velocidad
- [ ] B4. Chroma key
- [ ] B5. Presets de efectos (shake, zoom punch, flash, glitch, viñeta)
- [ ] B6. Máscaras
- [ ] B7. Herramientas automáticas (jugadas, silencios, beats)
- [ ] B8. Pack de sonidos (CC0 / sintetizados)
- [ ] Cierre: tests completos, instalador final, resumen y checklist manual

### Notas de B1 (biblioteca de medios)
- Panel izquierdo (botón en la barra de título): todos los medios del proyecto con miniatura,
  duración y tipo; pasar el mouse por un video recorre su contenido (12 miniaturas pedidas en
  paralelo); punto de color = está en el timeline. Búsqueda por nombre y orden por recientes,
  nombre (natural: "2" antes que "10"), duración o tipo.
- Importar sin tocar el timeline: botón +, soltar archivos del Explorador sobre el panel, o
  Ctrl+V con el puntero/foco en el panel. Un medio que falta muestra "Buscar archivo".
- Arrastrar una tarjeta a cualquier pista: guía en la pista y el tiempo, y se ubica con la misma
  lógica que el drop del Explorador (`project/library.ts`, `placeMedia`).
