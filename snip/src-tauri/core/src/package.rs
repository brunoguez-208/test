//! "Empaquetar proyecto": el `.snip` más una copia de todos los medios que usa,
//! con rutas relativas, en una carpeta o en un ZIP. Se abre en otra PC tal cual.

use crate::error::{AppError, ErrorKind};
use crate::project::Project;
use crate::store::{file_name, unique_name, write_atomic};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageResult {
    /// Carpeta o ZIP creado.
    pub path: String,
    pub files: usize,
    pub bytes: u64,
}

/// Nombre de archivo seguro para Windows (sin `\\ / : * ? " < > |`).
pub fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "proyecto".into() } else { s }
}

/// El proyecto con los medios en `media/…` y la lista (origen, nombre en el paquete).
pub fn relocate(p: &Project) -> Result<(Project, Vec<(PathBuf, String)>), AppError> {
    let mut used = HashSet::new();
    let mut files = vec![];
    let mut q = p.clone();
    for m in &mut q.media {
        let src = PathBuf::from(&m.path);
        if !src.is_file() {
            return Err(AppError::with_message(ErrorKind::MediaMissing, format!("Falta {}: ubicalo antes de empaquetar.", file_name(&m.path))));
        }
        let name = unique_name(&file_name(&m.path), &mut used);
        m.path = format!("media/{name}");
        files.push((src, name));
    }
    Ok((q, files))
}

fn copy_with_progress(src: &Path, mut out: impl Write, done: &mut u64, total: u64, on_progress: &mut dyn FnMut(f64)) -> Result<(), AppError> {
    let mut f = std::fs::File::open(src).map_err(|e| AppError::from_io(&e))?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| AppError::from_io(&e))?;
        if n == 0 {
            return Ok(());
        }
        out.write_all(&buf[..n]).map_err(|e| AppError::from_io(&e))?;
        *done += n as u64;
        on_progress(100.0 * *done as f64 / total.max(1) as f64);
    }
}

/// Empaqueta en `dest`: si `as_zip`, `dest` es el `.zip`; si no, la carpeta
/// donde se crea `<nombre>/` (con `<nombre>.snip` y `media/`).
pub fn package_project(p: &Project, dest: &Path, as_zip: bool, mut on_progress: impl FnMut(f64)) -> Result<PackageResult, AppError> {
    let (q, files) = relocate(p)?;
    let name = safe_name(if p.name.is_empty() { "proyecto" } else { &p.name });
    let snip = serde_json::to_string_pretty(&q).map_err(|e| AppError::with_detail(ErrorKind::Unknown, e.to_string()))?;
    let total: u64 = files.iter().map(|(s, _)| std::fs::metadata(s).map(|m| m.len()).unwrap_or(0)).sum();
    let mut done = 0u64;
    if as_zip {
        let tmp = dest.with_extension("zip.snip-part");
        let file = std::fs::File::create(&tmp).map_err(|e| AppError::from_io(&e))?;
        let mut z = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let zerr = |e: zip::result::ZipError| AppError::with_detail(ErrorKind::Unknown, e.to_string());
        let deflate = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        z.start_file(format!("{name}.snip"), deflate).map_err(zerr)?;
        z.write_all(snip.as_bytes()).map_err(|e| AppError::from_io(&e))?;
        // Los videos ya están comprimidos: se guardan tal cual (ZIP64 si pasan de 4 GB).
        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
        for (src, n) in &files {
            z.start_file(format!("media/{n}"), stored).map_err(zerr)?;
            copy_with_progress(src, &mut z, &mut done, total, &mut on_progress)?;
        }
        z.finish().map_err(zerr)?.flush().map_err(|e| AppError::from_io(&e))?;
        std::fs::rename(&tmp, dest).map_err(|e| AppError::from_io(&e))?;
        return Ok(PackageResult { path: dest.to_string_lossy().into_owned(), files: files.len() + 1, bytes: total });
    }
    // Carpeta: <dest>/<nombre>, o <nombre> (2)… si ya existe.
    let mut root = dest.join(&name);
    let mut n = 2;
    while root.exists() {
        root = dest.join(format!("{name} ({n})"));
        n += 1;
    }
    std::fs::create_dir_all(root.join("media")).map_err(|e| AppError::from_io(&e))?;
    for (src, n) in &files {
        let out = std::fs::File::create(root.join("media").join(n)).map_err(|e| AppError::from_io(&e))?;
        copy_with_progress(src, std::io::BufWriter::new(out), &mut done, total, &mut on_progress)?;
    }
    write_atomic(&root.join(format!("{name}.snip")), snip.as_bytes())?;
    Ok(PackageResult { path: root.to_string_lossy().into_owned(), files: files.len() + 1, bytes: total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    fn setup() -> (tempfile::TempDir, Project) {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("in").join("Desktop 2026.10.03 - 04.28.16.07.mp4");
        let b = dir.path().join("in2").join("Desktop 2026.10.03 - 04.28.16.07.mp4");
        for f in [&a, &b] {
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, b"video falso").unwrap();
        }
        let p = project_with(
            vec![media("m1", &a.to_string_lossy(), 10.0, 1920, 1080, 30, true), media("m2", &b.to_string_lossy(), 10.0, 1920, 1080, 30, true)],
            vec![clip("c1", 0.0, 5.0)],
        );
        (dir, p)
    }

    #[test]
    fn folder_package_has_relative_paths_and_reopens() {
        let (dir, p) = setup();
        let out = dir.path().join("out");
        std::fs::create_dir_all(&out).unwrap();
        let r = package_project(&p, &out, false, |_| {}).unwrap();
        let root = PathBuf::from(&r.path);
        assert_eq!(root.file_name().unwrap(), "Proyecto");
        assert!(root.join("media/Desktop 2026.10.03 - 04.28.16.07.mp4").is_file());
        assert!(root.join("media/Desktop 2026.10.03 - 04.28.16.07 (2).mp4").is_file(), "mismos nombres no se pisan");
        let text = std::fs::read_to_string(root.join("Proyecto.snip")).unwrap();
        assert!(text.contains("\"media/Desktop 2026.10.03 - 04.28.16.07.mp4\""));
        // Se abre en "otra PC": las rutas se resuelven desde la carpeta del .snip.
        let moved = dir.path().join("otra-pc");
        std::fs::rename(&root, &moved).unwrap();
        let (q, missing) = crate::store::open_snip(&moved.join("Proyecto.snip")).unwrap();
        assert!(missing.is_empty(), "{missing:?}");
        assert!(q.media[0].path.starts_with(&*moved.to_string_lossy()));
        // Empaquetar de nuevo en el mismo lugar no pisa el anterior.
        let r2 = package_project(&p, &out, false, |_| {}).unwrap();
        assert!(r2.path.ends_with("Proyecto"), "{}", r2.path);
        let r3 = package_project(&p, &out, false, |_| {}).unwrap();
        assert!(r3.path.ends_with("Proyecto (2)"), "{}", r3.path);
    }

    #[test]
    fn zip_package_contains_snip_and_media() {
        let (dir, p) = setup();
        let zip_path = dir.path().join("paquete.zip");
        let mut last = 0.0;
        let r = package_project(&p, &zip_path, true, |x| last = x).unwrap();
        assert_eq!(r.files, 3);
        assert!((last - 100.0).abs() < 1e-9);
        let mut z = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        let mut names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect();
        names.sort();
        assert_eq!(names, ["Proyecto.snip", "media/Desktop 2026.10.03 - 04.28.16.07 (2).mp4", "media/Desktop 2026.10.03 - 04.28.16.07.mp4"]);
        let mut s = String::new();
        z.by_name("Proyecto.snip").unwrap().read_to_string(&mut s).unwrap();
        assert!(s.contains("media/Desktop"));
    }

    #[test]
    fn missing_media_is_reported() {
        let (dir, mut p) = setup();
        p.media[0].path = dir.path().join("no-existe.mp4").to_string_lossy().into_owned();
        let e = package_project(&p, dir.path(), false, |_| {}).unwrap_err();
        assert_eq!(e.kind, ErrorKind::MediaMissing);
        assert!(e.message.contains("no-existe.mp4"));
    }

    #[test]
    fn relative_paths_and_safe_names() {
        assert!(crate::store::is_relative_media("media/a.mp4"));
        assert!(!crate::store::is_relative_media("C:\\v\\a.mp4"));
        assert!(!crate::store::is_relative_media("\\\\nas\\v\\a.mp4"));
        assert!(!crate::store::is_relative_media("/home/a.mp4"));
        assert_eq!(safe_name("Mi: video?"), "Mi_ video_");
        assert_eq!(safe_name(" . "), "proyecto");
    }
}
