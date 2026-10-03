//! Commands de Tauri. El frontend manda intenciones tipadas (un proyecto, un
//! pedido de exportación); acá se valida y se delega en `snip_core`. Ningún
//! string de comando viene del frontend.

use crate::state::AppState;
use crate::{system, theme};
use base64::Engine;
use serde::{Deserialize, Serialize};
use snip_core::encoder::Encoder;
use snip_core::error::{AppError, ErrorKind};
use snip_core::probe::MediaInfo;
use snip_core::progress::ProgressReport;
use snip_core::project::{Clip, Loudness, MediaRef, Project};
use snip_core::project_export::ExportJob;
use snip_core::queue::QueueItem;
use snip_core::runner::JobControl;
use snip_core::sizing::PlatformLimits;
use snip_core::store::{ProjectSummary, RecentFile};
use snip_core::{naming, store};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

type CmdResult<T> = Result<T, AppError>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?
}

pub fn allow_asset(app: &AppHandle, path: &Path) {
    // Scope del asset protocol: solo los archivos abiertos (y sus proxies), nunca `**`.
    let _ = app.asset_protocol_scope().allow_file(path);
}

fn now_ms() -> u64 {
    snip_core::project_export::now_ms()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub material: String,
    pub palette: theme::Palette,
}

/// Archivo con el que se lanzó la app ("Abrir con" / menú contextual). Se entrega una sola vez.
#[tauri::command]
pub fn take_launch_file(state: State<'_, AppState>) -> Option<String> {
    state.launch_file.lock().ok().and_then(|mut g| g.take())
}

/// La ventana arranca oculta; el frontend la muestra después del primer paint.
#[tauri::command]
pub fn show_main_window(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn get_appearance(state: State<'_, AppState>) -> Appearance {
    Appearance {
        material: state.material.lock().map(|m| m.clone()).unwrap_or_else(|_| "none".into()),
        palette: theme::current(),
    }
}

/// Valida que sea un video soportado, lee sus metadatos y habilita su lectura en el preview.
#[tauri::command]
pub async fn open_media(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<MediaInfo> {
    let tools = state.tools.clone();
    let p = PathBuf::from(&path);
    let info = blocking(move || snip_core::probe_file(&tools, &p)).await?;
    allow_asset(&app, Path::new(&path));
    Ok(info)
}

/// Cualquier archivo que se suma al proyecto (video, música o imagen).
#[tauri::command]
pub async fn probe_media(app: AppHandle, state: State<'_, AppState>, path: String, id: String) -> CmdResult<MediaRef> {
    let tools = state.tools.clone();
    let p = PathBuf::from(&path);
    let m = blocking(move || snip_core::probe_media(&tools, &p, &id)).await?;
    allow_asset(&app, Path::new(&path));
    Ok(m)
}

/// Habilita en el preview los archivos de un proyecto abierto (autoguardado o `.snip`).
#[tauri::command]
pub fn allow_project_media(app: AppHandle, project: Project) -> Vec<String> {
    let missing = store::missing_media(&project);
    for m in &project.media {
        if !missing.contains(&m.id) {
            allow_asset(&app, Path::new(&m.path));
        }
    }
    missing
}

#[tauri::command]
pub async fn get_keyframes(state: State<'_, AppState>, path: String) -> CmdResult<Vec<f64>> {
    let tools = state.tools.clone();
    blocking(move || snip_core::keyframes(&tools, Path::new(&path))).await
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThumbRequest {
    pub path: String,
    pub time: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbEvent {
    group: String,
    generation: u32,
    index: usize,
    data_url: String,
}

/// Miniaturas en segundo plano (de a 4 en paralelo), mandadas a medida que salen.
/// Un pedido nuevo del mismo `group` cancela el anterior.
#[tauri::command]
pub fn request_thumbnails(
    app: AppHandle,
    state: State<'_, AppState>,
    group: String,
    generation: u32,
    items: Vec<ThumbRequest>,
    height: u32,
) {
    let job = JobControl::new();
    if let Ok(mut g) = state.thumbs_jobs.lock() {
        if let Some(prev) = g.insert(group.clone(), job.clone()) {
            prev.cancel();
        }
    }
    let tools = state.tools.clone();
    let height = height.clamp(32, 360);
    let items: Vec<ThumbRequest> = items.into_iter().take(400).collect();
    std::thread::spawn(move || {
        let next = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                scope.spawn(|| loop {
                    if job.is_cancelled() {
                        return;
                    }
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let Some(it) = items.get(i) else { return };
                    if let Some(bytes) = snip_core::thumbnail(&tools, Path::new(&it.path), it.time, height) {
                        if job.is_cancelled() {
                            return;
                        }
                        let data_url = format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
                        let _ = app.emit("thumbnail", ThumbEvent { group: group.clone(), generation, index: i, data_url });
                    }
                });
            }
        });
    });
}

/// Forma de onda (picos 0..255, 100 por segundo) en base64. Se cachea por archivo.
#[tauri::command]
pub async fn get_waveform(app: AppHandle, path: String) -> CmdResult<String> {
    blocking(move || {
        let state = app.state::<AppState>();
        if let Some(w) = state.waveforms.lock().ok().and_then(|g| g.get(&path).cloned()) {
            return Ok(base64::engine::general_purpose::STANDARD.encode(w.as_slice()));
        }
        let peaks = snip_core::audio::waveform(&state.tools, Path::new(&path))?;
        let enc = base64::engine::general_purpose::STANDARD.encode(&peaks);
        if let Ok(mut g) = state.waveforms.lock() {
            g.insert(path, std::sync::Arc::new(peaks));
        }
        Ok(enc)
    })
    .await
}

/// Primera pasada de loudnorm (para normalizar un clip).
#[tauri::command]
pub async fn analyze_loudness(state: State<'_, AppState>, path: String, start: f64, duration: f64) -> CmdResult<Loudness> {
    let tools = state.tools.clone();
    blocking(move || snip_core::audio::analyze_loudness(&tools, Path::new(&path), start, duration)).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyProgress {
    path: String,
    percent: f64,
}

/// Proxy 720p H.264 para cuando WebView2 no puede reproducir el original (HEVC).
#[tauri::command]
pub async fn create_preview_proxy(app: AppHandle, state: State<'_, AppState>, path: String, duration: f64, fps: f64) -> CmdResult<String> {
    let job = JobControl::new();
    if let Ok(mut g) = state.proxy_job.lock() {
        if let Some(prev) = g.replace(job.clone()) {
            prev.cancel();
        }
    }
    let output = state.proxy_path_for(Path::new(&path));
    let app2 = app.clone();
    let src = path.clone();
    let out = blocking(move || {
        let state = app2.state::<AppState>();
        let encoder = state.encoder();
        let spec = snip_core::ProxySpec { input: Path::new(&src), output: &output, duration, fps };
        snip_core::make_proxy(&state.tools, &spec, encoder, &job, |r: ProgressReport| {
            let _ = app2.emit("proxy-progress", ProxyProgress { path: src.clone(), percent: r.percent });
        })
    })
    .await?;
    allow_asset(&app, &out);
    Ok(out.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cancel_proxy(state: State<'_, AppState>) {
    if let Ok(mut g) = state.proxy_job.lock() {
        if let Some(job) = g.take() {
            job.cancel();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeavyProgress {
    key: String,
    percent: f64,
}

/// Etapa pesada para el preview (invertir, boomerang, cámara lenta suave,
/// estabilización, reducción de ruido). La exportación reusa el mismo archivo.
#[tauri::command]
pub async fn prepare_clip(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    media: MediaRef,
    clip: Clip,
    canvas_fps: String,
    canvas_fps_value: f64,
) -> CmdResult<String> {
    if !canvas_fps.chars().all(|c| c.is_ascii_digit() || c == '/') {
        return Err(AppError::new(ErrorKind::InvalidRange));
    }
    let job = JobControl::new();
    if let Ok(mut g) = state.heavy_jobs.lock() {
        if let Some(prev) = g.insert(key.clone(), job.clone()) {
            prev.cancel();
        }
    }
    let app2 = app.clone();
    let k = key.clone();
    let result = blocking(move || {
        let state = app2.state::<AppState>();
        let encoder = state.encoder();
        snip_core::heavy::process_clip(
            &state.tools,
            &media,
            &clip,
            &canvas_fps,
            canvas_fps_value,
            encoder,
            &state.heavy_dir(),
            &job,
            |percent| {
                let _ = app2.emit("heavy-progress", HeavyProgress { key: k.clone(), percent });
            },
        )
    })
    .await;
    if let Ok(mut g) = state.heavy_jobs.lock() {
        g.remove(&key);
    }
    let inter = result?;
    allow_asset(&app, Path::new(&inter.path));
    Ok(inter.path)
}

#[tauri::command]
pub fn cancel_prepare(state: State<'_, AppState>, key: String) {
    if let Ok(mut g) = state.heavy_jobs.lock() {
        if let Some(job) = g.remove(&key) {
            job.cancel();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderInfo {
    pub id: Encoder,
    pub label: &'static str,
    pub hardware: bool,
}

/// Encoder H.264 que se va a usar (detectado y cacheado).
#[tauri::command]
pub async fn get_encoder(app: AppHandle) -> CmdResult<EncoderInfo> {
    blocking(move || {
        let state = app.state::<AppState>();
        let e = state.encoder();
        Ok(EncoderInfo { id: e, label: e.label(), hardware: e.is_hardware() })
    })
    .await
}

#[tauri::command]
pub fn platform_limits() -> PlatformLimits {
    snip_core::sizing::platform_limits()
}

/// Ruta que se usaría por defecto para exportar (junto al original, sin sobrescribir).
#[tauri::command]
pub fn default_output_path(job: ExportJob) -> CmdResult<String> {
    snip_core::project_export::resolve_output(&job).map(|p| p.to_string_lossy().into_owned())
}

// ------------------------------- Cola -----------------------------------------

#[tauri::command]
pub fn enqueue_export(state: State<'_, AppState>, job: ExportJob, title: String) -> CmdResult<u64> {
    if job.project.clips.is_empty() {
        return Err(AppError::with_message(ErrorKind::InvalidRange, "El proyecto está vacío."));
    }
    // Validamos antes de encolar para avisar enseguida (rango, confirmaciones, archivo de salida).
    snip_core::project_export::resolve_output(&job)?;
    let q = state.queue.get().ok_or_else(|| AppError::new(ErrorKind::Unknown))?;
    Ok(q.enqueue(job, title))
}

#[tauri::command]
pub fn export_queue(state: State<'_, AppState>) -> Vec<QueueItem> {
    state.queue.get().map(|q| q.snapshot()).unwrap_or_default()
}

#[tauri::command]
pub fn cancel_export_item(state: State<'_, AppState>, id: u64) {
    if let Some(q) = state.queue.get() {
        q.cancel(id);
    }
}

#[tauri::command]
pub fn reorder_export_item(state: State<'_, AppState>, id: u64, index: usize) {
    if let Some(q) = state.queue.get() {
        q.reorder(id, index);
    }
}

#[tauri::command]
pub fn remove_export_item(state: State<'_, AppState>, id: Option<u64>) {
    if let Some(q) = state.queue.get() {
        q.remove_finished(id);
    }
}

// ------------------------------ Proyectos -------------------------------------

#[tauri::command]
pub async fn autosave_project(app: AppHandle, project: Project, file: Option<String>) -> CmdResult<()> {
    blocking(move || app.state::<AppState>().store.autosave(&project, file.as_deref())).await
}

#[tauri::command]
pub async fn save_project_thumbnail(app: AppHandle, id: String, jpeg_base64: String) -> CmdResult<()> {
    blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(jpeg_base64.trim_start_matches("data:image/jpeg;base64,"))
            .map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
        app.state::<AppState>().store.save_thumbnail(&id, &bytes)
    })
    .await
}

#[tauri::command]
pub async fn list_unfinished(app: AppHandle) -> CmdResult<Vec<ProjectSummary>> {
    blocking(move || {
        let st = app.state::<AppState>();
        let list = st.store.unfinished();
        for s in &list {
            if let Some(t) = &s.thumbnail {
                allow_asset(&app, Path::new(t));
            }
        }
        Ok(list)
    })
    .await
}

#[tauri::command]
pub async fn load_autosave(app: AppHandle, id: String) -> CmdResult<Project> {
    blocking(move || app.state::<AppState>().store.load(&id)).await
}

#[tauri::command]
pub fn discard_project(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.store.discard(&id)
}

#[tauri::command]
pub fn mark_project_exported(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.store.mark_exported(&id, now_ms())
}

#[tauri::command]
pub fn recent_files(state: State<'_, AppState>) -> Vec<RecentFile> {
    state.store.recent()
}

#[tauri::command]
pub fn add_recent_file(state: State<'_, AppState>, path: String, kind: String) -> CmdResult<()> {
    state.store.add_recent(&path, &kind, now_ms())
}

#[tauri::command]
pub fn remove_recent_file(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    state.store.remove_recent(&path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub project: Project,
    /// Ids de los medios que no están (para re-vincular).
    pub missing: Vec<String>,
}

#[tauri::command]
pub async fn open_snip(app: AppHandle, path: String) -> CmdResult<OpenedProject> {
    if !naming::is_project(Path::new(&path)) {
        return Err(AppError::new(ErrorKind::UnsupportedFormat));
    }
    blocking(move || {
        let (project, missing) = store::open_snip(Path::new(&path))?;
        for m in &project.media {
            if !missing.contains(&m.id) {
                allow_asset(&app, Path::new(&m.path));
            }
        }
        Ok(OpenedProject { project, missing })
    })
    .await
}

#[tauri::command]
pub async fn save_snip(path: String, project: Project) -> CmdResult<String> {
    blocking(move || {
        let p = naming::ensure_extension(Path::new(&path), naming::PROJECT_EXT);
        store::save_snip(&p, &project)?;
        Ok(p.to_string_lossy().into_owned())
    })
    .await
}

/// Guarda un PNG (cuadro actual) que renderizó el compositor.
#[tauri::command]
pub async fn save_png(path: String, png_base64: String) -> CmdResult<String> {
    blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png_base64.trim_start_matches("data:image/png;base64,"))
            .map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
        if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
            return Err(AppError::with_message(ErrorKind::Unknown, "La imagen no es un PNG válido."));
        }
        let p = naming::ensure_extension(Path::new(&path), "png");
        store::write_atomic(&p, &bytes)?;
        Ok(p.to_string_lossy().into_owned())
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct RasterFile {
    pub name: String,
    pub data: String,
}

/// Escribe PNG de capas (textos, subtítulos, máscaras) en la carpeta de un trabajo.
#[tauri::command]
pub async fn write_raster_files(state: State<'_, AppState>, id: String, files: Vec<RasterFile>) -> CmdResult<String> {
    let root = state.raster_dir();
    blocking(move || {
        let decoded = files
            .into_iter()
            .map(|f| {
                base64::engine::general_purpose::STANDARD
                    .decode(f.data.trim_start_matches("data:image/png;base64,"))
                    .map(|b| (f.name, b))
                    .map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        snip_core::raster::write_files(&root, &id, &decoded).map(|d| d.to_string_lossy().into_owned())
    })
    .await
}

/// Escribe la lista ffconcat de una capa y devuelve su ruta.
#[tauri::command]
pub async fn write_raster_list(state: State<'_, AppState>, id: String, name: String, text: String) -> CmdResult<String> {
    let root = state.raster_dir();
    blocking(move || snip_core::raster::write_list(&root, &id, &name, &text).map(|p| p.to_string_lossy().into_owned())).await
}

/// Descarta las capas de un trabajo que no llegó a la cola.
#[tauri::command]
pub fn discard_raster(state: State<'_, AppState>, dir: String) {
    snip_core::raster::remove_job_dir(&state.raster_dir(), &dir);
}

// ------------------------- Subtítulos automáticos -------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub present: bool,
    /// Tamaño aproximado de la descarga (MB).
    pub download_mb: u64,
    /// ¿Está instalado whisper-cli?
    pub engine: bool,
}

#[tauri::command]
pub fn model_status(state: State<'_, AppState>) -> ModelStatus {
    use snip_core::transcribe::*;
    ModelStatus {
        present: model_file_ok(&model_path(&state.data_dir), MODEL_MIN_BYTES),
        download_mb: 550,
        engine: whisper_exe(&state.whisper_dir).is_file(),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProgress {
    received: u64,
    total: Option<u64>,
}

/// Baja el modelo de reconocimiento de voz (una sola vez), con progreso.
#[tauri::command]
pub async fn download_model(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    use snip_core::transcribe::*;
    let dest = model_path(&state.data_dir);
    let ctl = JobControl::new();
    if let Ok(mut g) = state.model_job.lock() {
        if let Some(prev) = g.replace(ctl.clone()) {
            prev.cancel();
        }
    }
    blocking(move || {
        download_model(&curl_program(), MODEL_URL, &dest, MODEL_MIN_BYTES, &ctl, |received, total| {
            let _ = app.emit("model-progress", ModelProgress { received, total });
        })
    })
    .await
}

#[tauri::command]
pub fn cancel_model_download(state: State<'_, AppState>) {
    if let Ok(mut g) = state.model_job.lock() {
        if let Some(j) = g.take() {
            j.cancel();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeProgress {
    stage: snip_core::transcribe::TranscribeStage,
    percent: f64,
}

/// Transcribe el audio del proyecto y devuelve los subtítulos (palabra por palabra).
#[tauri::command]
pub async fn transcribe(app: AppHandle, state: State<'_, AppState>, project: Project, language: Option<String>) -> CmdResult<snip_core::transcribe::Transcript> {
    use snip_core::transcribe::*;
    let model = model_path(&state.data_dir);
    if !model_file_ok(&model, MODEL_MIN_BYTES) {
        return Err(AppError::with_message(ErrorKind::NotFound, "Falta el modelo de reconocimiento de voz."));
    }
    let whisper = whisper_exe(&state.whisper_dir);
    if !whisper.is_file() {
        return Err(AppError::with_message(ErrorKind::NotFound, "Falta el motor de subtítulos automáticos. Reinstalá Snip."));
    }
    let ctl = JobControl::new();
    if let Ok(mut g) = state.transcribe_job.lock() {
        if let Some(prev) = g.replace(ctl.clone()) {
            prev.cancel();
        }
    }
    let tools = state.tools.clone();
    let encoder = state.encoder();
    let heavy = state.heavy_dir();
    let temp = state.temp_dir();
    blocking(move || {
        let work = temp.join(format!("whisper-{}", std::process::id()));
        std::fs::create_dir_all(&work).map_err(|e| AppError::from_io(&e))?;
        let wav = work.join("audio.wav");
        let env = snip_core::project_export::ExportEnv { tools: &tools, encoder, heavy_dir: &heavy, temp_dir: &temp };
        let emit = |stage: TranscribeStage, percent: f64| {
            let _ = app.emit("transcribe-progress", TranscribeProgress { stage, percent });
        };
        let result = extract_audio(&env, &project, &wav, &ctl, |p| emit(TranscribeStage::Audio, p))
            .and_then(|_| run_whisper(&whisper, &model, &wav, &work, language.as_deref(), &ctl, |p| emit(TranscribeStage::Transcribing, p)));
        let _ = std::fs::remove_dir_all(&work);
        result
    })
    .await
}

#[tauri::command]
pub fn cancel_transcribe(state: State<'_, AppState>) {
    if let Ok(mut g) = state.transcribe_job.lock() {
        if let Some(j) = g.take() {
            j.cancel();
        }
    }
}

const MAX_SRT: u64 = 5 * 1024 * 1024;

fn is_srt(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("srt"))
}

/// Lee un .srt (UTF-8 o Latin-1).
#[tauri::command]
pub async fn read_subtitles(path: String) -> CmdResult<String> {
    blocking(move || {
        let p = Path::new(&path);
        if !is_srt(p) {
            return Err(AppError::with_message(ErrorKind::UnsupportedFormat, "Elegí un archivo de subtítulos .srt."));
        }
        let meta = std::fs::metadata(p).map_err(|e| AppError::from_io(&e))?;
        if meta.len() > MAX_SRT {
            return Err(AppError::with_message(ErrorKind::Unsupported, "El archivo de subtítulos es demasiado grande."));
        }
        let bytes = std::fs::read(p).map_err(|e| AppError::from_io(&e))?;
        Ok(naming::decode_subtitle_text(&bytes))
    })
    .await
}

/// Guarda los subtítulos como .srt (UTF-8).
#[tauri::command]
pub async fn write_subtitles(path: String, text: String) -> CmdResult<String> {
    blocking(move || {
        let p = naming::ensure_extension(Path::new(&path), "srt");
        store::write_atomic(&p, text.as_bytes())?;
        Ok(p.to_string_lossy().into_owned())
    })
    .await
}

/// ¿Existen estos archivos? (para avisar de medios movidos o borrados).
#[tauri::command]
pub fn files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> CmdResult<()> {
    system::reveal_in_folder(Path::new(&path))
}

#[tauri::command]
pub fn open_in_default_app(path: String) -> CmdResult<()> {
    system::open_with_default_app(Path::new(&path))
}
