//! Nombres de salida: `nombre_snip.mp4`, y si existe `nombre_snip (2).mp4`, etc.

use std::path::{Path, PathBuf};

pub const SUFFIX: &str = "_snip";

/// Primer nombre libre junto al original. `exists` se inyecta para poder testear.
pub fn unique_output_path(input: &Path, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let dir = input.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "video".into());
    unique_in_dir(&dir, &format!("{stem}{SUFFIX}"), exists)
}

/// Primer `base.mp4`, `base (2).mp4`, `base (3).mp4`… que no exista en `dir`.
pub fn unique_in_dir(dir: &Path, base: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(format!("{base}.mp4"));
    if !exists(&first) {
        return first;
    }
    for n in 2..100_000u32 {
        let p = dir.join(format!("{base} ({n}).mp4"));
        if !exists(&p) {
            return p;
        }
    }
    dir.join(format!("{base} ({}).mp4", std::process::id()))
}

/// Asegura la extensión .mp4 (para "Guardar como…").
pub fn ensure_mp4_extension(p: &Path) -> PathBuf {
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) if e.eq_ignore_ascii_case("mp4") => p.to_path_buf(),
        _ => {
            let mut s = p.as_os_str().to_owned();
            s.push(".mp4");
            PathBuf::from(s)
        }
    }
}

/// Archivo temporal donde FFmpeg escribe; se renombra al final si todo salió bien.
pub fn partial_path(final_path: &Path) -> PathBuf {
    let mut s = final_path.as_os_str().to_owned();
    s.push(".snip-part");
    PathBuf::from(s)
}

/// ¿El path tiene extensión .mp4 (sin importar mayúsculas)?
pub fn is_mp4(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("mp4"))
}

/// Compara dos rutas como lo haría Windows (sin distinguir mayúsculas), resolviendo
/// links cuando se puede.
pub fn same_file(a: &Path, b: &Path) -> bool {
    let ca = std::fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let cb = std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    if cfg!(windows) {
        ca.to_string_lossy().to_lowercase() == cb.to_string_lossy().to_lowercase()
    } else {
        ca == cb
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn set(paths: &[&str]) -> HashSet<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn first_free_name() {
        let input = Path::new("/videos/clip.mp4");
        let none = set(&[]);
        assert_eq!(unique_output_path(input, |p| none.contains(p)), PathBuf::from("/videos/clip_snip.mp4"));
        let one = set(&["/videos/clip_snip.mp4"]);
        assert_eq!(unique_output_path(input, |p| one.contains(p)), PathBuf::from("/videos/clip_snip (2).mp4"));
        let three = set(&["/videos/clip_snip.mp4", "/videos/clip_snip (2).mp4", "/videos/clip_snip (3).mp4"]);
        assert_eq!(unique_output_path(input, |p| three.contains(p)), PathBuf::from("/videos/clip_snip (4).mp4"));
    }

    #[test]
    fn handles_gaps_dots_and_uppercase_ext() {
        let input = Path::new("/v/mi.video.final.MP4");
        let s = set(&["/v/mi.video.final_snip.mp4"]);
        assert_eq!(unique_output_path(input, |p| s.contains(p)), PathBuf::from("/v/mi.video.final_snip (2).mp4"));
    }

    #[test]
    fn never_returns_an_existing_path_on_real_disk() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("a.mp4");
        std::fs::write(&input, b"x").unwrap();
        for _ in 0..5 {
            let out = unique_output_path(&input, |p| p.exists());
            assert!(!out.exists());
            std::fs::write(&out, b"y").unwrap();
        }
        assert!(dir.path().join("a_snip (5).mp4").exists());
    }

    #[test]
    fn extension_helpers() {
        assert_eq!(ensure_mp4_extension(Path::new("/x/out")), PathBuf::from("/x/out.mp4"));
        assert_eq!(ensure_mp4_extension(Path::new("/x/out.MP4")), PathBuf::from("/x/out.MP4"));
        assert_eq!(ensure_mp4_extension(Path::new("/x/out.mov")), PathBuf::from("/x/out.mov.mp4"));
        assert!(is_mp4(Path::new("a.Mp4")));
        assert!(!is_mp4(Path::new("a.mov")));
        assert!(!is_mp4(Path::new("mp4")));
        assert_eq!(partial_path(Path::new("/x/o.mp4")), PathBuf::from("/x/o.mp4.snip-part"));
    }
}
