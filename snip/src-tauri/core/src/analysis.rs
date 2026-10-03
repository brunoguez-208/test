//! Análisis de audio para las herramientas automáticas (jugadas, silencios y
//! beats). Cada 10 ms: nivel RMS (dBFS) e intensidad de ataque (flujo
//! espectral). Todo local, con FFmpeg para decodificar.

use crate::error::AppError;
use crate::graph::s;
use crate::runner::{self, Tools};
use std::path::Path;

/// Cuadros de análisis por segundo.
pub const RATE: u32 = 100;
const SAMPLE_RATE: u32 = 24_000;
const HOP: usize = (SAMPLE_RATE / RATE) as usize;
const FFT: usize = 1024;
/// Piso del nivel (silencio digital).
pub const FLOOR_DB: f32 = -90.0;

#[derive(Debug, Clone)]
pub struct AudioAnalysis {
    pub rate: u32,
    /// Nivel por cuadro: u8 = (dB + 100) × 2 (0,5 dB de resolución).
    pub level: Vec<u8>,
    /// Ataque por cuadro, 0..255 (normalizado al máximo del archivo).
    pub onset: Vec<u8>,
}

pub fn decode_args(path: &str, tracks: u32) -> Vec<String> {
    let mut a = vec![s("-hide_banner"), s("-nostdin"), s("-loglevel"), s("error"), s("-i"), s(path), s("-vn")];
    if tracks > 1 {
        let ins: String = (0..tracks).map(|i| format!("[0:a:{i}]")).collect();
        a.extend([s("-filter_complex"), format!("{ins}amix=inputs={tracks}:normalize=0[a]"), s("-map"), s("[a]")]);
    } else {
        a.extend([s("-map"), s("0:a:0")]);
    }
    a.extend([s("-ac"), s("1"), s("-ar"), SAMPLE_RATE.to_string(), s("-f"), s("f32le"), s("-")]);
    a
}

/// FFT compleja in-place (radix 2).
pub fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
        len <<= 1;
    }
}

/// (nivel dB, ataque sin normalizar) por cuadro de 10 ms.
pub fn analyze_samples(x: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let frames = x.len().div_ceil(HOP);
    let mut level = Vec::with_capacity(frames);
    for f in 0..frames {
        let chunk = &x[f * HOP..((f + 1) * HOP).min(x.len())];
        let p = chunk.iter().map(|v| v * v).sum::<f32>() / chunk.len().max(1) as f32;
        level.push(if p > 1e-12 { (10.0 * p.log10()).max(FLOOR_DB) } else { FLOOR_DB });
    }
    // Flujo espectral con compresión logarítmica, ventana de Hann centrada en el cuadro.
    let win: Vec<f32> = (0..FFT).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT as f32).cos()).collect();
    let mut prev = vec![0f32; FFT / 2];
    let mut onset = Vec::with_capacity(frames);
    let (mut re, mut im) = (vec![0f32; FFT], vec![0f32; FFT]);
    for f in 0..frames {
        let center = f * HOP + HOP / 2;
        for i in 0..FFT {
            let k = center as isize + i as isize - (FFT / 2) as isize;
            re[i] = if k >= 0 && (k as usize) < x.len() { x[k as usize] * win[i] } else { 0.0 };
            im[i] = 0.0;
        }
        fft(&mut re, &mut im);
        let mut flux = 0.0;
        for b in 0..FFT / 2 {
            let mag = (1.0 + 100.0 * (re[b] * re[b] + im[b] * im[b]).sqrt()).ln();
            flux += (mag - prev[b]).max(0.0);
            prev[b] = mag;
        }
        onset.push(if f == 0 { 0.0 } else { flux });
    }
    (level, onset)
}

pub fn encode(level: &[f32], onset: &[f32]) -> AudioAnalysis {
    let lv: Vec<u8> = level.iter().map(|d| ((d + 100.0).clamp(0.0, 100.0) * 2.0).round() as u8).collect();
    let max = onset.iter().cloned().fold(0.0f32, f32::max).max(1e-9);
    let on: Vec<u8> = onset.iter().map(|v| (v / max * 255.0).round().clamp(0.0, 255.0) as u8).collect();
    AudioAnalysis { rate: RATE, level: lv, onset: on }
}

pub fn analyze(tools: &Tools, path: &Path, tracks: u32) -> Result<AudioAnalysis, AppError> {
    let pcm = runner::run_capture(&tools.ffmpeg, &decode_args(&path.to_string_lossy(), tracks.max(1)))?;
    let x: Vec<f32> = pcm.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let (level, onset) = analyze_samples(&x);
    Ok(encode(&level, &onset))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(f: f32, secs: f32, amp: f32) -> Vec<f32> {
        (0..(secs * SAMPLE_RATE as f32) as usize).map(|i| amp * (2.0 * std::f32::consts::PI * f * i as f32 / SAMPLE_RATE as f32).sin()).collect()
    }

    #[test]
    fn fft_finds_the_tone() {
        let mut re: Vec<f32> = tone(24_000.0 * 64.0 / 1024.0, 1024.0 / 24_000.0, 1.0)[..1024].to_vec();
        let mut im = vec![0.0; 1024];
        fft(&mut re, &mut im);
        let mags: Vec<f32> = (0..512).map(|b| (re[b] * re[b] + im[b] * im[b]).sqrt()).collect();
        let peak = mags.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0;
        assert_eq!(peak, 64);
    }

    #[test]
    fn level_and_onsets() {
        // 0,5 s de silencio, 0,5 s de tono a −6 dB, 0,5 s de silencio y un golpe.
        let mut x = vec![0.0; 12_000];
        x.extend(tone(440.0, 0.5, 0.5));
        x.extend(vec![0.0; 12_000]);
        x.extend(tone(1000.0, 0.05, 0.9));
        x.extend(vec![0.0; 12_000]);
        let (level, onset) = analyze_samples(&x);
        assert_eq!(level.len(), x.len().div_ceil(HOP));
        assert_eq!(level[10], FLOOR_DB);
        // Senoidal de amplitud 0,5: RMS = 0,354 → −9 dBFS.
        assert!((level[75] + 9.03).abs() < 0.2, "{}", level[75]);
        let peak = onset.iter().enumerate().skip(110).max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0;
        assert!((148..=152).contains(&peak), "ataque en {peak}");
        let a = encode(&level, &onset);
        assert_eq!(a.rate, 100);
        assert_eq!(a.level[10], 20, "−90 dB → 20");
        assert_eq!(a.onset.iter().max(), Some(&255));
    }

    #[test]
    fn mixes_several_tracks() {
        let a = decode_args("x.mp4", 2).join(" ");
        assert!(a.contains("[0:a:0][0:a:1]amix=inputs=2:normalize=0[a]") && a.contains("-ar 24000 -f f32le"), "{a}");
        assert!(decode_args("x.mp4", 1).join(" ").contains("-map 0:a:0"));
    }
}
