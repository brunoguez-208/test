//! Exportación de un proyecto: decide el modo, procesa los clips pesados,
//! compila el `filter_complex`, codifica (1 o 2 pasadas), verifica el tamaño
//! objetivo y guarda el `.snip` junto al video.

use crate::compile::{self, CompileOptions, Compiled, Intermediate, Pass, RasterInputs};
use crate::encoder::Encoder;
use crate::error::{AppError, ErrorKind};
use crate::fast;
use crate::heavy;
use crate::naming;
use crate::progress::{self, ProgressSample};
use crate::project::*;
use crate::runner::{self, JobControl, Tools};
use crate::sizing::{self, BitratePlan, SizeInput, MB};
use crate::timeline;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub start: f64,
    pub end: f64,
}

/// Pedido de exportación (lo arma el frontend: el proyecto y la intención, nunca comandos).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub project: Project,
    /// Configuración a usar (por defecto, la del proyecto).
    #[serde(default)]
    pub settings: Option<ExportSettings>,
    /// Solo un rango del timeline (fragmentos).
    #[serde(default)]
    pub window: Option<Window>,
    /// Ruta elegida con "Guardar como…".
    #[serde(default)]
    pub output: Option<String>,
    /// Sufijo del nombre (por ejemplo, el nombre del fragmento).
    #[serde(default)]
    pub label: Option<String>,
    /// Guardar el `.snip` junto al video.
    #[serde(default = "yes")]
    pub save_project: bool,
    /// Capas rasterizadas (texto, subtítulos, máscaras) ya escritas en disco.
    #[serde(default)]
    pub raster: Option<RasterSpec>,
}

impl ExportJob {
    pub fn settings(&self) -> &ExportSettings {
        self.settings.as_ref().unwrap_or(&self.project.export)
    }
    pub fn window(&self) -> Option<(f64, f64)> {
        self.window.map(|w| (w.start, w.end))
    }
}

/// Capas rasterizadas que manda el frontend (rutas a listas ffconcat).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RasterSpec {
    /// Carpeta del trabajo (se borra al terminar).
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub decor: Option<String>,
    #[serde(default)]
    pub masks: HashMap<String, String>,
    #[serde(default)]
    pub pips: HashMap<String, PipSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipSpec {
    pub mask: String,
    #[serde(default)]
    pub shadow: Option<String>,
    pub width: u32,
    pub height: u32,
    pub x: i64,
    pub y: i64,
    #[serde(default)]
    pub shadow_x: i64,
    #[serde(default)]
    pub shadow_y: i64,
}

impl RasterSpec {
    pub fn to_inputs(&self) -> RasterInputs {
        RasterInputs {
            decor: self.decor.clone(),
            masks: self.masks.clone(),
            pip: self
                .pips
                .iter()
                .map(|(k, p)| {
                    (
                        k.clone(),
                        compile::PipRaster {
                            mask: p.mask.clone(),
                            shadow: p.shadow.clone(),
                            width: p.width,
                            height: p.height,
                            x: p.x,
                            y: p.y,
                            shadow_x: p.shadow_x,
                            shadow_y: p.shadow_y,
                        },
                    )
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Preparing,
    Copying,
    Encoding,
    FirstPass,
    SecondPass,
    Retrying,
}

/// Progreso de un trabajo de exportación.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub percent: f64,
    pub speed: Option<f64>,
    pub eta_secs: Option<f64>,
    pub stage: Stage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutcomeMode {
    Fast,
    Precise,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOutcome {
    pub output: String,
    pub project_file: Option<String>,
    pub mode: OutcomeMode,
    pub format: OutputFormat,
    pub encoder: Option<Encoder>,
    pub fell_back: bool,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub size_bytes: u64,
    pub elapsed_secs: f64,
    /// Veces que se recodificó para entrar en el tamaño objetivo.
    pub size_retries: u32,
}

/// Nombre base de la salida: `nombre_snip` (o `nombre_snip - fragmento`).
pub fn default_output(job: &ExportJob) -> Result<PathBuf, AppError> {
    let p = &job.project;
    let first = p.clips.first().and_then(|c| p.media(&c.media_id)).ok_or_else(|| AppError::new(ErrorKind::InvalidRange))?;
    let dir = Path::new(&first.path).parent().map(Path::to_path_buf).unwrap_or_default();
    let name = if p.name.trim().is_empty() {
        Path::new(&first.path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "video".into())
    } else {
        p.name.clone()
    };
    let mut base = format!("{}{}", naming::sanitize_file_name(&name), naming::SUFFIX);
    if let Some(l) = job.label.as_deref().filter(|l| !l.trim().is_empty()) {
        base = format!("{base} - {}", naming::sanitize_file_name(l));
    }
    Ok(naming::unique_in_dir_ext(&dir, &base, job.settings().format.extension(), |q| q.exists()))
}

pub fn resolve_output(job: &ExportJob) -> Result<PathBuf, AppError> {
    let ext = job.settings().format.extension();
    let out = match &job.output {
        Some(o) if !o.trim().is_empty() => naming::ensure_extension(Path::new(o), ext),
        _ => default_output(job)?,
    };
    for m in &job.project.media {
        if naming::same_file(Path::new(&m.path), &out) {
            return Err(AppError::new(ErrorKind::SameAsInput));
        }
    }
    Ok(out)
}

/// Clips (dentro del rango) que necesitan la etapa pesada.
pub fn heavy_clips(p: &Project, window: Option<(f64, f64)>) -> Vec<usize> {
    let spans = timeline::layout(&p.clips);
    let total = spans.last().map(|s| s.end).unwrap_or(0.0);
    let (ws, we) = window.unwrap_or((0.0, total));
    let range = compile::window_clips(&spans, ws, we).unwrap_or((0, 0));
    (range.0..=range.1).filter(|&i| i < p.clips.len() && heavy::needs_heavy(&p.clips[i])).collect()
}

/// Procesa (o toma de la caché) los clips con efectos pesados del rango.
/// `on_progress` va de 0 a 100 sobre todos los clips.
pub fn prepare_intermediates(
    env: &ExportEnv,
    p: &Project,
    window: Option<(f64, f64)>,
    ctl: &JobControl,
    mut on_progress: impl FnMut(f64),
) -> Result<HashMap<String, Intermediate>, AppError> {
    let heavy = heavy_clips(p, window);
    let mut intermediates: HashMap<String, Intermediate> = HashMap::new();
    for (n, &i) in heavy.iter().enumerate() {
        let c = &p.clips[i];
        let media = p.media(&c.media_id).ok_or_else(|| AppError::new(ErrorKind::BadProject))?;
        let base = 100.0 * n as f64 / heavy.len() as f64;
        let span = 100.0 / heavy.len() as f64;
        let run = |encoder: Encoder, on_progress: &mut dyn FnMut(f64)| {
            heavy::process_clip(env.tools, media, c, &p.canvas.fps_expr(), p.canvas.fps(), encoder, env.heavy_dir, ctl, |pct| {
                on_progress(base + span * pct / 100.0)
            })
        };
        let inter = match run(env.encoder, &mut on_progress) {
            // Con el encoder por hardware cualquier falla se reintenta con x264.
            Err(e) if env.encoder.is_hardware() && e.retry_on_cpu() => {
                crate::log::warn(&format!("etapa pesada con {} falló, reintento con libx264: {}", env.encoder.ffmpeg_name(), e.log_line()));
                run(Encoder::Libx264, &mut on_progress)?
            }
            r => r?,
        };
        intermediates.insert(c.id.clone(), inter);
    }
    Ok(intermediates)
}

pub struct ExportEnv<'a> {
    pub tools: &'a Tools,
    pub encoder: Encoder,
    /// Carpeta de la caché de la etapa pesada.
    pub heavy_dir: &'a Path,
    /// Carpeta para archivos temporales (logs de 2 pasadas, partes).
    pub temp_dir: &'a Path,
}

/// Exporta un proyecto. `on_encoder_failed` avisa que el encoder por hardware
/// falló (para invalidar la caché) y se reintenta con libx264.
pub fn export_project(
    env: &ExportEnv,
    job: &ExportJob,
    ctl: &JobControl,
    mut on_progress: impl FnMut(JobProgress),
    mut on_encoder_failed: impl FnMut(Encoder),
) -> Result<ProjectOutcome, AppError> {
    let started = Instant::now();
    let p = &job.project;
    let st = job.settings().clone();
    for m in &p.media {
        let used = p.clips.iter().any(|c| c.media_id == m.id)
            || p.music.iter().any(|x| x.media_id == m.id)
            || p.overlays.iter().any(|o| match &o.content {
                OverlayContent::Image(i) => i.media_id == m.id,
                OverlayContent::Video(v) => v.media_id == m.id,
                _ => false,
            });
        if used && !Path::new(&m.path).is_file() {
            return Err(AppError::with_message(
                ErrorKind::MediaMissing,
                format!("No encontramos «{}». Buscalo para volver a vincularlo.", file_name(&m.path)),
            ));
        }
    }
    let final_path = resolve_output(job)?;
    let partial = naming::partial_path(&final_path);
    std::fs::create_dir_all(env.temp_dir).map_err(|e| AppError::from_io(&e))?;

    // --- Modo rápido ---
    if let Some(plan) = fast::plan(p, &st, job.window()) {
        let outcome = run_fast(env, &st, &plan, &final_path, ctl, &mut on_progress)?;
        let project_file = finish(job, &final_path)?;
        let size_bytes = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
        return Ok(ProjectOutcome {
            output: final_path.to_string_lossy().into_owned(),
            project_file,
            mode: OutcomeMode::Fast,
            format: st.format,
            encoder: None,
            fell_back: false,
            width: plan.media.width,
            height: plan.media.height,
            duration: outcome,
            size_bytes,
            elapsed_secs: started.elapsed().as_secs_f64(),
            size_retries: 0,
        });
    }

    // --- Etapa pesada ---
    let heavy_share = if heavy_clips(p, job.window()).is_empty() { 0.0 } else { 40.0 };
    let intermediates = prepare_intermediates(env, p, job.window(), ctl, |pct| {
        on_progress(JobProgress { percent: heavy_share * pct / 100.0, speed: None, eta_secs: None, stage: Stage::Preparing })
    })?;

    // --- Codificación ---
    let raster = job.raster.as_ref().map(RasterSpec::to_inputs);
    let mut encoder = if st.format.has_video() && matches!(st.format, OutputFormat::Mp4 | OutputFormat::Mov | OutputFormat::Mkv) {
        env.encoder
    } else {
        Encoder::Libx264
    };
    let mut fell_back = false;
    loop {
        let compiled = compile::compile(
            p,
            &CompileOptions { settings: &st, window: job.window(), encoder, intermediates: &intermediates, raster: raster.as_ref() },
        )?;
        let bitrate = match &st.size_target {
            Some(t) => Some(sizing::plan_bitrate(&SizeInput {
                megabytes: t.megabytes,
                ratio: sizing::platform_limits().target_ratio,
                duration: compiled.duration,
                has_video: compiled.video_out.is_some(),
                has_audio: compiled.audio_out.is_some(),
                width: compiled.width,
                height: compiled.height,
                fps: compiled.fps,
                format: st.format,
            })?),
            None => None,
        };
        let result = encode_with_size_target(
            env,
            &compiled,
            encoder,
            bitrate,
            st.size_target.as_ref().map(|t| t.megabytes * MB),
            &partial,
            &final_path,
            ctl,
            heavy_share,
            &mut on_progress,
        );
        match result {
            Ok(retries) => {
                let project_file = finish(job, &final_path)?;
                let size_bytes = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
                return Ok(ProjectOutcome {
                    output: final_path.to_string_lossy().into_owned(),
                    project_file,
                    mode: OutcomeMode::Precise,
                    format: st.format,
                    encoder: compiled.video_out.as_ref().map(|_| encoder),
                    fell_back,
                    width: compiled.width,
                    height: compiled.height,
                    duration: compiled.duration,
                    size_bytes,
                    elapsed_secs: started.elapsed().as_secs_f64(),
                    size_retries: retries,
                });
            }
            // Fallback obligatorio: si el encoder por hardware falla por lo que
            // sea (driver, formato, fps, tamaño), se reintenta con libx264.
            Err(e) if encoder != Encoder::Libx264 && e.retry_on_cpu() => {
                crate::log::warn(&format!("exportación con {} falló, reintento con libx264: {}", encoder.ffmpeg_name(), e.log_line()));
                // Solo una falla del encoder en sí (driver, sesión) lo descarta
                // por el resto de la sesión; lo demás es de este proyecto.
                if e.kind == ErrorKind::EncoderFailed {
                    on_encoder_failed(encoder);
                }
                encoder = Encoder::Libx264;
                fell_back = true;
            }
            Err(e) => return Err(e),
        }
    }
}

fn file_name(p: &str) -> String {
    p.rsplit(['\\', '/']).next().unwrap_or(p).to_string()
}

/// Guarda el `.snip` junto al video (si se pidió).
fn finish(job: &ExportJob, video: &Path) -> Result<Option<String>, AppError> {
    if !job.save_project {
        return Ok(None);
    }
    let path = naming::project_file_for(video);
    let mut proj = job.project.clone();
    proj.exported_at = Some(now_ms());
    let text = serde_json::to_string_pretty(&proj).map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
    // Si no se puede escribir el .snip, el video igual quedó bien: no es un error fatal.
    match std::fs::write(&path, text) {
        Ok(()) => Ok(Some(path.to_string_lossy().into_owned())),
        Err(_) => Ok(None),
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn run_fast(
    env: &ExportEnv,
    st: &ExportSettings,
    plan: &fast::FastPlan,
    final_path: &Path,
    ctl: &JobControl,
    on_progress: &mut impl FnMut(JobProgress),
) -> Result<f64, AppError> {
    let hevc = matches!(plan.media.video_codec.as_deref(), Some("hevc" | "h265"));
    let total: f64 = plan.segments.iter().map(|s| s.1 - s.0).sum();
    let partial = naming::partial_path(final_path);
    if plan.segments.len() == 1 {
        let (a, b) = plan.segments[0];
        let args = fast::copy_args(&plan.media.path, a, b, st.format, hevc, &partial);
        let mut emit = progress::monotonic(|r| {
            on_progress(JobProgress { percent: r.percent, speed: r.speed, eta_secs: r.eta_secs, stage: Stage::Copying })
        });
        runner::run_ffmpeg_to_file(env.tools, &args, &partial, final_path, ctl, |s| emit(progress::report(&s, total, plan.media.fps)))?;
        return Ok(total);
    }
    // Varios tramos: se copia cada uno y se unen.
    let ext = st.format.extension();
    let mut parts = vec![];
    let mut done = 0.0;
    let cleanup = |parts: &[PathBuf]| parts.iter().for_each(|p| runner::remove_with_retry(p));
    for (i, (a, b)) in plan.segments.iter().enumerate() {
        let part = env.temp_dir.join(format!("fast-{}-{i}.{ext}", now_ms()));
        let pp = naming::partial_path(&part);
        let args = fast::copy_args(&plan.media.path, *a, *b, st.format, hevc, &pp);
        let base = done;
        let r = runner::run_ffmpeg_to_file(env.tools, &args, &pp, &part, ctl, |s| {
            on_progress(JobProgress {
                percent: ((base + s.out_time.min(b - a)) / total * 95.0).min(95.0),
                speed: s.speed,
                eta_secs: None,
                stage: Stage::Copying,
            })
        });
        if let Err(e) = r {
            cleanup(&parts);
            return Err(e);
        }
        parts.push(part);
        done += b - a;
    }
    let list = env.temp_dir.join(format!("fast-{}.txt", now_ms()));
    std::fs::write(&list, heavy::concat_list(&parts)).map_err(|e| AppError::from_io(&e))?;
    let args = fast::join_args(&list, st.format, hevc, &partial);
    let r = runner::run_ffmpeg_to_file(env.tools, &args, &partial, final_path, ctl, |_| {});
    cleanup(&parts);
    let _ = std::fs::remove_file(&list);
    r?;
    on_progress(JobProgress { percent: 100.0, speed: None, eta_secs: Some(0.0), stage: Stage::Copying });
    Ok(total)
}

#[allow(clippy::too_many_arguments)]
fn encode_with_size_target(
    env: &ExportEnv,
    c: &Compiled,
    encoder: Encoder,
    bitrate: Option<BitratePlan>,
    limit_bytes: Option<f64>,
    partial: &Path,
    final_path: &Path,
    ctl: &JobControl,
    offset: f64,
    on_progress: &mut impl FnMut(JobProgress),
) -> Result<u32, AppError> {
    let mut plan = bitrate;
    let mut retries = 0u32;
    loop {
        let stage_base = if retries > 0 { Stage::Retrying } else { Stage::Encoding };
        encode_once(env, c, encoder, plan.as_ref(), partial, final_path, ctl, offset, stage_base, on_progress)?;
        let (Some(limit), Some(p)) = (limit_bytes, plan.as_ref()) else { return Ok(retries) };
        let size = std::fs::metadata(final_path).map(|m| m.len()).unwrap_or(0);
        match sizing::retry_bitrate(p, size, limit) {
            None => return Ok(retries),
            Some(next) if retries < 4 => {
                runner::remove_with_retry(final_path);
                plan = Some(next);
                retries += 1;
            }
            Some(_) => {
                runner::remove_with_retry(final_path);
                return Err(AppError::with_message(
                    ErrorKind::InvalidRange,
                    "No pudimos dejar el video debajo del tamaño elegido. Probá con una resolución más baja.",
                ));
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn encode_once(
    env: &ExportEnv,
    c: &Compiled,
    encoder: Encoder,
    bitrate: Option<&BitratePlan>,
    partial: &Path,
    final_path: &Path,
    ctl: &JobControl,
    offset: f64,
    stage: Stage,
    on_progress: &mut impl FnMut(JobProgress),
) -> Result<(), AppError> {
    let head = |args: Vec<String>| {
        let mut a = vec!["-hide_banner".to_string(), "-nostdin".into(), "-loglevel".into(), "error".into(), "-y".into()];
        a.extend(c.input_args());
        a.extend(args);
        a
    };
    let span = 100.0 - offset;
    let report = |s: &ProgressSample, from: f64, width: f64, st: Stage, on: &mut dyn FnMut(JobProgress)| {
        let r = progress::report(s, c.duration, c.fps);
        on(JobProgress { percent: (from + width * r.percent / 100.0).min(99.5), speed: r.speed, eta_secs: r.eta_secs, stage: st });
    };
    if compile::uses_two_pass(c.format, encoder, bitrate) {
        let log = env.temp_dir.join(format!("pass-{}", now_ms())).to_string_lossy().into_owned();
        let first = head(compile::output_args(c, encoder, bitrate, &Pass::First { log: log.clone() }, final_path));
        let r1 = runner::run_ffmpeg(env.tools, &first, Some(env.temp_dir), ctl, |s| {
            report(&s, offset, span * 0.45, Stage::FirstPass, on_progress)
        });
        if let Err(e) = r1 {
            cleanup_passlog(&log);
            return Err(e);
        }
        let second = head(compile::output_args(c, encoder, bitrate, &Pass::Second { log: log.clone() }, partial));
        let r2 = runner::run_ffmpeg_to_file_in(env.tools, &second, Some(env.temp_dir), partial, final_path, ctl, |s| {
            report(&s, offset + span * 0.45, span * 0.55, if stage == Stage::Retrying { stage } else { Stage::SecondPass }, on_progress)
        });
        cleanup_passlog(&log);
        return r2;
    }
    let args = head(compile::output_args(c, encoder, bitrate, &Pass::Single, partial));
    runner::run_ffmpeg_to_file(env.tools, &args, partial, final_path, ctl, |s| report(&s, offset, span, stage, on_progress))
}

fn cleanup_passlog(log: &str) {
    for suffix in ["-0.log", "-0.log.mbtree", "-0.log.temp", "-0.log.mbtree.temp"] {
        let _ = std::fs::remove_file(format!("{log}{suffix}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    fn job(p: Project) -> ExportJob {
        ExportJob { project: p, settings: None, window: None, output: None, label: None, save_project: true, raster: None }
    }

    #[test]
    fn default_names_use_project_name_label_and_format() {
        let mut p = project_with(vec![media("m1", "/no/existe/viaje.mp4", 10.0, 1920, 1080, 30, true)], vec![clip("c1", 0.0, 2.0)]);
        p.name = "Viaje: día 1".into();
        let j = job(p.clone());
        assert_eq!(default_output(&j).unwrap(), PathBuf::from("/no/existe/Viaje_ día 1_snip.mp4"));
        let mut j = job(p);
        j.label = Some("Gol".into());
        j.settings = Some(ExportSettings { format: OutputFormat::Gif, ..Default::default() });
        assert_eq!(default_output(&j).unwrap(), PathBuf::from("/no/existe/Viaje_ día 1_snip - Gol.gif"));
        j.output = Some("/x/final".into());
        assert_eq!(resolve_output(&j).unwrap(), PathBuf::from("/x/final.gif"));
    }

    #[test]
    fn job_json_from_frontend() {
        let p = sample_project();
        let v = serde_json::json!({ "project": p, "window": {"start": 1.0, "end": 2.0}, "label": "A" });
        let j: ExportJob = serde_json::from_value(v).unwrap();
        assert!(j.save_project);
        assert_eq!(j.window(), Some((1.0, 2.0)));
        assert_eq!(j.settings(), &j.project.export);
    }

    #[test]
    fn heavy_clips_only_inside_the_window() {
        let mut p = project_with(vec![media("m1", "/a.mp4", 60.0, 1920, 1080, 30, true)], vec![clip("a", 0.0, 4.0), clip("b", 4.0, 8.0)]);
        p.clips[1].reverse = true;
        assert_eq!(heavy_clips(&p, None), vec![1]);
        assert!(heavy_clips(&p, Some((0.0, 3.0))).is_empty());
    }

    #[test]
    fn missing_media_is_reported_before_doing_anything() {
        let p = project_with(vec![media("m1", "/definitivamente/no/esta.mp4", 10.0, 1920, 1080, 30, true)], vec![clip("c", 0.0, 1.0)]);
        let tools = Tools { ffmpeg: "/x".into(), ffprobe: "/x".into() };
        let env = ExportEnv { tools: &tools, encoder: Encoder::Libx264, heavy_dir: Path::new("/tmp"), temp_dir: Path::new("/tmp") };
        let e = export_project(&env, &job(p), &JobControl::new(), |_| {}, |_| {}).unwrap_err();
        assert_eq!(e.kind, ErrorKind::MediaMissing);
        assert!(e.message.contains("esta.mp4"));
    }
}
