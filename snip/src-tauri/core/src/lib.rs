//! Núcleo de Snip: todo lo que habla con FFmpeg/FFprobe, sin dependencias de UI.
//! Así se puede testear (unit + integración con FFmpeg real) en cualquier plataforma.

pub mod audio;
pub mod audio_fx;
pub mod color;
pub mod compile;
pub mod encoder;
pub mod error;
pub mod export;
pub mod fast;
pub mod filters;
pub mod graph;
pub mod heavy;
pub mod log;
pub mod migrate;
pub mod naming;
pub mod package;
pub mod probe;
pub mod progress;
pub mod queue;
pub mod chroma;
pub mod ramp;
pub mod raster;
pub mod project;
pub mod project_export;
pub mod runner;
pub mod scale;
pub mod sizing;
pub mod store;
pub mod timeline;
pub mod transcribe;
#[cfg(test)]
pub(crate) mod testutil;

use encoder::Encoder;
use error::{AppError, ErrorKind};
use export::{ExportMode, ExportRequest};
use probe::MediaInfo;
use progress::ProgressReport;
use runner::{JobControl, Tools};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

/// Lee los metadatos de un video (MP4, MOV, MKV o WebM).
pub fn probe_file(tools: &Tools, path: &Path) -> Result<MediaInfo, AppError> {
    if !naming::is_video(path) {
        return Err(AppError::new(ErrorKind::UnsupportedFormat));
    }
    if !path.is_file() {
        return Err(AppError::new(ErrorKind::NotFound));
    }
    let p = path.to_string_lossy();
    let out = runner::run_capture(&tools.ffprobe, &probe::probe_args(&p))?;
    probe::parse_probe(&String::from_utf8_lossy(&out), &p)
}

/// Lee cualquier archivo que se pueda sumar a un proyecto (video, audio o imagen).
pub fn probe_media(tools: &Tools, path: &Path, id: &str) -> Result<project::MediaRef, AppError> {
    use project::{MediaKind, MediaRef};
    if !path.is_file() {
        return Err(AppError::new(ErrorKind::NotFound));
    }
    let p = path.to_string_lossy().into_owned();
    if naming::is_video(path) {
        let m = probe_file(tools, path)?;
        return Ok(MediaRef {
            id: id.into(),
            path: p,
            kind: MediaKind::Video,
            duration: m.duration,
            width: m.width,
            height: m.height,
            fps: m.fps,
            fps_num: m.fps_num,
            fps_den: m.fps_den,
            has_audio: m.has_audio,
            video_codec: Some(m.video_codec),
            audio_codec: m.audio_codec,
            rotation: m.rotation,
            size_bytes: m.size_bytes,
            audio_tracks: m.audio_tracks,
            transfer: m.color_transfer.filter(|_| m.hdr),
        });
    }
    let out = runner::run_capture(&tools.ffprobe, &probe::probe_args(&p))?;
    let json = String::from_utf8_lossy(&out);
    let empty = |kind| MediaRef {
        id: id.into(),
        path: p.clone(),
        kind,
        duration: 0.0,
        width: 0,
        height: 0,
        fps: 30.0,
        fps_num: 30,
        fps_den: 1,
        has_audio: false,
        video_codec: None,
        audio_codec: None,
        rotation: 0,
        size_bytes: None,
        audio_tracks: 0,
        transfer: None,
    };
    if naming::is_audio(path) {
        let a = probe::parse_audio_probe(&json)?;
        return Ok(MediaRef {
            duration: a.duration,
            has_audio: true,
            audio_codec: Some(a.codec),
            size_bytes: a.size_bytes,
            ..empty(MediaKind::Audio)
        });
    }
    if naming::is_image(path) {
        let (w, h) = probe::parse_image_probe(&json)?;
        return Ok(MediaRef { width: w, height: h, ..empty(MediaKind::Image) });
    }
    Err(AppError::new(ErrorKind::UnsupportedFormat))
}

/// Tiempos de los keyframes del primer stream de video.
pub fn keyframes(tools: &Tools, path: &Path) -> Result<Vec<f64>, AppError> {
    let out = runner::run_capture(&tools.ffprobe, &probe::keyframe_args(&path.to_string_lossy()))?;
    Ok(probe::parse_keyframes(&String::from_utf8_lossy(&out)))
}

/// Prueba cada encoder por hardware con un encode real de 1 frame.
pub fn detect_encoder(tools: &Tools) -> Encoder {
    encoder::pick_encoder(|e| runner::run_ok(&tools.ffmpeg, &e.probe_args()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub output: String,
    pub mode: ExportMode,
    pub encoder: Option<Encoder>,
    /// Si el encoder por hardware falló y se reintentó con libx264.
    pub fell_back: bool,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub size_bytes: u64,
    pub elapsed_secs: f64,
}

/// Decide la ruta final: la elegida en "Guardar como…" o una libre junto al original.
pub fn resolve_output(req: &ExportRequest) -> Result<PathBuf, AppError> {
    let input = Path::new(&req.input);
    let out = match &req.output {
        Some(o) if !o.trim().is_empty() => naming::ensure_mp4_extension(Path::new(o)),
        _ => naming::unique_output_path(input, |p| p.exists()),
    };
    if naming::same_file(input, &out) {
        return Err(AppError::new(ErrorKind::SameAsInput));
    }
    Ok(out)
}

/// Exporta. Si el encoder por hardware falla, reintenta una vez con libx264
/// y avisa con `on_encoder_failed` para invalidar la caché.
pub fn export(
    tools: &Tools,
    req: &ExportRequest,
    info: &MediaInfo,
    encoder: Encoder,
    job: &JobControl,
    mut on_progress: impl FnMut(ProgressReport),
    mut on_encoder_failed: impl FnMut(Encoder),
) -> Result<ExportOutcome, AppError> {
    let started = Instant::now();
    let final_path = resolve_output(req)?;
    let partial = naming::partial_path(&final_path);

    let mut enc = encoder;
    let mut fell_back = false;
    loop {
        let plan = export::plan(req, info, enc)?;
        let args = export::build_args(req, info, &plan, &partial);
        let (total, fps) = (plan.duration, plan.fps);
        let mut emit = progress::monotonic(&mut on_progress);
        let result = runner::run_ffmpeg_to_file(tools, &args, &partial, &final_path, job, |s| {
            emit(progress::report(&s, total, fps))
        });
        match result {
            Ok(()) => {
                let size_bytes = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
                return Ok(ExportOutcome {
                    output: final_path.to_string_lossy().into_owned(),
                    mode: plan.mode,
                    encoder: plan.encoder,
                    fell_back,
                    width: plan.width,
                    height: plan.height,
                    duration: plan.duration,
                    size_bytes,
                    elapsed_secs: started.elapsed().as_secs_f64(),
                });
            }
            Err(e)
                if e.retry_on_cpu() && plan.mode == ExportMode::Precise && enc != Encoder::Libx264 =>
            {
                log::warn(&format!("exportación con {} falló, reintento con libx264: {}", enc.ffmpeg_name(), e.log_line()));
                on_encoder_failed(enc);
                enc = Encoder::Libx264;
                fell_back = true;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Una miniatura JPEG en el segundo `t` (cerca del final, prueba un poco antes).
pub fn thumbnail(tools: &Tools, input: &Path, t: f64, height: u32) -> Option<Vec<u8>> {
    let input = input.to_string_lossy();
    for tt in [t, (t - 0.5).max(0.0)] {
        if let Ok(b) = runner::run_capture(&tools.ffmpeg, &export::thumbnail_args(&input, tt, height)) {
            if !b.is_empty() {
                return Some(b);
            }
        }
    }
    None
}

/// Genera `times.len()` miniaturas JPEG en paralelo (de a `parallel`), con
/// `-ss` antes de `-i` y `-frames:v 1`. Llama a `on_thumb` a medida que salen.
pub fn thumbnails(
    tools: &Tools,
    input: &Path,
    times: &[f64],
    height: u32,
    parallel: usize,
    job: &JobControl,
    on_thumb: impl Fn(usize, Vec<u8>) + Sync,
) {
    let next = AtomicUsize::new(0);
    let input = input.to_string_lossy().into_owned();
    std::thread::scope(|scope| {
        for _ in 0..parallel.max(1) {
            scope.spawn(|| loop {
                if job.is_cancelled() {
                    return;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                let Some(&t) = times.get(i) else { return };
                let mut jpeg = runner::run_capture(&tools.ffmpeg, &export::thumbnail_args(&input, t, height));
                // Cerca del final puede no haber cuadro: probamos un poco antes.
                if matches!(&jpeg, Ok(b) if b.is_empty()) || jpeg.is_err() {
                    jpeg = runner::run_capture(&tools.ffmpeg, &export::thumbnail_args(&input, (t - 0.5).max(0.0), height));
                }
                if let Ok(bytes) = jpeg {
                    if !bytes.is_empty() && !job.is_cancelled() {
                        on_thumb(i, bytes);
                    }
                }
            });
        }
    });
}

/// Qué proxy generar: original, destino y datos para calcular el progreso.
#[derive(Debug, Clone)]
pub struct ProxySpec<'a> {
    pub input: &'a Path,
    pub output: &'a Path,
    pub duration: f64,
    pub fps: f64,
    /// Mezcla de pistas y HDR → SDR (para que el preview coincida con la exportación).
    pub media: export::ProxyMedia,
}

/// Genera el proxy de preview. Devuelve la ruta del proxy.
pub fn make_proxy(
    tools: &Tools,
    spec: &ProxySpec<'_>,
    encoder: Encoder,
    job: &JobControl,
    mut on_progress: impl FnMut(ProgressReport),
) -> Result<PathBuf, AppError> {
    let output = spec.output;
    if output.is_file() {
        return Ok(output.to_path_buf());
    }
    let partial = naming::partial_path(output);
    let mut enc = encoder;
    loop {
        let args = export::proxy_args_with(&spec.input.to_string_lossy(), &partial, enc, &spec.media);
        let mut emit = progress::monotonic(&mut on_progress);
        match runner::run_ffmpeg_to_file(tools, &args, &partial, output, job, |s| {
            emit(progress::report(&s, spec.duration, spec.fps))
        }) {
            Ok(()) => return Ok(output.to_path_buf()),
            Err(e) if e.retry_on_cpu() && enc != Encoder::Libx264 => enc = Encoder::Libx264,
            Err(e) => return Err(e),
        }
    }
}
