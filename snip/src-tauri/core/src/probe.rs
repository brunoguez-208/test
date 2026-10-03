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
    /// Cantidad de pistas de audio (ShadowPlay graba 2: juego y micrófono).
    #[serde(default)]
    pub audio_tracks: u32,
    /// Video HDR (PQ o HLG): se lleva a SDR antes de codificar.
    #[serde(default)]
    pub hdr: bool,
    #[serde(default)]
    pub color_transfer: Option<String>,
    /// Bits por componente (8, 10, 12).
    #[serde(default = "eight")]
    pub bit_depth: u32,
    /// Cuadros por segundo variables (avg y r_frame_rate no coinciden).
    #[serde(default)]
    pub vfr: bool,
}

fn eight() -> u32 {
    8
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
    color_transfer: Option<String>,
    bits_per_raw_sample: Option<String>,
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

/// Frecuencias habituales: las grabaciones VFR (ShadowPlay, OBS, celulares)
/// reportan promedios raros como 1300000/21667 o 90000/1; se llevan a la más
/// cercana para que el lienzo y los encoders por hardware reciban algo normal.
const STANDARD_FPS: [(u32, u32); 18] = [
    (24000, 1001),
    (24, 1),
    (25, 1),
    (30000, 1001),
    (30, 1),
    (48, 1),
    (50, 1),
    (60000, 1001),
    (60, 1),
    (72, 1),
    (90, 1),
    (100, 1),
    (120000, 1001),
    (120, 1),
    (144, 1),
    (165, 1),
    (200, 1),
    (240, 1),
];

/// Máximo de fps de salida: más que esto no tiene sentido y rompe NVENC.
pub const MAX_FPS: u32 = 240;

/// Normaliza unos fps a una fracción "razonable": la estándar más cercana
/// (±1,5 %), si no un entero (tope 240). Fracciones inválidas → 30.
pub fn standard_fps(num: u32, den: u32) -> (u32, u32) {
    if num == 0 || den == 0 {
        return (30, 1);
    }
    let f = num as f64 / den as f64;
    if !f.is_finite() || f < 1.0 {
        return (30, 1);
    }
    if f > MAX_FPS as f64 * 1.015 {
        return (MAX_FPS, 1);
    }
    let best = STANDARD_FPS
        .iter()
        .map(|&(n, d)| ((n, d), ((n as f64 / d as f64) - f).abs() / f))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap();
    if best.1 <= 0.015 {
        return best.0;
    }
    if den == 1 && num <= MAX_FPS {
        return (num, 1);
    }
    ((f.round() as u32).clamp(1, MAX_FPS), 1)
}

fn bit_depth(s: &StreamJson) -> u32 {
    if let Some(b) = parse_u64(&s.bits_per_raw_sample).filter(|b| (8..=16).contains(b)) {
        return b as u32;
    }
    let pf = s.pix_fmt.as_deref().unwrap_or("");
    for (tag, bits) in [("p16", 16), ("p14", 14), ("p12", 12), ("p010", 10), ("p10", 10), ("10le", 10), ("10be", 10), ("12le", 12)] {
        if pf.contains(tag) {
            return bits;
        }
    }
    8
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

    // avg_frame_rate es el real en VFR; r_frame_rate puede ser la base de
    // tiempo (90000/1). Si falta, cuadros / duración; recién después r.
    let avg = video.avg_frame_rate.as_deref().and_then(parse_rate).filter(|r| sane_fps(*r));
    let real = video.r_frame_rate.as_deref().and_then(parse_rate).filter(|r| sane_fps(*r));
    let counted = parse_u64(&video.nb_frames)
        .filter(|n| *n > 1)
        .and_then(|n| parse_rate(&format!("{:.3}", n as f64 / duration)))
        .filter(|r| sane_fps(*r));
    let as_f = |r: (u32, u32)| r.0 as f64 / r.1 as f64;
    // VFR con cuadros salteados (ShadowPlay baja a 58,7 de promedio grabando a
    // 60): si la nominal es razonable y apenas mayor, se usa la nominal.
    let nominal = match (avg, real) {
        (Some(a), Some(r)) if as_f(r) >= as_f(a) && as_f(r) <= as_f(a) * 1.1 && as_f(r) <= MAX_FPS as f64 => Some(r),
        _ => None,
    };
    let raw = nominal.or(avg).or(counted).or(real).unwrap_or((30, 1));
    let (fps_num, fps_den) = standard_fps(raw.0, raw.1);
    let fps = fps_num as f64 / fps_den as f64;
    let vfr = match (avg, video.r_frame_rate.as_deref().and_then(parse_rate)) {
        (Some(a), Some(r)) => ((a.0 as f64 / a.1 as f64) - (r.0 as f64 / r.1 as f64)).abs() > 0.01 * fps,
        _ => false,
    };
    let audio_tracks = probe.streams.iter().filter(|s| s.codec_type.as_deref() == Some("audio")).count() as u32;
    let hdr = matches!(video.color_transfer.as_deref(), Some("smpte2084" | "arib-std-b67"));

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
        audio_tracks,
        hdr,
        color_transfer: video.color_transfer.clone(),
        bit_depth: bit_depth(video),
        vfr,
    })
}

/// Metadatos de un archivo de audio (música).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub duration: f64,
    pub codec: String,
    pub size_bytes: Option<u64>,
}

pub fn parse_audio_probe(json: &str) -> Result<AudioInfo, AppError> {
    let probe: ProbeJson = serde_json::from_str(json).map_err(|e| AppError::with_detail(ErrorKind::Corrupt, e.to_string()))?;
    let format = probe.format.unwrap_or_default();
    let audio = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"))
        .ok_or_else(|| AppError::with_message(ErrorKind::NoAudio, "Ese archivo no tiene audio."))?;
    let duration = parse_f64(&format.duration)
        .or_else(|| parse_f64(&audio.duration))
        .filter(|d| *d > 0.0)
        .ok_or_else(|| AppError::with_detail(ErrorKind::Corrupt, "duración desconocida"))?;
    Ok(AudioInfo {
        duration,
        codec: audio.codec_name.clone().unwrap_or_else(|| "desconocido".into()),
        size_bytes: parse_u64(&format.size),
    })
}

/// Tamaño de una imagen (logo, marca de agua, PiP).
pub fn parse_image_probe(json: &str) -> Result<(u32, u32), AppError> {
    let probe: ProbeJson = serde_json::from_str(json).map_err(|e| AppError::with_detail(ErrorKind::Corrupt, e.to_string()))?;
    let v = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .ok_or_else(|| AppError::new(ErrorKind::Corrupt))?;
    match (v.width, v.height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Ok((w, h)),
        _ => Err(AppError::new(ErrorKind::Corrupt)),
    }
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

    /// Grabación de ShadowPlay / Instant Replay: HEVC 10 bits HDR, VFR con
    /// r_frame_rate = base de tiempo (90000/1) y dos pistas de audio.
    const SHADOWPLAY: &str = r#"{
      "streams": [
        {"index":0,"codec_name":"hevc","codec_type":"video","width":3840,"height":2160,
         "pix_fmt":"yuv420p10le","color_transfer":"smpte2084","r_frame_rate":"90000/1",
         "avg_frame_rate":"7650000/63751","duration":"20.0","nb_frames":"2399"},
        {"index":1,"codec_name":"aac","codec_type":"audio"},
        {"index":2,"codec_name":"aac","codec_type":"audio"}
      ],
      "format": {"duration":"20.000000","size":"300000000"}
    }"#;

    #[test]
    fn shadowplay_vfr_hdr_two_tracks() {
        let m = parse_probe(SHADOWPLAY, "C:\\Videos\\Desktop 2026.10.03 - 04.28.16.07.mp4").unwrap();
        assert_eq!((m.fps_num, m.fps_den), (120, 1), "120,0 promedio");
        assert!(m.vfr);
        assert!(m.hdr);
        assert_eq!(m.bit_depth, 10);
        assert_eq!(m.audio_tracks, 2);
    }

    #[test]
    fn timebase_only_rate_uses_frame_count() {
        // Sin avg_frame_rate y r = 90000/1 (descartado): cuadros / duración.
        let j = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
          "r_frame_rate":"90000/1","avg_frame_rate":"0/0","nb_frames":"1440"}],"format":{"duration":"24.0"}}"#;
        let m = parse_probe(j, "x.mp4").unwrap();
        assert_eq!((m.fps_num, m.fps_den), (60, 1));
        // Ni siquiera cuadros: 30.
        let j = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
          "r_frame_rate":"90000/1"}],"format":{"duration":"24.0"}}"#;
        assert_eq!(parse_probe(j, "x.mp4").unwrap().fps_num, 30);
    }

    #[test]
    fn standard_fps_snaps_odd_rates() {
        assert_eq!(standard_fps(1300000, 21667), (60, 1));
        assert_eq!(standard_fps(30000, 1001), (30000, 1001));
        assert_eq!(standard_fps(2997, 100), (30000, 1001));
        assert_eq!(standard_fps(143_900, 1000), (144, 1));
        assert_eq!(standard_fps(90000, 1), (240, 1));
        assert_eq!(standard_fps(37, 1), (37, 1));
        assert_eq!(standard_fps(3733, 100), (37, 1));
        assert_eq!(standard_fps(0, 0), (30, 1));
        assert_eq!(standard_fps(1, 2), (30, 1));
    }

    #[test]
    fn parses_rotated_hevc_with_audio() {
        let m = parse_probe(PHONE_HEVC, "C:\\v\\x.mp4").unwrap();
        assert_eq!(m.video_codec, "hevc");
        assert!(m.is_hevc());
        assert_eq!(m.rotation, 270);
        assert_eq!((m.width, m.height), (1080, 1920));
        assert_eq!((m.coded_width, m.coded_height), (1920, 1080));
        // 59,97 promedio de un celular → 60 estándar.
        assert_eq!((m.fps_num, m.fps_den), (60, 1));
        assert_eq!(m.bit_depth, 10);
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
    fn parses_audio_and_images() {
        let a = parse_audio_probe(r#"{"streams":[{"codec_type":"audio","codec_name":"mp3"}],"format":{"duration":"183.2","size":"4000000"}}"#).unwrap();
        assert_eq!(a.codec, "mp3");
        assert!((a.duration - 183.2).abs() < 1e-9);
        assert_eq!(parse_audio_probe(r#"{"streams":[],"format":{"duration":"3"}}"#).unwrap_err().kind, ErrorKind::NoAudio);
        let i = parse_image_probe(r#"{"streams":[{"codec_type":"video","codec_name":"png","width":512,"height":256}],"format":{}}"#).unwrap();
        assert_eq!(i, (512, 256));
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
