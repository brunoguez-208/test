//! Commands de Tauri. El frontend manda intenciones tipadas; acá se valida y
//! se delega en `snip_core`. Ningún string de comando viene del frontend.

use crate::state::AppState;
use crate::{system, theme};
use base64::Engine;
use serde::Serialize;
use snip_core::encoder::Encoder;
use snip_core::error::{AppError, ErrorKind};
use snip_core::export::{ExportMode, ExportRequest};
use snip_core::probe::MediaInfo;
use snip_core::progress::ProgressReport;
use snip_core::runner::JobControl;
use snip_core::{naming, ExportOutcome};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

type CmdResult<T> = Result<T, AppError>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?
}

fn allow_asset(app: &AppHandle, path: &Path) {
    // Scope del asset protocol: solo el archivo abierto (y su proxy), nunca `**`.
    let _ = app.asset_protocol_scope().allow_file(path);
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

/// Valida que sea un MP4 existente, lee sus metadatos y habilita su lectura en el preview.
#[tauri::command]
pub async fn open_media(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<MediaInfo> {
    let tools = state.tools.clone();
    let p = PathBuf::from(&path);
    let info = blocking(move || snip_core::probe_file(&tools, &p)).await?;
    allow_asset(&app, Path::new(&path));
    Ok(info)
}

#[tauri::command]
pub async fn get_keyframes(state: State<'_, AppState>, path: String) -> CmdResult<Vec<f64>> {
    let tools = state.tools.clone();
    blocking(move || snip_core::keyframes(&tools, Path::new(&path))).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbEvent {
    generation: u32,
    index: usize,
    total: usize,
    data_url: String,
}

/// Genera miniaturas en segundo plano (de a 4 en paralelo) y las manda a medida que salen.
#[tauri::command]
pub fn start_thumbnails(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    duration: f64,
    count: usize,
    height: u32,
    generation: u32,
) {
    let job = JobControl::new();
    if let Ok(mut g) = state.thumbs_job.lock() {
        if let Some(prev) = g.replace(job.clone()) {
            prev.cancel();
        }
    }
    let tools = state.tools.clone();
    let count = count.clamp(1, 60);
    let height = height.clamp(32, 360);
    std::thread::spawn(move || {
        let times = snip_core::export::thumbnail_times(duration, count);
        snip_core::thumbnails(&tools, Path::new(&path), &times, height, 4, &job, |index, bytes| {
            let data_url =
                format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
            let _ = app.emit("thumbnail", ThumbEvent { generation, index, total: count, data_url });
        });
        if !job.is_cancelled() {
            let _ = app.emit("thumbnails-done", generation);
        }
    });
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyProgress {
    path: String,
    percent: f64,
}

/// Proxy 720p H.264 para cuando WebView2 no puede reproducir el original (HEVC).
#[tauri::command]
pub async fn create_preview_proxy(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    duration: f64,
    fps: f64,
) -> CmdResult<String> {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderInfo {
    pub id: Encoder,
    pub label: &'static str,
    pub hardware: bool,
}

/// Encoder H.264 que se va a usar en modo preciso (detectado y cacheado).
#[tauri::command]
pub async fn get_encoder(app: AppHandle) -> CmdResult<EncoderInfo> {
    blocking(move || {
        let state = app.state::<AppState>();
        let e = state.encoder();
        Ok(EncoderInfo { id: e, label: e.label(), hardware: e.is_hardware() })
    })
    .await
}

/// Ruta que se usaría por defecto (junto al original, sin sobrescribir).
#[tauri::command]
pub fn default_output_path(path: String) -> String {
    naming::unique_output_path(Path::new(&path), |p| p.exists()).to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn export_video(app: AppHandle, request: ExportRequest) -> CmdResult<ExportOutcome> {
    blocking(move || {
        let state = app.state::<AppState>();
        let job = JobControl::new();
        {
            let mut g = state.export_job.lock().map_err(|_| AppError::new(ErrorKind::Unknown))?;
            if g.is_some() {
                return Err(AppError::new(ErrorKind::Busy));
            }
            *g = Some(job.clone());
        }
        let result = (|| {
            let info = snip_core::probe_file(&state.tools, Path::new(&request.input))?;
            let encoder = match request.effective_mode() {
                ExportMode::Precise => state.encoder(),
                ExportMode::Fast => Encoder::Libx264,
            };
            let app2 = app.clone();
            snip_core::export(
                &state.tools,
                &request,
                &info,
                encoder,
                &job,
                |r| {
                    let _ = app2.emit("export-progress", r);
                },
                |failed| state.mark_encoder_failed(failed),
            )
        })();
        if let Ok(mut g) = state.export_job.lock() {
            *g = None;
        }
        result
    })
    .await
}

#[tauri::command]
pub fn cancel_export(state: State<'_, AppState>) {
    if let Ok(g) = state.export_job.lock() {
        if let Some(job) = g.as_ref() {
            job.cancel();
        }
    }
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> CmdResult<()> {
    system::reveal_in_folder(Path::new(&path))
}

#[tauri::command]
pub fn open_in_default_app(path: String) -> CmdResult<()> {
    system::open_with_default_app(Path::new(&path))
}
