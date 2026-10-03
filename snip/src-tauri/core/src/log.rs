//! Log rotativo en la carpeta de datos de la app (`logs/snip.log`).
//!
//! Sirve para diagnosticar fallas de exportación en la PC del usuario: se
//! guarda el comando de FFmpeg que falló y su error real. Rota a 1 MB y
//! conserva 3 archivos (`snip.log`, `snip.1.log`, `snip.2.log`).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static LOG: Mutex<Option<PathBuf>> = Mutex::new(None);

pub const MAX_BYTES: u64 = 1024 * 1024;
pub const KEEP: usize = 3;

/// Activa el log en `dir` (se crea si no existe).
pub fn init(dir: &Path) {
    let _ = std::fs::create_dir_all(dir);
    if let Ok(mut g) = LOG.lock() {
        *g = Some(dir.join("snip.log"));
    }
}

/// Ruta del log actual (si está activo).
pub fn path() -> Option<PathBuf> {
    LOG.lock().ok().and_then(|g| g.clone())
}

fn rotated(path: &Path, n: usize) -> PathBuf {
    path.with_file_name(format!("snip.{n}.log"))
}

/// Si el archivo pasó el tope, corre snip.log → snip.1.log → snip.2.log.
pub fn rotate(path: &Path, max: u64, keep: usize) {
    let big = std::fs::metadata(path).map(|m| m.len() >= max).unwrap_or(false);
    if !big {
        return;
    }
    let _ = std::fs::remove_file(rotated(path, keep - 1));
    for n in (1..keep - 1).rev() {
        let _ = std::fs::rename(rotated(path, n), rotated(path, n + 1));
    }
    let _ = std::fs::rename(path, rotated(path, 1));
}

/// Escribe una línea con fecha y nivel en `path` (rota antes si hace falta).
pub fn write_to(path: &Path, level: &str, msg: &str) {
    rotate(path, MAX_BYTES, KEEP);
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} {level} {msg}", timestamp(secs));
    }
}

fn log(level: &str, msg: &str) {
    if let Some(p) = path() {
        write_to(&p, level, msg);
    }
}

pub fn info(msg: &str) {
    log("INFO", msg);
}

pub fn warn(msg: &str) {
    log("WARN", msg);
}

pub fn error(msg: &str) {
    log("ERROR", msg);
}

/// `AAAA-MM-DD hh:mm:ss` (UTC) sin depender de chrono.
pub fn timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Algoritmo de Howard Hinnant (días civiles).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_is_civil_date() {
        assert_eq!(timestamp(0), "1970-01-01 00:00:00");
        assert_eq!(timestamp(1_791_000_000), "2026-10-03 04:00:00");
    }

    #[test]
    fn rotates_and_keeps_three() {
        let dir = std::env::temp_dir().join(format!("snip-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("snip.log");
        for round in 0..5 {
            std::fs::write(&p, vec![b'x'; 64]).unwrap();
            rotate(&p, 32, 3);
            assert!(!p.exists(), "ronda {round}: se rotó");
        }
        let mut names: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["snip.1.log", "snip.2.log"]);
        write_to(&p, "INFO", "hola");
        assert!(std::fs::read_to_string(&p).unwrap().contains("INFO hola"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
