//! Tamaño objetivo (presets de Discord, WhatsApp o personalizado): cálculo del
//! bitrate de video y audio a partir de la duración.
//!
//! Se apunta al 95% del límite (configurable en `config/platform_limits.json`)
//! y se reserva un 2% para el contenedor. Después de codificar se verifica el
//! tamaño real y, si se pasó, se vuelve a codificar con menos bitrate.

use crate::error::{AppError, ErrorKind};
use crate::project::OutputFormat;
use crate::scale::ResolutionChoice;
use serde::{Deserialize, Serialize};

/// Contenido del archivo de configuración (embebido en el binario).
pub const PLATFORM_LIMITS_JSON: &str = include_str!("../config/platform_limits.json");

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPreset {
    pub id: String,
    pub group: String,
    pub label: String,
    pub tier: Option<String>,
    pub megabytes: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLimits {
    pub verified_at: String,
    pub target_ratio: f64,
    pub presets: Vec<PlatformPreset>,
}

pub fn platform_limits() -> PlatformLimits {
    serde_json::from_str(PLATFORM_LIMITS_JSON).expect("platform_limits.json válido")
}

pub const MB: f64 = 1_000_000.0;
/// Overhead del contenedor (moov, índices, etc.).
const MUX_OVERHEAD: f64 = 0.02;
/// Menos de esto por píxel y cuadro, H.264 se ve mal.
pub const LOW_BPP: f64 = 0.03;
/// Con esto ya se ve bien.
const GOOD_BPP: f64 = 0.08;
const MIN_VIDEO_KBPS: u32 = 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitratePlan {
    pub video_kbps: u32,
    pub audio_kbps: u32,
    /// La calidad quedaría muy baja con esta resolución.
    pub low_quality: bool,
    /// Resolución sugerida para que se vea mejor.
    pub suggestion: Option<ResolutionChoice>,
}

/// Bitrate de audio según el presupuesto total (kbps).
fn audio_for(total_kbps: f64) -> u32 {
    if total_kbps >= 2500.0 {
        192
    } else if total_kbps >= 1000.0 {
        160
    } else if total_kbps >= 500.0 {
        128
    } else if total_kbps >= 250.0 {
        96
    } else {
        64
    }
}

pub struct SizeInput {
    pub megabytes: f64,
    pub ratio: f64,
    pub duration: f64,
    pub has_video: bool,
    pub has_audio: bool,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub format: OutputFormat,
}

/// Bits por píxel por cuadro.
pub fn bpp(video_kbps: u32, w: u32, h: u32, fps: f64) -> f64 {
    (video_kbps as f64 * 1000.0) / (w.max(1) as f64 * h.max(1) as f64 * fps.max(1.0))
}

pub fn plan_bitrate(i: &SizeInput) -> Result<BitratePlan, AppError> {
    if i.format == OutputFormat::Gif {
        return Err(AppError::with_message(
            ErrorKind::InvalidRange,
            "Los GIF no admiten un tamaño máximo: bajá los fps o el ancho para que pesen menos.",
        ));
    }
    let positive = |x: f64| x.is_finite() && x > 0.0;
    if !positive(i.megabytes) || !positive(i.duration) {
        return Err(AppError::with_message(ErrorKind::InvalidRange, "El tamaño máximo tiene que ser mayor a 0 MB."));
    }
    let bytes = i.megabytes * MB * i.ratio.clamp(0.5, 1.0);
    let total_kbps = bytes * 8.0 * (1.0 - MUX_OVERHEAD) / i.duration / 1000.0;
    if !i.has_video {
        let a = (total_kbps.floor() as u32).min(320);
        if a < 32 {
            return Err(too_long());
        }
        return Ok(BitratePlan { video_kbps: 0, audio_kbps: a, low_quality: a < 96, suggestion: None });
    }
    let audio = if i.has_audio { audio_for(total_kbps) } else { 0 };
    let video = total_kbps - audio as f64;
    if video < MIN_VIDEO_KBPS as f64 {
        return Err(too_long());
    }
    let video = video.floor() as u32;
    let q = bpp(video, i.width, i.height, i.fps);
    let low_quality = q < LOW_BPP;
    let suggestion = if low_quality { suggest_resolution(video, i.width, i.height, i.fps) } else { None };
    Ok(BitratePlan { video_kbps: video, audio_kbps: audio, low_quality, suggestion })
}

fn too_long() -> AppError {
    AppError::with_message(
        ErrorKind::InvalidRange,
        "El video es demasiado largo para entrar en ese tamaño. Recortalo o elegí un límite más grande.",
    )
}

/// La resolución más grande (por debajo de la actual) que se vería bien con ese bitrate.
pub fn suggest_resolution(video_kbps: u32, w: u32, h: u32, fps: f64) -> Option<ResolutionChoice> {
    let short = w.min(h);
    let aspect = w.max(h) as f64 / short.max(1) as f64;
    for (side, choice) in [
        (1080, ResolutionChoice::P1080),
        (720, ResolutionChoice::P720),
        (540, ResolutionChoice::Custom { width: 0 }),
        (480, ResolutionChoice::Custom { width: 0 }),
        (360, ResolutionChoice::Custom { width: 0 }),
    ] {
        if side >= short {
            continue;
        }
        let long = (side as f64 * aspect / 2.0).round() as u32 * 2;
        let (tw, th) = if w >= h { (long, side) } else { (side, long) };
        if bpp(video_kbps, tw, th, fps) >= GOOD_BPP {
            return Some(match choice {
                ResolutionChoice::Custom { .. } => ResolutionChoice::Custom { width: tw },
                c => c,
            });
        }
    }
    Some(ResolutionChoice::Custom { width: if w >= h { (360.0 * aspect / 2.0).round() as u32 * 2 } else { 360 } })
}

/// Nuevo bitrate de video si el archivo salió más grande que el límite.
pub fn retry_bitrate(plan: &BitratePlan, actual_bytes: u64, limit_bytes: f64) -> Option<BitratePlan> {
    if (actual_bytes as f64) <= limit_bytes {
        return None;
    }
    let factor = (limit_bytes * 0.93 / actual_bytes as f64).clamp(0.3, 0.97);
    let total = (plan.video_kbps + plan.audio_kbps) as f64 * factor;
    let video = (total - plan.audio_kbps as f64).max(MIN_VIDEO_KBPS as f64 * 0.5) as u32;
    Some(BitratePlan { video_kbps: video, ..plan.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(mb: f64, dur: f64) -> SizeInput {
        SizeInput {
            megabytes: mb,
            ratio: 0.95,
            duration: dur,
            has_video: true,
            has_audio: true,
            width: 1920,
            height: 1080,
            fps: 30.0,
            format: OutputFormat::Mp4,
        }
    }

    #[test]
    fn config_file_has_the_platform_presets() {
        let l = platform_limits();
        let mb = |id: &str| l.presets.iter().find(|p| p.id == id).unwrap().megabytes;
        assert_eq!(mb("discord"), 20.0);
        assert_eq!(mb("discordBasic"), 50.0);
        assert_eq!(mb("discordNitro"), 500.0);
        assert_eq!(mb("whatsapp"), 16.0);
        assert_eq!(l.target_ratio, 0.95);
    }

    #[test]
    fn bitrate_targets_95_percent_of_the_limit() {
        let p = plan_bitrate(&input(20.0, 60.0)).unwrap();
        // 20 MB * 0.95 * 8 * 0.98 / 60 s = 2482.7 kbps en total
        assert_eq!(p.audio_kbps, 160);
        assert_eq!(p.video_kbps, 2322);
        let bytes = (p.video_kbps + p.audio_kbps) as f64 * 1000.0 / 8.0 * 60.0;
        assert!(bytes < 20.0 * MB * 0.95);
        assert!(!p.low_quality);
    }

    #[test]
    fn low_quality_suggests_a_smaller_resolution() {
        let p = plan_bitrate(&input(10.0, 300.0)).unwrap();
        assert!(p.low_quality, "{p:?}");
        let s = p.suggestion.unwrap();
        assert!(matches!(s, ResolutionChoice::Custom { .. } | ResolutionChoice::P720), "{s:?}");
    }

    #[test]
    fn impossible_targets_are_rejected() {
        assert!(plan_bitrate(&input(1.0, 3600.0)).is_err());
        let mut gif = input(10.0, 5.0);
        gif.format = OutputFormat::Gif;
        assert!(plan_bitrate(&gif).unwrap_err().message.contains("GIF"));
    }

    #[test]
    fn audio_only_mp3() {
        let mut i = input(16.0, 600.0);
        i.has_video = false;
        i.format = OutputFormat::Mp3;
        let p = plan_bitrate(&i).unwrap();
        assert_eq!(p.video_kbps, 0);
        assert_eq!(p.audio_kbps, 198);
        let mut i = input(16.0, 60.0);
        i.has_video = false;
        assert_eq!(plan_bitrate(&i).unwrap().audio_kbps, 320);
    }

    #[test]
    fn retry_lowers_bitrate_only_when_over() {
        let p = BitratePlan { video_kbps: 2000, audio_kbps: 128, low_quality: false, suggestion: None };
        assert!(retry_bitrate(&p, 9_000_000, 10_000_000.0).is_none());
        let r = retry_bitrate(&p, 11_000_000, 10_000_000.0).unwrap();
        assert!(r.video_kbps < 2000 && r.video_kbps > 1500, "{r:?}");
    }
}
