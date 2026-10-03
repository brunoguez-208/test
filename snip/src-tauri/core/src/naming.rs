//! Nombres de salida: `nombre_snip.mp4`, y si existe `nombre_snip (2).mp4`, etc.
//! También: qué extensiones abre Snip.

use std::path::{Path, PathBuf};

pub const SUFFIX: &str = "_snip";

/// Videos que Snip abre (MP4, MOV, MKV y WebM).
pub const VIDEO_EXTS: &[&str] = &["mp4", "mov", "mkv", "webm"];
/// Audio para la pista de música.
pub const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];
/// Imágenes para logos, marcas de agua y PiP.
pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp"];
pub const PROJECT_EXT: &str = "snip";

fn ext_of(p: &Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
}

pub fn is_video(p: &Path) -> bool {
    ext_of(p).is_some_and(|e| VIDEO_EXTS.contains(&e.as_str()))
}
pub fn is_audio(p: &Path) -> bool {
    ext_of(p).is_some_and(|e| AUDIO_EXTS.contains(&e.as_str()))
}
pub fn is_image(p: &Path) -> bool {
    ext_of(p).is_some_and(|e| IMAGE_EXTS.contains(&e.as_str()))
}
pub fn is_project(p: &Path) -> bool {
    ext_of(p).is_some_and(|e| e == PROJECT_EXT)
}

/// Primer nombre libre junto al original. `exists` se inyecta para poder testear.
pub fn unique_output_path(input: &Path, exists: impl Fn(&Path) -> bool) -> PathBuf {
    unique_output_path_ext(input, "mp4", exists)
}

/// Igual que [`unique_output_path`] con otra extensión (`clip_snip.webm`).
pub fn unique_output_path_ext(input: &Path, ext: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let dir = input.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "video".into());
    unique_in_dir_ext(&dir, &format!("{stem}{SUFFIX}"), ext, exists)
}

/// Primer `base.mp4`, `base (2).mp4`, `base (3).mp4`… que no exista en `dir`.
pub fn unique_in_dir(dir: &Path, base: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    unique_in_dir_ext(dir, base, "mp4", exists)
}

pub fn unique_in_dir_ext(dir: &Path, base: &str, ext: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(format!("{base}.{ext}"));
    if !exists(&first) {
        return first;
    }
    for n in 2..100_000u32 {
        let p = dir.join(format!("{base} ({n}).{ext}"));
        if !exists(&p) {
            return p;
        }
    }
    dir.join(format!("{base} ({}).{ext}", std::process::id()))
}

/// Asegura la extensión .mp4 (para "Guardar como…").
pub fn ensure_mp4_extension(p: &Path) -> PathBuf {
    ensure_extension(p, "mp4")
}

/// Asegura una extensión (sin importar mayúsculas).
pub fn ensure_extension(p: &Path, ext: &str) -> PathBuf {
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) if e.eq_ignore_ascii_case(ext) => p.to_path_buf(),
        _ => {
            let mut s = p.as_os_str().to_owned();
            s.push(".");
            s.push(ext);
            PathBuf::from(s)
        }
    }
}

/// `.snip` que acompaña a un video exportado: `clip_snip.mp4` → `clip_snip.snip`.
pub fn project_file_for(video: &Path) -> PathBuf {
    video.with_extension(PROJECT_EXT)
}

/// Archivo temporal donde FFmpeg escribe; se renombra al final si todo salió bien.
pub fn partial_path(final_path: &Path) -> PathBuf {
    let mut s = final_path.as_os_str().to_owned();
    s.push(".snip-part");
    PathBuf::from(s)
}

/// ¿El path tiene extensión .mp4 (sin importar mayúsculas)?
pub fn is_mp4(p: &Path) -> bool {
    ext_of(p).is_some_and(|e| e == "mp4")
}

/// Nombre de archivo seguro (sin caracteres que Windows no acepta).
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '_' } else { c })
        .collect();
    let t = cleaned.trim().trim_end_matches('.').trim();
    if t.is_empty() {
        "video".into()
    } else {
        t.chars().take(120).collect()
    }
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
    fn other_extensions() {
        let input = Path::new("/v/clip.mkv");
        let s = set(&["/v/clip_snip.webm"]);
        assert_eq!(unique_output_path_ext(input, "webm", |p| s.contains(p)), PathBuf::from("/v/clip_snip (2).webm"));
        assert_eq!(unique_output_path_ext(input, "gif", |p| s.contains(p)), PathBuf::from("/v/clip_snip.gif"));
        assert_eq!(project_file_for(Path::new("/v/clip_snip (2).mp4")), PathBuf::from("/v/clip_snip (2).snip"));
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
        assert_eq!(ensure_extension(Path::new("/x/out.GIF"), "gif"), PathBuf::from("/x/out.GIF"));
        assert!(is_mp4(Path::new("a.Mp4")));
        assert!(!is_mp4(Path::new("a.mov")));
        assert!(!is_mp4(Path::new("mp4")));
        assert!(is_video(Path::new("a.MOV")) && is_video(Path::new("a.mkv")) && is_video(Path::new("a.webm")));
        assert!(!is_video(Path::new("a.avi")));
        assert!(is_audio(Path::new("a.mp3")) && is_image(Path::new("logo.PNG")) && is_project(Path::new("x.snip")));
        assert_eq!(partial_path(Path::new("/x/o.mp4")), PathBuf::from("/x/o.mp4.snip-part"));
    }

    #[test]
    fn safe_file_names() {
        assert_eq!(sanitize_file_name("Viaje: día 1/2?"), "Viaje_ día 1_2_");
        assert_eq!(sanitize_file_name("  ..  "), "video");
    }
}

/// Texto de un archivo de subtítulos: UTF-8 (con o sin BOM) o, si no lo es,
/// Windows-1252/Latin-1 (muy común en .srt en castellano).
pub fn decode_subtitle_text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.trim_start_matches('\u{feff}').to_string(),
        Err(_) => bytes
            .iter()
            .map(|&b| match b {
                0x80 => '€',
                0x91 => '‘',
                0x92 => '’',
                0x93 => '“',
                0x94 => '”',
                0x96 => '–',
                0x97 => '—',
                0x85 => '…',
                _ => b as char,
            })
            .collect(),
    }
}

#[cfg(test)]
mod subtitle_text_tests {
    use super::decode_subtitle_text;

    #[test]
    fn utf8_and_latin1() {
        assert_eq!(decode_subtitle_text("\u{feff}¿Qué?".as_bytes()), "¿Qué?");
        assert_eq!(decode_subtitle_text(&[0xBF, b'Q', b'u', 0xE9, b'?', 0x85]), "¿Qué?…");
    }
}
