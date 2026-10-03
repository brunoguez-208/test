//! Construcción de los argumentos de FFmpeg para exportar.
//!
//! El frontend manda una intención tipada (`ExportRequest`); acá se valida y se
//! traduce a argumentos. Nadie fuera de este módulo arma líneas de comando.

use crate::encoder::Encoder;
use crate::error::{AppError, ErrorKind};
use crate::probe::MediaInfo;
use crate::scale::{plan_scale, Dims, ResolutionChoice, ScalePlan};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportMode {
    /// Sin recodificar (`-c copy`): instantáneo y sin pérdida, corta en keyframe.
    Fast,
    /// Recodifica a H.264: corte exacto y permite cambiar resolución/fps.
    Precise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FpsChoice {
    Original,
    Fps120,
    Fps60,
    Fps30,
    Fps24,
}

impl FpsChoice {
    pub fn value(self) -> Option<u32> {
        match self {
            FpsChoice::Original => None,
            FpsChoice::Fps120 => Some(120),
            FpsChoice::Fps60 => Some(60),
            FpsChoice::Fps30 => Some(30),
            FpsChoice::Fps24 => Some(24),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub input: String,
    /// Ruta elegida con "Guardar como…". None = junto al original con nombre libre.
    #[serde(default)]
    pub output: Option<String>,
    pub start: f64,
    pub end: f64,
    pub mode: ExportMode,
    pub resolution: ResolutionChoice,
    pub fps: FpsChoice,
    #[serde(default)]
    pub frame_exact: bool,
    #[serde(default)]
    pub allow_upscale: bool,
    #[serde(default)]
    pub allow_fps_increase: bool,
}

impl ExportRequest {
    /// El modo que de verdad se usa: cambiar resolución o fps, o pedir corte
    /// exacto, obliga a recodificar.
    pub fn effective_mode(&self) -> ExportMode {
        if self.mode == ExportMode::Precise
            || self.frame_exact
            || self.resolution != ResolutionChoice::Original
            || self.fps != FpsChoice::Original
        {
            ExportMode::Precise
        } else {
            ExportMode::Fast
        }
    }
}

/// Plan listo para ejecutar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    pub mode: ExportMode,
    pub encoder: Option<Encoder>,
    pub start: f64,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub audio: AudioPlan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioPlan {
    None,
    Copy,
    Aac320,
}

/// Subir los fps solo duplica cuadros; tolerancia del 1% para 29.97→30, 59.94→60.
pub fn is_fps_increase(target: f64, source: f64) -> bool {
    target > source * 1.01
}

/// Codecs de audio que pueden ir tal cual dentro de un MP4.
pub fn audio_copyable(codec: &str) -> bool {
    matches!(codec, "aac" | "mp3" | "ac3" | "eac3" | "alac" | "opus" | "flac")
}

fn ts(t: f64) -> String {
    format!("{:.6}", t.max(0.0))
}

fn s(v: &str) -> String {
    v.to_string()
}

/// Valida el pedido contra los metadatos y calcula el plan.
pub fn plan(req: &ExportRequest, info: &MediaInfo, encoder: Encoder) -> Result<ExportPlan, AppError> {
    let one_frame = 1.0 / info.fps.max(1.0);
    if !(req.start.is_finite() && req.end.is_finite()) || req.start < 0.0 {
        return Err(AppError::new(ErrorKind::InvalidRange));
    }
    let end = req.end.min(info.duration);
    let start = req.start.min(info.duration);
    if end - start < one_frame * 0.5 {
        return Err(AppError::with_message(ErrorKind::InvalidRange, "El recorte tiene que durar al menos un cuadro."));
    }
    let duration = end - start;

    let mode = req.effective_mode();
    let src = Dims::new(info.width, info.height);

    let (scale, out_fps) = match mode {
        ExportMode::Fast => (
            ScalePlan { width: info.width, height: info.height, needs_scale: false, upscale: false },
            info.fps,
        ),
        ExportMode::Precise => {
            let scale = plan_scale(src, req.resolution);
            if scale.upscale && !req.allow_upscale {
                return Err(AppError::new(ErrorKind::UpscaleNotConfirmed));
            }
            let out_fps = match req.fps.value() {
                Some(f) => {
                    if is_fps_increase(f as f64, info.fps) && !req.allow_fps_increase {
                        return Err(AppError::new(ErrorKind::FpsIncreaseNotConfirmed));
                    }
                    f as f64
                }
                None => info.fps,
            };
            (scale, out_fps)
        }
    };

    let audio = match (&info.audio_codec, info.has_audio, mode) {
        (_, false, _) => AudioPlan::None,
        (_, true, ExportMode::Fast) => AudioPlan::Copy,
        (Some(c), true, ExportMode::Precise) if audio_copyable(c) => AudioPlan::Copy,
        _ => AudioPlan::Aac320,
    };

    Ok(ExportPlan {
        mode,
        encoder: (mode == ExportMode::Precise).then_some(encoder),
        start,
        duration,
        width: scale.width,
        height: scale.height,
        fps: out_fps,
        audio,
    })
}

/// Filtros de video para el modo preciso, en orden: fps → scale → format.
pub fn video_filters(req: &ExportRequest, info: &MediaInfo, plan: &ExportPlan) -> String {
    let mut f: Vec<String> = Vec::new();
    if let Some(fps) = req.fps.value() {
        if (fps as f64 - info.fps).abs() > 0.01 {
            f.push(format!("fps={fps}"));
        }
    }
    if plan.width != info.width || plan.height != info.height {
        f.push(format!("scale={}:{}:flags=lanczos", plan.width, plan.height));
    }
    f.push(format!("format={}", plan.encoder.unwrap_or(Encoder::Libx264).pix_fmt()));
    f.join(",")
}

/// Argumentos completos de FFmpeg para la exportación.
/// `output` es el archivo (temporal) donde escribe FFmpeg; siempre se fuerza MP4.
pub fn build_args(req: &ExportRequest, info: &MediaInfo, plan: &ExportPlan, output: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec![s("-hide_banner"), s("-nostdin"), s("-loglevel"), s("error"), s("-y")];
    // -ss antes de -i: seek por input (rápido). Con -c copy cae en keyframe;
    // recodificando, FFmpeg decodifica desde el keyframe y descarta hasta el cuadro exacto.
    a.extend([s("-ss"), ts(plan.start), s("-i"), req.input.clone(), s("-t"), ts(plan.duration)]);
    a.extend([s("-map"), s("0:v:0")]);
    if plan.audio != AudioPlan::None {
        a.extend([s("-map"), s("0:a?")]);
    }

    match plan.mode {
        ExportMode::Fast => {
            a.extend([s("-c"), s("copy"), s("-avoid_negative_ts"), s("make_zero")]);
            if info.is_hevc() {
                // hvc1 es el tag que reproducen Windows, QuickTime y navegadores.
                a.extend([s("-tag:v"), s("hvc1")]);
            }
        }
        ExportMode::Precise => {
            a.extend([s("-vf"), video_filters(req, info, plan)]);
            a.extend(plan.encoder.unwrap_or(Encoder::Libx264).quality_args());
            match plan.audio {
                AudioPlan::Copy => a.extend([s("-c:a"), s("copy")]),
                AudioPlan::Aac320 => a.extend([s("-c:a"), s("aac"), s("-b:a"), s("320k")]),
                AudioPlan::None => {}
            }
        }
    }

    a.extend([
        s("-map_metadata"),
        s("0"),
        s("-movflags"),
        s("+faststart"),
        s("-progress"),
        s("pipe:1"),
        s("-stats_period"),
        s("0.25"),
        s("-nostats"),
        s("-f"),
        s("mp4"),
        output.to_string_lossy().into_owned(),
    ]);
    a
}

/// Argumentos para generar el proxy de preview 720p (cuando WebView2 no puede
/// reproducir el original, típicamente HEVC). Mantiene los tiempos del original.
pub fn proxy_args(input: &str, output: &Path, encoder: Encoder) -> Vec<String> {
    let mut a: Vec<String> = vec![s("-hide_banner"), s("-nostdin"), s("-loglevel"), s("error"), s("-y"), s("-i"), s(input)];
    a.extend([s("-map"), s("0:v:0"), s("-map"), s("0:a:0?")]);
    a.extend([
        s("-vf"),
        format!(
            "scale=w='if(gte(iw,ih),-2,min(720,iw))':h='if(gte(iw,ih),min(720,ih),-2)':flags=bilinear,format={}",
            encoder.pix_fmt()
        ),
    ]);
    a.extend(encoder.proxy_args());
    a.extend([s("-g"), s("15"), s("-c:a"), s("aac"), s("-b:a"), s("160k"), s("-ac"), s("2")]);
    a.extend([
        s("-movflags"),
        s("+faststart"),
        s("-progress"),
        s("pipe:1"),
        s("-stats_period"),
        s("0.5"),
        s("-nostats"),
        s("-f"),
        s("mp4"),
        output.to_string_lossy().into_owned(),
    ]);
    a
}

/// Argumentos para una miniatura en el segundo `t`, como JPEG por stdout.
pub fn thumbnail_args(input: &str, t: f64, height: u32) -> Vec<String> {
    vec![
        s("-hide_banner"),
        s("-nostdin"),
        s("-loglevel"),
        s("error"),
        s("-ss"),
        ts(t),
        s("-i"),
        s(input),
        s("-frames:v"),
        s("1"),
        s("-an"),
        s("-sn"),
        s("-dn"),
        s("-vf"),
        format!("scale=-2:{}:flags=bilinear", height.max(16)),
        s("-q:v"),
        s("5"),
        s("-f"),
        s("image2pipe"),
        s("-c:v"),
        s("mjpeg"),
        s("pipe:1"),
    ]
}

/// Tiempos centrados de `count` miniaturas a lo largo del video.
pub fn thumbnail_times(duration: f64, count: usize) -> Vec<f64> {
    if count == 0 || duration <= 0.0 {
        return vec![];
    }
    let step = duration / count as f64;
    (0..count).map(|i| ((i as f64 + 0.5) * step).min((duration - 0.05).max(0.0))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn info(codec: &str, w: u32, h: u32, fps: f64, audio: Option<&str>) -> MediaInfo {
        MediaInfo {
            path: "C:\\v\\in.mp4".into(),
            duration: 60.0,
            width: w,
            height: h,
            coded_width: w,
            coded_height: h,
            rotation: 0,
            fps,
            fps_num: fps.round() as u32,
            fps_den: 1,
            frame_count: (60.0 * fps) as u64,
            video_codec: codec.into(),
            pix_fmt: Some("yuv420p".into()),
            has_audio: audio.is_some(),
            audio_codec: audio.map(Into::into),
            size_bytes: None,
            bit_rate: None,
        }
    }

    fn req() -> ExportRequest {
        ExportRequest {
            input: "C:\\v\\in.mp4".into(),
            output: None,
            start: 10.0,
            end: 25.5,
            mode: ExportMode::Fast,
            resolution: ResolutionChoice::Original,
            fps: FpsChoice::Original,
            frame_exact: false,
            allow_upscale: false,
            allow_fps_increase: false,
        }
    }

    fn args(r: &ExportRequest, i: &MediaInfo, e: Encoder) -> String {
        let p = plan(r, i, e).unwrap();
        build_args(r, i, &p, &PathBuf::from("out.mp4.snip-part")).join(" ")
    }

    #[test]
    fn fast_mode_is_stream_copy_with_input_seek_and_duration() {
        let i = info("h264", 1920, 1080, 60.0, Some("aac"));
        let a = args(&req(), &i, Encoder::Nvenc);
        assert!(a.contains("-ss 10.000000 -i C:\\v\\in.mp4 -t 15.500000"), "{a}");
        assert!(!a.contains("-to "));
        assert!(a.contains("-c copy -avoid_negative_ts make_zero"));
        assert!(a.contains("-movflags +faststart"));
        assert!(a.contains("-progress pipe:1"));
        assert!(a.contains("-map 0:v:0 -map 0:a?"));
        assert!(!a.contains("-c:v"));
        assert!(!a.contains("hvc1"));
        assert!(a.ends_with("-f mp4 out.mp4.snip-part"));
        let p = plan(&req(), &i, Encoder::Nvenc).unwrap();
        assert_eq!(p.mode, ExportMode::Fast);
        assert_eq!(p.encoder, None);
    }

    #[test]
    fn fast_mode_keeps_hevc_with_hvc1_tag() {
        let i = info("hevc", 3840, 2160, 30.0, Some("aac"));
        let a = args(&req(), &i, Encoder::Libx264);
        assert!(a.contains("-c copy"));
        assert!(a.contains("-tag:v hvc1"));
    }

    #[test]
    fn changing_resolution_fps_or_frame_exact_forces_precise() {
        let mut r = req();
        assert_eq!(r.effective_mode(), ExportMode::Fast);
        r.frame_exact = true;
        assert_eq!(r.effective_mode(), ExportMode::Precise);
        let mut r = req();
        r.resolution = ResolutionChoice::P720;
        assert_eq!(r.effective_mode(), ExportMode::Precise);
        let mut r = req();
        r.fps = FpsChoice::Fps30;
        assert_eq!(r.effective_mode(), ExportMode::Precise);
    }

    #[test]
    fn precise_args_per_encoder() {
        let i = info("hevc", 1920, 1080, 60.0, Some("aac"));
        let mut r = req();
        r.mode = ExportMode::Precise;
        let a = args(&r, &i, Encoder::Nvenc);
        assert!(a.contains("-c:v h264_nvenc -preset p7 -tune hq -rc vbr -cq 18 -b:v 0"), "{a}");
        assert!(a.contains("-vf format=yuv420p"));
        assert!(a.contains("-c:a copy"));
        assert!(!a.contains("-c copy"));
        assert!(!a.contains("hvc1"));
        assert!(a.contains("-movflags +faststart"));

        let a = args(&r, &i, Encoder::Libx264);
        assert!(a.contains("-c:v libx264 -crf 17 -preset slow"));
        let a = args(&r, &i, Encoder::Qsv);
        assert!(a.contains("-c:v h264_qsv"));
        assert!(a.contains("format=nv12"));
        let a = args(&r, &i, Encoder::Amf);
        assert!(a.contains("-c:v h264_amf -usage transcoding -quality quality"));
    }

    #[test]
    fn precise_always_encodes_h264_even_from_hevc() {
        let i = info("hevc", 1920, 1080, 30.0, None);
        let mut r = req();
        r.frame_exact = true;
        for e in crate::encoder::PREFERENCE {
            let a = args(&r, &i, e);
            assert!(a.contains(&format!("-c:v {}", e.ffmpeg_name())));
            assert!(a.contains("h264") || a.contains("libx264"));
            assert!(!a.contains("hevc_") && !a.contains("libx265"));
            assert!(!a.contains("-map 0:a?"), "sin audio no se mapea audio");
            assert!(!a.contains("-c:a"));
        }
    }

    #[test]
    fn resolution_and_fps_filters() {
        let i = info("h264", 3840, 2160, 60.0, Some("aac"));
        let mut r = req();
        r.resolution = ResolutionChoice::P1080;
        r.fps = FpsChoice::Fps30;
        let a = args(&r, &i, Encoder::Libx264);
        assert!(a.contains("-vf fps=30,scale=1920:1080:flags=lanczos,format=yuv420p"), "{a}");
        let p = plan(&r, &i, Encoder::Libx264).unwrap();
        assert_eq!((p.width, p.height, p.fps), (1920, 1080, 30.0));

        // fps igual al original: sin filtro fps.
        let mut r = req();
        r.fps = FpsChoice::Fps60;
        let a = args(&r, &i, Encoder::Libx264);
        assert!(a.contains("-vf format=yuv420p"), "{a}");
    }

    #[test]
    fn upscale_and_fps_increase_need_confirmation() {
        let i = info("h264", 1280, 720, 30.0, None);
        let mut r = req();
        r.resolution = ResolutionChoice::P1080;
        assert_eq!(plan(&r, &i, Encoder::Libx264).unwrap_err().kind, ErrorKind::UpscaleNotConfirmed);
        r.allow_upscale = true;
        assert_eq!(plan(&r, &i, Encoder::Libx264).unwrap().width, 1920);

        let mut r = req();
        r.fps = FpsChoice::Fps60;
        assert_eq!(plan(&r, &i, Encoder::Libx264).unwrap_err().kind, ErrorKind::FpsIncreaseNotConfirmed);
        r.allow_fps_increase = true;
        let p = plan(&r, &i, Encoder::Libx264).unwrap();
        assert_eq!(p.fps, 60.0);
        let a = build_args(&r, &i, &p, Path::new("o")).join(" ");
        assert!(a.contains("fps=60"));
    }

    #[test]
    fn ntsc_rates_are_not_an_increase() {
        assert!(!is_fps_increase(30.0, 29.97));
        assert!(!is_fps_increase(60.0, 59.94));
        assert!(is_fps_increase(60.0, 30.0));
        let i = info("h264", 1920, 1080, 29.97, None);
        let mut r = req();
        r.fps = FpsChoice::Fps30;
        let p = plan(&r, &i, Encoder::Libx264).unwrap();
        assert_eq!(p.fps, 30.0);
    }

    #[test]
    fn non_mp4_friendly_audio_is_reencoded_to_aac_320k() {
        let i = info("h264", 1920, 1080, 30.0, Some("pcm_s16le"));
        let mut r = req();
        r.frame_exact = true;
        let a = args(&r, &i, Encoder::Libx264);
        assert!(a.contains("-c:a aac -b:a 320k"));
    }

    #[test]
    fn range_validation_and_clamping() {
        let i = info("h264", 1920, 1080, 30.0, None);
        let mut r = req();
        r.start = 30.0;
        r.end = 30.0;
        assert_eq!(plan(&r, &i, Encoder::Libx264).unwrap_err().kind, ErrorKind::InvalidRange);
        r.start = -1.0;
        r.end = 5.0;
        assert_eq!(plan(&r, &i, Encoder::Libx264).unwrap_err().kind, ErrorKind::InvalidRange);
        r.start = 50.0;
        r.end = 999.0;
        let p = plan(&r, &i, Encoder::Libx264).unwrap();
        assert!((p.duration - 10.0).abs() < 1e-9);
    }

    #[test]
    fn proxy_and_thumbnail_args() {
        let a = proxy_args("in.mp4", Path::new("p.mp4"), Encoder::Libx264).join(" ");
        assert!(a.contains("-c:v libx264 -preset ultrafast"));
        assert!(a.contains("min(720,ih)"));
        assert!(a.contains("-progress pipe:1"));
        let t = thumbnail_args("in.mp4", 12.5, 90).join(" ");
        assert!(t.starts_with("-hide_banner -nostdin -loglevel error -ss 12.500000 -i in.mp4 -frames:v 1"), "{t}");
        assert!(!t.contains("fps="), "no se usa el filtro fps (decodificaría todo)");
        assert!(t.ends_with("-f image2pipe -c:v mjpeg pipe:1"));
        let times = thumbnail_times(20.0, 20);
        assert_eq!(times.len(), 20);
        assert!((times[0] - 0.5).abs() < 1e-9 && (times[19] - 19.5).abs() < 1e-9);
    }

    #[test]
    fn request_json_shape_from_frontend() {
        let j = r#"{"input":"C:\\a.mp4","start":1,"end":2,"mode":"precise",
            "resolution":{"kind":"custom","width":1280},"fps":"fps30","frameExact":true}"#;
        let r: ExportRequest = serde_json::from_str(j).unwrap();
        assert_eq!(r.resolution, ResolutionChoice::Custom { width: 1280 });
        assert_eq!(r.fps, FpsChoice::Fps30);
        assert!(r.frame_exact && !r.allow_upscale);
        assert_eq!(r.output, None);
    }
}
