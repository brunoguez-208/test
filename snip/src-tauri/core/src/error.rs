//! Errores de Snip con mensajes claros en español rioplatense.
//!
//! El frontend nunca ve el error crudo de FFmpeg como mensaje principal: recibe
//! un `kind` estable (para decidir qué mostrar) y un `message` legible. El texto
//! técnico queda en `detail`, por si el usuario quiere ver más.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    NotMp4,
    NotFound,
    NoVideo,
    Corrupt,
    DiskFull,
    PermissionDenied,
    EncoderFailed,
    Cancelled,
    SameAsInput,
    InvalidRange,
    UpscaleNotConfirmed,
    FpsIncreaseNotConfirmed,
    FfmpegMissing,
    Busy,
    /// Formato de archivo que Snip no abre.
    UnsupportedFormat,
    /// Proyecto dañado o que no es de Snip.
    BadProject,
    /// Proyecto de una versión más nueva u operación no soportada.
    Unsupported,
    /// El proyecto no tiene audio (para exportar MP3).
    NoAudio,
    /// Falta un archivo usado por el proyecto (se movió o se borró).
    MediaMissing,
    /// No se pudo descargar algo (modelo de subtítulos).
    Network,
    Unknown,
}

impl ErrorKind {
    pub fn default_message(self) -> &'static str {
        match self {
            ErrorKind::NotMp4 => "Por ahora solo MP4.",
            ErrorKind::NotFound => "No encontramos el archivo. Puede que se haya movido o borrado.",
            ErrorKind::NoVideo => "Este archivo no tiene una pista de video.",
            ErrorKind::Corrupt => {
                "No pudimos leer el video. Puede que el archivo esté dañado o incompleto."
            }
            ErrorKind::DiskFull => "No hay espacio suficiente en el disco para guardar el video.",
            ErrorKind::PermissionDenied => {
                "No hay permiso para escribir en esa carpeta. Probá con «Guardar como…» en otra ubicación."
            }
            ErrorKind::EncoderFailed => "El codificador de video falló.",
            ErrorKind::Cancelled => "Exportación cancelada.",
            ErrorKind::SameAsInput => "No podés guardar encima del video original.",
            ErrorKind::InvalidRange => "El rango elegido no es válido.",
            ErrorKind::UpscaleNotConfirmed => {
                "La resolución elegida es mayor que la original. Confirmá si querés agrandar el video."
            }
            ErrorKind::FpsIncreaseNotConfirmed => {
                "Los fps elegidos superan a los originales. Confirmá si querés duplicar cuadros."
            }
            ErrorKind::FfmpegMissing => "Falta FFmpeg en la instalación de Snip. Reinstalá la app.",
            ErrorKind::Busy => "Ya hay una exportación en curso.",
            ErrorKind::UnsupportedFormat => "Ese formato no se puede abrir. Snip abre MP4, MOV, MKV y WebM.",
            ErrorKind::BadProject => "El proyecto está dañado o no es un proyecto de Snip.",
            ErrorKind::Unsupported => "Esto no se puede hacer con esta versión de Snip.",
            ErrorKind::NoAudio => "El proyecto no tiene audio.",
            ErrorKind::MediaMissing => "No encontramos un archivo del proyecto. Puede que se haya movido o borrado.",
            ErrorKind::Network => "No se pudo descargar. Revisá la conexión a internet y probá de nuevo.",
            ErrorKind::Unknown => "Algo salió mal al procesar el video.",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(kind: ErrorKind) -> Self {
        Self { kind, message: kind.default_message().to_string(), detail: None }
    }

    pub fn with_detail(kind: ErrorKind, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        let detail = if detail.trim().is_empty() { None } else { Some(tail(&detail, 4000)) };
        Self { kind, message: kind.default_message().to_string(), detail }
    }

    pub fn with_message(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), detail: None }
    }

    /// Error de E/S del sistema operativo al leer o escribir archivos propios.
    pub fn from_io(err: &std::io::Error) -> Self {
        use std::io::ErrorKind as K;
        let kind = match err.kind() {
            K::NotFound => ErrorKind::NotFound,
            K::PermissionDenied | K::ReadOnlyFilesystem => ErrorKind::PermissionDenied,
            K::StorageFull | K::QuotaExceeded => ErrorKind::DiskFull,
            _ => ErrorKind::Unknown,
        };
        Self::with_detail(kind, err.to_string())
    }

    /// ¿Vale la pena reintentar con libx264? Todo lo que no sea culpa del
    /// usuario o del disco (cancelar, sin espacio, sin permiso, archivo que falta).
    pub fn retry_on_cpu(&self) -> bool {
        !matches!(
            self.kind,
            ErrorKind::Cancelled
                | ErrorKind::DiskFull
                | ErrorKind::PermissionDenied
                | ErrorKind::NotFound
                | ErrorKind::MediaMissing
                | ErrorKind::SameAsInput
                | ErrorKind::UpscaleNotConfirmed
                | ErrorKind::FpsIncreaseNotConfirmed
                | ErrorKind::FfmpegMissing
                | ErrorKind::Busy
        )
    }

    /// Una línea para el log (tipo, mensaje y detalle técnico).
    pub fn log_line(&self) -> String {
        match &self.detail {
            Some(d) => format!("{:?}: {} | {}", self.kind, self.message, d.replace('\n', " ⏎ ")),
            None => format!("{:?}: {}", self.kind, self.message),
        }
    }
}

/// Deja solo el final de un texto largo (las últimas líneas de FFmpeg son las útiles).
fn tail(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.len() <= max {
        return s.to_string();
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &s[start..])
}

/// Traduce el stderr de FFmpeg a un tipo de error entendible.
pub fn classify_ffmpeg_stderr(stderr: &str) -> ErrorKind {
    let s = stderr.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| s.contains(n));

    if has(&["no space left on device", "disk quota exceeded", "there is not enough space"]) {
        return ErrorKind::DiskFull;
    }
    if has(&["permission denied", "access is denied", "read-only file system"]) {
        return ErrorKind::PermissionDenied;
    }
    if has(&[
        "error while opening encoder",
        "openencodesessionex failed",
        "no capable devices found",
        "cannot load nvcuda",
        "cannot load nvencodeapi",
        "driver does not support the required nvenc api version",
        "[h264_nvenc",
        "error creating a mfx session",
        "error initializing an internal mfx session",
        "[h264_qsv",
        "[h264_amf",
        "amf failed",
        "could not open encoder before eof",
        "error initializing output stream",
        "unknown encoder",
    ]) {
        return ErrorKind::EncoderFailed;
    }
    if has(&[
        "moov atom not found",
        "invalid data found when processing input",
        "could not find codec parameters",
        "error splitting the input into nal units",
        "partial file",
        "invalid nal unit size",
        "truncating packet",
        "stream ends prematurely",
    ]) {
        return ErrorKind::Corrupt;
    }
    if has(&["no such file or directory", "the system cannot find the"]) {
        return ErrorKind::NotFound;
    }
    ErrorKind::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_common_ffmpeg_failures() {
        assert_eq!(classify_ffmpeg_stderr("av_interleaved_write_frame(): No space left on device"), ErrorKind::DiskFull);
        assert_eq!(classify_ffmpeg_stderr("C:\\x\\out.mp4: Permission denied"), ErrorKind::PermissionDenied);
        assert_eq!(classify_ffmpeg_stderr("[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: unsupported device (2)"), ErrorKind::EncoderFailed);
        assert_eq!(classify_ffmpeg_stderr("[h264_qsv @ 0x1] Error creating a MFX session: -9."), ErrorKind::EncoderFailed);
        assert_eq!(classify_ffmpeg_stderr("[mov,mp4 @ 0x1] moov atom not found\nin.mp4: Invalid data found when processing input"), ErrorKind::Corrupt);
        assert_eq!(classify_ffmpeg_stderr("in.mp4: No such file or directory"), ErrorKind::NotFound);
        assert_eq!(classify_ffmpeg_stderr("something odd"), ErrorKind::Unknown);
    }

    #[test]
    fn generic_eperm_from_ffmpeg_is_not_a_permission_problem() {
        let s = "[h264_nvenc @ 0x1] Cannot load libcuda.so.1\n[vf#0:0 @ 0x2] Error sending frames to consumers: Operation not permitted\nCould not open encoder before EOF";
        assert_eq!(classify_ffmpeg_stderr(s), ErrorKind::EncoderFailed);
    }

    #[test]
    fn disk_full_wins_over_encoder_noise() {
        let s = "[h264_nvenc @ 0x1] frame\nav_interleaved_write_frame(): No space left on device";
        assert_eq!(classify_ffmpeg_stderr(s), ErrorKind::DiskFull);
    }

    #[test]
    fn serializes_for_the_frontend() {
        let e = AppError::with_detail(ErrorKind::NotMp4, "x");
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "notMp4");
        assert_eq!(v["message"], "Por ahora solo MP4.");
        assert_eq!(v["detail"], "x");
    }

    #[test]
    fn long_detail_is_trimmed_to_the_tail() {
        let long = "á".repeat(5000);
        let e = AppError::with_detail(ErrorKind::Unknown, long);
        assert!(e.detail.unwrap().chars().count() <= 4002);
    }
}
