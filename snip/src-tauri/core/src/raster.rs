//! Capas rasterizadas por el frontend (textos, subtítulos, logos, máscaras):
//! se escriben en una carpeta por trabajo dentro de la caché de Snip y se
//! borran cuando termina la exportación. Nunca se escribe fuera de esa carpeta.

use crate::error::{AppError, ErrorKind};
use std::path::{Path, PathBuf};

fn bad(msg: &str) -> AppError {
    AppError::with_message(ErrorKind::Unknown, msg)
}

/// Id de carpeta: letras minúsculas, números y guiones (lo genera el frontend).
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 48 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Nombre de archivo simple con extensión permitida.
pub fn valid_name(name: &str) -> bool {
    let ok_chars = !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    ok_chars && !name.starts_with('.') && (name.ends_with(".png") || name.ends_with(".ffconcat"))
}

pub fn job_dir(root: &Path, id: &str) -> Result<PathBuf, AppError> {
    if !valid_id(id) {
        return Err(bad("Identificador de capas inválido."));
    }
    let d = root.join(id);
    std::fs::create_dir_all(&d).map_err(|e| AppError::from_io(&e))?;
    Ok(d)
}

/// Escribe archivos en la carpeta del trabajo (los PNG se validan por su firma).
pub fn write_files(root: &Path, id: &str, files: &[(String, Vec<u8>)]) -> Result<PathBuf, AppError> {
    let d = job_dir(root, id)?;
    for (name, bytes) in files {
        if !valid_name(name) {
            return Err(bad("Nombre de archivo de capa inválido."));
        }
        if name.ends_with(".png") && (bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n") {
            return Err(bad("Una capa no es un PNG válido."));
        }
        std::fs::write(d.join(name), bytes).map_err(|e| AppError::from_io(&e))?;
    }
    Ok(d)
}

/// Lista ffconcat: solo puede nombrar archivos de la misma carpeta.
pub fn write_list(root: &Path, id: &str, name: &str, text: &str) -> Result<PathBuf, AppError> {
    if !name.ends_with(".ffconcat") || !valid_name(name) {
        return Err(bad("Nombre de lista inválido."));
    }
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("file ") {
            let f = rest.trim().trim_matches('\'');
            if !valid_name(f) || !f.ends_with(".png") {
                return Err(bad("La lista de capas nombra un archivo inválido."));
            }
        }
    }
    let d = job_dir(root, id)?;
    let p = d.join(name);
    std::fs::write(&p, text).map_err(|e| AppError::from_io(&e))?;
    Ok(p)
}

/// Borra la carpeta de un trabajo (solo si está dentro de `root`).
pub fn remove_job_dir(root: &Path, dir: &str) {
    let d = Path::new(dir);
    let inside = d.parent().is_some_and(|p| p == root) && d.file_name().and_then(|n| n.to_str()).is_some_and(valid_id);
    if inside {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nresto";

    #[test]
    fn ids_and_names() {
        assert!(valid_id("job-1a2b"));
        assert!(!valid_id("../x") && !valid_id("") && !valid_id("A") && !valid_id("a/b"));
        assert!(valid_name("f00001.png") && valid_name("decor.ffconcat"));
        assert!(!valid_name("../f.png") && !valid_name(".png") && !valid_name("f.exe") && !valid_name("a b.png"));
    }

    #[test]
    fn write_and_cleanup() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let d = write_files(root, "job-1", &[("f1.png".into(), PNG.to_vec())]).unwrap();
        assert!(d.join("f1.png").is_file());
        assert!(write_files(root, "job-1", &[("f2.png".into(), b"nope".to_vec())]).is_err());
        assert!(write_files(root, "job-1", &[("../f.png".into(), PNG.to_vec())]).is_err());
        let list = write_list(root, "job-1", "decor.ffconcat", "ffconcat version 1.0\nfile 'f1.png'\nduration 1\nfile 'f1.png'\n").unwrap();
        assert!(list.is_file());
        assert!(write_list(root, "job-1", "decor.ffconcat", "file '/etc/passwd'\n").is_err());
        // Fuera de la raíz no se borra nada.
        remove_job_dir(root, tmp.path().parent().unwrap().to_str().unwrap());
        assert!(root.exists());
        remove_job_dir(root, d.to_str().unwrap());
        assert!(!d.exists());
    }
}
