//! Filtros de efectos por clip y superposiciones.
//!
//! Cada función devuelve filtros con solo números (nunca texto del usuario).

use crate::error::AppError;
use crate::graph::{Graph, Inputs};
use crate::project::*;

/// Normalización lineal con las medidas de la primera pasada (equivale a una
/// ganancia fija, igual que la que aplica el preview).
pub fn loudnorm_linear(l: &Loudness) -> String {
    format!(
        "loudnorm=I={}:TP={}:LRA={}:measured_I={}:measured_TP={}:measured_LRA={}:measured_thresh={}:offset={}:linear=true:print_format=none",
        fmt(LOUDNORM_I),
        fmt(LOUDNORM_TP),
        fmt(LOUDNORM_LRA),
        fmt(l.input_i),
        fmt(l.input_tp),
        fmt(l.input_lra),
        fmt(l.input_thresh),
        fmt(l.target_offset)
    )
}

/// Número corto: sin ceros de más ("-14", "0.25").
pub fn fmt(v: f64) -> String {
    let t = format!("{:.4}", if v.abs() < 5e-5 { 0.0 } else { v });
    t.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Ganancia (dB) que aplica loudnorm en modo lineal: target - medido.
pub fn loudnorm_gain_db(l: &Loudness) -> f64 {
    LOUDNORM_I - l.input_i
}

/// Efectos de imagen del clip, antes de llevarlo al lienzo (crop, rotar, color…).
pub fn clip_video_effects(_v: &ClipVideo, _media: &MediaRef) -> Vec<String> {
    vec![]
}

/// Zoom y paneo animado sobre el clip ya llevado al lienzo.
pub fn zoom_filters(_keys: &[ZoomKey], _canvas: &Canvas) -> Vec<String> {
    vec![]
}

/// Superposiciones sobre la secuencia: devuelve la etiqueta del resultado.
pub fn apply_overlays(
    _g: &mut Graph,
    _inputs: &mut Inputs,
    _p: &Project,
    _raster: Option<&crate::compile::RasterInputs>,
    video: &str,
    _base: f64,
    _seq_dur: f64,
) -> Result<String, AppError> {
    Ok(video.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loudnorm_uses_measured_values_and_linear_mode() {
        let l = Loudness { input_i: -23.5, input_tp: -5.25, input_lra: 7.0, input_thresh: -34.0, target_offset: -0.1 };
        let f = loudnorm_linear(&l);
        assert_eq!(
            f,
            "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23.5:measured_TP=-5.25:measured_LRA=7:measured_thresh=-34:offset=-0.1:linear=true:print_format=none"
        );
        assert!((loudnorm_gain_db(&l) - 9.5).abs() < 1e-9);
        assert_eq!(fmt(0.00001), "0");
    }
}
