//! Encoders de H.264 y su detección real.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Encoder {
    Nvenc,
    Qsv,
    Amf,
    Libx264,
}

/// Orden de preferencia: NVENC > QSV > AMF > libx264.
pub const PREFERENCE: [Encoder; 4] = [Encoder::Nvenc, Encoder::Qsv, Encoder::Amf, Encoder::Libx264];

impl Encoder {
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            Encoder::Nvenc => "h264_nvenc",
            Encoder::Qsv => "h264_qsv",
            Encoder::Amf => "h264_amf",
            Encoder::Libx264 => "libx264",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Encoder::Nvenc => "NVIDIA NVENC",
            Encoder::Qsv => "Intel Quick Sync",
            Encoder::Amf => "AMD AMF",
            Encoder::Libx264 => "x264 (CPU)",
        }
    }

    pub fn is_hardware(self) -> bool {
        !matches!(self, Encoder::Libx264)
    }

    /// Formato de píxel de entrada que mejor acepta cada encoder (8 bits 4:2:0).
    pub fn pix_fmt(self) -> &'static str {
        match self {
            Encoder::Qsv => "nv12",
            _ => "yuv420p",
        }
    }

    /// Argumentos de alta calidad para la exportación "Precisa".
    pub fn quality_args(self) -> Vec<String> {
        let a: &[&str] = match self {
            Encoder::Nvenc => &[
                "-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "18", "-b:v", "0",
                "-profile:v", "high",
            ],
            Encoder::Qsv => &[
                "-c:v", "h264_qsv", "-preset", "veryslow", "-global_quality", "18", "-profile:v", "high",
            ],
            Encoder::Amf => &[
                "-c:v", "h264_amf", "-usage", "transcoding", "-quality", "quality", "-rc", "cqp", "-qp_i", "18",
                "-qp_p", "18", "-qp_b", "20", "-profile:v", "high",
            ],
            Encoder::Libx264 => &["-c:v", "libx264", "-crf", "17", "-preset", "slow", "-profile:v", "high"],
        };
        a.iter().map(|s| s.to_string()).collect()
    }

    /// Argumentos rápidos para el proxy de preview (calidad suficiente para ver).
    pub fn proxy_args(self) -> Vec<String> {
        let a: &[&str] = match self {
            Encoder::Nvenc => &["-c:v", "h264_nvenc", "-preset", "p1", "-rc", "vbr", "-cq", "27", "-b:v", "0"],
            Encoder::Qsv => &["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "27"],
            Encoder::Amf => &["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "26", "-qp_p", "28"],
            Encoder::Libx264 => &["-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-tune", "fastdecode"],
        };
        a.iter().map(|s| s.to_string()).collect()
    }

    /// Encode de prueba de 1 frame a `-f null`: la única forma confiable de saber
    /// si el encoder funciona de verdad en esta PC (driver, GPU, sesión libre).
    /// Usa exactamente los mismos argumentos de calidad que la exportación.
    pub fn probe_args(self) -> Vec<String> {
        let mut a: Vec<String> = [
            "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
            "color=c=black:s=320x240:r=30:d=1", "-frames:v", "1", "-vf",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        a.push(format!("format={}", self.pix_fmt()));
        a.extend(self.quality_args());
        a.extend(["-f", "null", "-"].iter().map(|s| s.to_string()));
        a
    }
}

/// Elige el primer encoder que funcione según `works`, respetando la preferencia.
/// libx264 siempre queda como último recurso.
pub fn pick_encoder(mut works: impl FnMut(Encoder) -> bool) -> Encoder {
    PREFERENCE
        .iter()
        .copied()
        .find(|e| *e == Encoder::Libx264 || works(*e))
        .unwrap_or(Encoder::Libx264)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preference_order() {
        assert_eq!(pick_encoder(|_| true), Encoder::Nvenc);
        assert_eq!(pick_encoder(|e| e != Encoder::Nvenc), Encoder::Qsv);
        assert_eq!(pick_encoder(|e| e == Encoder::Amf), Encoder::Amf);
        assert_eq!(pick_encoder(|_| false), Encoder::Libx264);
    }

    #[test]
    fn libx264_is_never_probed_as_hardware() {
        let mut probed = vec![];
        pick_encoder(|e| {
            probed.push(e);
            false
        });
        assert_eq!(probed, vec![Encoder::Nvenc, Encoder::Qsv, Encoder::Amf]);
    }

    #[test]
    fn nvenc_quality_args_match_spec() {
        let a = Encoder::Nvenc.quality_args().join(" ");
        assert!(a.contains("-c:v h264_nvenc -preset p7 -tune hq -rc vbr -cq 18 -b:v 0"), "{a}");
        let x = Encoder::Libx264.quality_args().join(" ");
        assert!(x.contains("-c:v libx264 -crf 17 -preset slow"), "{x}");
    }

    #[test]
    fn probe_is_a_one_frame_null_encode_with_real_args() {
        for e in PREFERENCE {
            let a = e.probe_args();
            let j = a.join(" ");
            assert!(j.contains("-frames:v 1"));
            assert!(j.ends_with("-f null -"));
            assert!(j.contains(e.ffmpeg_name()));
            assert!(j.contains(&format!("format={}", e.pix_fmt())));
        }
    }
}
