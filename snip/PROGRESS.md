# Snip 2 — progreso

Convertir Snip (recortador de MP4) en un editor de video completo sin perder la esencia:
abrir rápido, editar y exportar. Este archivo es la fuente de verdad del avance: si la sesión
se corta, se retoma desde acá.

## Estado

- [x] Código de Snip 1.0 importado al repo (`snip/`), tests de base en verde
      (Rust 19 integración + unit, Vitest 42, Playwright 18).
- [ ] **Tanda 1** — base del editor (en curso)
- [ ] **Tanda 2** — imagen, texto y efectos

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
- [ ] 0. Modelo de proyecto + migraciones + matemática de tiempos (Rust + TS)
- [ ] 1. Timeline multi-clip (agregar, unir, reordenar)
- [ ] 2. Dividir (S) y borrar (Supr) con cierre de huecos
- [ ] 3. Exportar fragmentos como archivos separados
- [ ] 4. Deshacer / rehacer
- [ ] 5. Zoom del timeline con miniaturas regeneradas
- [ ] 6. Marcadores (M)
- [ ] 7. Velocidad 0.25x–4x con atempo
- [ ] 8. Cámara lenta suave (minterpolate)
- [ ] 9. Invertir
- [ ] 10. Congelar frame
- [ ] 11. Loop / boomerang
- [ ] 12. Audio por clip (volumen, silenciar, quitar, fades, loudnorm, afftdn)
- [ ] 13. Pista de música (+ ducking)
- [ ] 14. Forma de onda
- [ ] 15. Extraer audio a MP3
- [ ] 16. Fundido a negro
- [ ] 17. Transiciones (xfade)
- [ ] 18. Guardar frame como PNG
- [ ] 19. Presets de tamaño por plataforma
- [ ] 20. Cola de exportación + notificación de Windows
- [ ] 21. Proyectos: autoguardado, sin terminar, `.snip`, recientes, pestañas
- [ ] Formatos de entrada MP4/MOV/MKV/WebM, salida MP4/MOV/MKV/WebM/GIF/MP3
- [ ] Menú contextual "Editar con Snip" + asociación `.snip`
- [ ] Tests completos + instalador de la tanda 1

## Tanda 2 — checklist
- [ ] 22. Crop con proporciones
- [ ] 23. Rotar / voltear
- [ ] 24. Zoom y paneo con keyframes
- [ ] 25. Ajustes de color
- [ ] 26. Looks
- [ ] 27. Estabilización (vidstab 2 pasadas)
- [ ] 28. Nitidez y reducción de ruido de imagen
- [ ] 29. Texto y títulos
- [ ] 30. Subtítulos `.srt`
- [ ] 31. Subtítulos automáticos (whisper.cpp)
- [ ] 32. Marca de agua / logo
- [ ] 33. Desenfocar / pixelar zona
- [ ] 34. Picture-in-picture
- [ ] Tests completos + instalador final
