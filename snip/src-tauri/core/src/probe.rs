//! Lectura de metadatos con FFprobe (JSON) y de keyframes.

use crate::error::{AppError, ErrorKind};
use serde::{Deserialize, Serialize};

/// Metadatos que la app necesita de un video.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    /// Duración en segundos.
    pub duration: f64,
    /// Dimensiones de visualización (ya con la rotación aplicada).
    pub width: u32,
    pub height: u32,
    /// Dimensiones codificadas (sin rotación).
    pub coded_width: u32,
    pub coded_height: u32,
    /// Rotación normalizada a 0, 90, 180 o 270 grados.
    pub rotation: u32,
    pub fps: f64,
    pub fps_num: u32,
    pub fps_den: u32,
    pub frame_count: u64,
    pub video_codec: String,
    pub pix_fmt: Option<String>,
    pub has_audio: bool,
    pub audio_codec: Option<String>,
    pub size_bytes: Option<u64>,
    pub bit_rate: Option<u64>,
}

impl MediaInfo {
    pub fn is_hevc(&self) -> bool {
        self.video_codec == "hevc" || self.video_codec == "h265"
    }
}

/// Argumentos de ffprobe para leer formato y streams en JSON.
pub fn probe_args(input: &str) -> Vec<String> {
    vec![
        "-v".into(),
        "error".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        input.into(),
    ]
}

/// Argumentos de ffprobe para listar los paquetes de video (sin decodificar),
/// de donde se sacan los keyframes.
pub fn keyframe_args(input: &str) -> Vec<String> {
    vec![
        "-v".into(),
        "error".into(),
        "-select_streams".into(),
        "v:0".into(),
        "-show_entries".into(),
        "packet=pts_time,flags".into(),
        "-of".into(),
        "csv=p=0".into(),
        input.into(),
    ]
}

#[derive(Deserialize)]
struct ProbeJson {
    #[serde(default)]
    streams: Vec<StreamJson>,
    format: Option<FormatJson>,
}

#[derive(Deserialize, Default)]
struct FormatJson {
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
}

#[derive(Deserialize, Default)]
struct StreamJson {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    pix_fmt: Option<String>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    duration: Option<String>,
    nb_frames: Option<String>,
    #[serde(default)]
    side_data_list: Vec<serde_json::Value>,
    #[serde(default)]
    tags: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    disposition: serde_json::Map<String, serde_json::Value>,
}

/// Parsea una fracción tipo "30000/1001". Devuelve None si es 0/0 o inválida.
pub fn parse_rate(s: &str) -> Option<(u32, u32)> {
    let (n, d) = match s.split_once('/') {
        Some((n, d)) => (n.trim().parse::<u64>().ok()?, d.trim().parse::<u64>().ok()?),
        None => {
            let f: f64 = s.trim().parse().ok()?;
            if !(f.is_finite() && f > 0.0) {
                return None;
            }
            ((f * 1000.0).round() as u64, 1000)
        }
    };
    if n == 0 || d == 0 {
        return None;
    }
    let g = gcd(n, d);
    Some(((n / g).min(u32::MAX as u64) as u32, (d / g).min(u32::MAX as u64) as u32))
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

fn sane_fps(r: (u32, u32)) -> bool {
    let f = r.0 as f64 / r.1 as f64;
    (1.0..=1000.0).contains(&f)
}

fn normalize_rotation(deg: f64) -> u32 {
    let r = (deg.round() as i64).rem_euclid(360);
    // Redondeamos a múltiplos de 90.
    (((r + 45) / 90 * 90) % 360) as u32
}

fn stream_rotation(s: &StreamJson) -> u32 {
    for sd in &s.side_data_list {
        if let Some(rot) = sd.get("rotation").and_then(|v| v.as_f64()) {
            return normalize_rotation(rot);
        }
    }
    if let Some(rot) = s.tags.get("rotate") {
        let v = rot.as_str().and_then(|x| x.parse::<f64>().ok()).or_else(|| rot.as_f64());
        if let Some(v) = v {
            return normalize_rotation(v);
        }
    }
    0
}

fn parse_f64(s: &Option<String>) -> Option<f64> {
    s.as_deref().and_then(|v| v.trim().parse::<f64>().ok()).filter(|v| v.is_finite())
}

fn parse_u64(s: &Option<String>) -> Option<u64> {
    s.as_deref().and_then(|v| v.trim().parse::<u64>().ok())
}

/// Convierte la salida JSON de ffprobe en `MediaInfo`.
pub fn parse_probe(json: &str, path: &str) -> Result<MediaInfo, AppError> {
    let probe: ProbeJson = serde_json::from_str(json)
        .map_err(|e| AppError::with_detail(ErrorKind::Corrupt, e.to_string()))?;
    let format = probe.format.unwrap_or_default();

    let is_cover = |s: &StreamJson| {
        s.disposition.get("attached_pic").and_then(|v| v.as_i64()).unwrap_or(0) == 1
    };
    let video = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video") && !is_cover(s))
        .ok_or_else(|| AppError::new(ErrorKind::NoVideo))?;
    let audio = probe.streams.iter().find(|s| s.codec_type.as_deref() == Some("audio"));

    let (coded_width, coded_height) = match (video.width, video.height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        _ => return Err(AppError::with_detail(ErrorKind::Corrupt, "video sin dimensiones")),
    };

    let duration = parse_f64(&format.duration)
        .or_else(|| parse_f64(&video.duration))
        .filter(|d| *d > 0.0)
        .ok_or_else(|| AppError::with_detail(ErrorKind::Corrupt, "duración desconocida"))?;

    let avg = video.avg_frame_rate.as_deref().and_then(parse_rate).filter(|r| sane_fps(*r));
    let real = video.r_frame_rate.as_deref().and_then(parse_rate).filter(|r| sane_fps(*r));
    let (fps_num, fps_den) = avg.or(real).unwrap_or((30, 1));
    let fps = fps_num as f64 / fps_den as f64;

    let rotation = stream_rotation(video);
    let (width, height) = if rotation % 180 == 90 {
        (coded_height, coded_width)
    } else {
        (coded_width, coded_height)
    };

    let frame_count = parse_u64(&video.nb_frames)
        .filter(|n| *n > 0)
        .unwrap_or_else(|| (duration * fps).round().max(1.0) as u64);

    Ok(MediaInfo {
        path: path.to_string(),
        duration,
        width,
        height,
        coded_width,
        coded_height,
        rotation,
        fps,
        fps_num,
        fps_den,
        frame_count,
        video_codec: video.codec_name.clone().unwrap_or_else(|| "desconocido".into()),
        pix_fmt: video.pix_fmt.clone(),
        has_audio: audio.is_some(),
        audio_codec: audio.and_then(|a| a.codec_name.clone()),
        size_bytes: parse_u64(&format.size),
        bit_rate: parse_u64(&format.bit_rate),
    })
}

/// Parsea la salida CSV de `keyframe_args` ("pts_time,flags" por línea) y
/// devuelve los tiempos de los keyframes ordenados.
pub fn parse_keyframes(csv: &str) -> Vec<f64> {
    let mut out: Vec<f64> = csv
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim().split(',');
            let t = parts.next()?.trim().parse::<f64>().ok()?;
            let flags = parts.next()?.trim();
            (flags.starts_with('K') && t.is_finite()).then_some(t)
        })
        .collect();
    out.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    out.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
    out
}

/// Dónde empieza de verdad un corte sin recodificar: en el último keyframe
/// anterior (o igual) al inicio pedido.
pub fn keyframe_at_or_before(keyframes: &[f64], t: f64) -> Option<f64> {
    keyframes.iter().copied().rev().find(|k| *k <= t + 1e-4)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHONE_HEVC: &str = r#"{
      "streams": [
        {"index":0,"codec_name":"hevc","codec_type":"video","width":1920,"height":1080,
         "pix_fmt":"yuv420p10le","r_frame_rate":"60/1","avg_frame_rate":"3600000/60029",
         "duration":"12.005000","nb_frames":"719",
         "side_data_list":[{"side_data_type":"Display Matrix","displaymatrix":"...","rotation":-90}]},
        {"index":1,"codec_name":"aac","codec_type":"audio","sample_rate":"48000"}
      ],
      "format": {"filename":"x.mp4","format_name":"mov,mp4,m4a,3gp,3g2,mj2",
                 "duration":"12.010000","size":"25000000","bit_rate":"16653000"}
    }"#;

    #[test]
    fn parses_rotated_hevc_with_audio() {
        let m = parse_probe(PHONE_HEVC, "C:\\v\\x.mp4").unwrap();
        assert_eq!(m.video_codec, "hevc");
        assert!(m.is_hevc());
        assert_eq!(m.rotation, 270);
        assert_eq!((m.width, m.height), (1080, 1920));
        assert_eq!((m.coded_width, m.coded_height), (1920, 1080));
        assert!((m.fps - 59.97).abs() < 0.01, "fps {}", m.fps);
        assert!((m.duration - 12.01).abs() < 1e-9);
        assert_eq!(m.frame_count, 719);
        assert!(m.has_audio);
        assert_eq!(m.audio_codec.as_deref(), Some("aac"));
        assert_eq!(m.size_bytes, Some(25_000_000));
    }

    #[test]
    fn falls_back_to_r_frame_rate_and_legacy_rotate_tag() {
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720,
            "r_frame_rate":"30000/1001","avg_frame_rate":"0/0","tags":{"rotate":"180"}}],
            "format":{"duration":"5.0"}}"#;
        let m = parse_probe(json, "a.mp4").unwrap();
        assert_eq!((m.fps_num, m.fps_den), (30000, 1001));
        assert_eq!(m.rotation, 180);
        assert_eq!((m.width, m.height), (1280, 720));
        assert!(!m.has_audio);
        assert_eq!(m.frame_count, 150);
    }

    #[test]
    fn ignores_cover_art_and_errors_without_video() {
        let json = r#"{"streams":[
            {"codec_type":"audio","codec_name":"aac"},
            {"codec_type":"video","codec_name":"mjpeg","width":600,"height":600,"disposition":{"attached_pic":1}}],
            "format":{"duration":"5.0"}}"#;
        assert_eq!(parse_probe(json, "a.mp4").unwrap_err().kind, ErrorKind::NoVideo);
    }

    #[test]
    fn errors_on_garbage_or_missing_duration() {
        assert_eq!(parse_probe("not json", "a").unwrap_err().kind, ErrorKind::Corrupt);
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":2,"height":2}],"format":{}}"#;
        assert_eq!(parse_probe(json, "a").unwrap_err().kind, ErrorKind::Corrupt);
    }

    #[test]
    fn parses_rates() {
        assert_eq!(parse_rate("60/1"), Some((60, 1)));
        assert_eq!(parse_rate("120000/2002"), Some((60000, 1001)));
        assert_eq!(parse_rate("0/0"), None);
        assert_eq!(parse_rate("25"), Some((25, 1)));
        assert_eq!(normalize_rotation(-90.0), 270);
        assert_eq!(normalize_rotation(90.0), 90);
        assert_eq!(normalize_rotation(-180.0), 180);
    }

    #[test]
    fn parses_keyframes_csv() {
        let csv = "0.000000,K__\n0.033333,___\n2.000000,K__\n2.033333,__\nN/A,K__\n4.000000,K_\n";
        let k = parse_keyframes(csv);
        assert_eq!(k, vec![0.0, 2.0, 4.0]);
        assert_eq!(keyframe_at_or_before(&k, 3.5), Some(2.0));
        assert_eq!(keyframe_at_or_before(&k, 2.0), Some(2.0));
        assert_eq!(keyframe_at_or_before(&k, 0.0), Some(0.0));
    }
}
