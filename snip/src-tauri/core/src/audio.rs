//! Análisis de audio: loudness (para normalizar) y forma de onda (para el timeline).

use crate::compile::num;
use crate::error::{AppError, ErrorKind};
use crate::graph::s;
use crate::project::{Loudness, LOUDNORM_I, LOUDNORM_LRA, LOUDNORM_TP};
use crate::runner::{self, Tools};
use serde::Deserialize;
use std::path::Path;

/// Primera pasada de loudnorm sobre un tramo (imprime las medidas en JSON por stderr).
pub fn loudness_args(path: &str, start: f64, len: f64) -> Vec<String> {
    vec![
        s("-hide_banner"),
        s("-nostdin"),
        s("-ss"),
        num(start),
        s("-t"),
        num(len),
        s("-i"),
        s(path),
        s("-vn"),
        s("-af"),
        format!("loudnorm=I={LOUDNORM_I}:TP={LOUDNORM_TP}:LRA={LOUDNORM_LRA}:print_format=json"),
        s("-f"),
        s("null"),
        s("-"),
    ]
}

#[derive(Deserialize)]
struct LoudJson {
    input_i: String,
    input_tp: String,
    input_lra: String,
    input_thresh: String,
    target_offset: String,
}

/// Saca el bloque JSON del final del stderr de loudnorm.
pub fn parse_loudness(stderr: &str) -> Result<Loudness, AppError> {
    let start = stderr.rfind('{').ok_or_else(|| AppError::with_detail(ErrorKind::Unknown, "loudnorm sin JSON"))?;
    let end = stderr[start..].find('}').map(|e| start + e + 1).ok_or_else(|| AppError::new(ErrorKind::Unknown))?;
    let j: LoudJson = serde_json::from_str(&stderr[start..end]).map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
    let f = |v: &str| -> f64 {
        let x = v.trim().parse::<f64>().unwrap_or(f64::NEG_INFINITY);
        if x.is_finite() {
            x
        } else {
            -70.0
        }
    };
    let l = Loudness {
        input_i: f(&j.input_i),
        input_tp: f(&j.input_tp),
        input_lra: f(&j.input_lra).max(0.0),
        input_thresh: f(&j.input_thresh),
        target_offset: f(&j.target_offset).clamp(-99.0, 99.0),
    };
    if l.input_i <= -69.0 {
        return Err(AppError::with_message(ErrorKind::NoAudio, "Este clip está en silencio: no hay nada que normalizar."));
    }
    Ok(l)
}

pub fn analyze_loudness(tools: &Tools, path: &Path, start: f64, len: f64) -> Result<Loudness, AppError> {
    let args = loudness_args(&path.to_string_lossy(), start, len);
    let out = runner::command(&tools.ffmpeg)
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| AppError::from_io(&e))?;
    let err = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        return Err(AppError::with_detail(crate::error::classify_ffmpeg_stderr(&err), err));
    }
    parse_loudness(&err)
}

/// Picos por segundo de la forma de onda.
pub const PEAKS_PER_SECOND: u32 = 100;
const WAVE_RATE: u32 = 8000;

pub fn waveform_args(path: &str) -> Vec<String> {
    vec![
        s("-hide_banner"),
        s("-nostdin"),
        s("-loglevel"),
        s("error"),
        s("-i"),
        s(path),
        s("-vn"),
        s("-map"),
        s("0:a:0"),
        s("-ac"),
        s("1"),
        s("-ar"),
        WAVE_RATE.to_string(),
        s("-f"),
        s("s16le"),
        s("-"),
    ]
}

/// PCM s16le mono → un pico (0..255, escala raíz para que se vea lo bajo) cada 10 ms.
pub fn peaks_from_pcm(pcm: &[u8]) -> Vec<u8> {
    let per = (WAVE_RATE / PEAKS_PER_SECOND) as usize;
    pcm.chunks(per * 2)
        .map(|chunk| {
            let mut m = 0i32;
            for b in chunk.chunks_exact(2) {
                let v = i16::from_le_bytes([b[0], b[1]]) as i32;
                m = m.max(v.abs());
            }
            let x = (m as f64 / 32768.0).min(1.0).sqrt();
            (x * 255.0).round() as u8
        })
        .collect()
}

pub fn waveform(tools: &Tools, path: &Path) -> Result<Vec<u8>, AppError> {
    let pcm = runner::run_capture(&tools.ffmpeg, &waveform_args(&path.to_string_lossy()))?;
    Ok(peaks_from_pcm(&pcm))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_loudnorm_json() {
        let err = r#"[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-27.61",
	"input_tp" : "-4.47",
	"input_lra" : "18.06",
	"input_thresh" : "-39.20",
	"output_i" : "-16.58",
	"target_offset" : "0.58"
}"#;
        let l = parse_loudness(err).unwrap();
        assert_eq!(l.input_i, -27.61);
        assert_eq!(l.target_offset, 0.58);
        let silent = r#"{"input_i":"-inf","input_tp":"-inf","input_lra":"0.00","input_thresh":"-inf","target_offset":"inf"}"#;
        assert_eq!(parse_loudness(silent).unwrap_err().kind, ErrorKind::NoAudio);
    }

    #[test]
    fn peaks() {
        let mut pcm = vec![];
        for i in 0..160 {
            let v: i16 = if i < 80 { 16384 } else { 0 };
            pcm.extend(v.to_le_bytes());
        }
        let p = peaks_from_pcm(&pcm);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0], 180);
        assert_eq!(p[1], 0);
        assert!(loudness_args("a.mp4", 1.0, 2.0).join(" ").contains("print_format=json"));
    }
}
