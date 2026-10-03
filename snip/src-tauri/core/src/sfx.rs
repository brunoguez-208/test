//! Pack de sonidos incluido: lectura mínima de WAV PCM (duración).

/// Duración de un WAV PCM a partir de su encabezado (busca los chunks `fmt ` y `data`).
pub fn wav_duration(b: &[u8]) -> Option<f64> {
    if b.len() < 12 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return None;
    }
    let (mut pos, mut byte_rate, mut data) = (12usize, 0u32, None);
    while pos + 8 <= b.len() {
        let id = &b[pos..pos + 4];
        let size = u32::from_le_bytes(b[pos + 4..pos + 8].try_into().ok()?) as usize;
        if id == b"fmt " && pos + 20 <= b.len() {
            byte_rate = u32::from_le_bytes(b[pos + 16..pos + 20].try_into().ok()?);
        } else if id == b"data" {
            data = Some(size);
        }
        pos += 8 + size + (size & 1);
    }
    (byte_rate > 0).then(|| data.unwrap_or(0) as f64 / byte_rate as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_header() {
        let mut w = Vec::new();
        w.extend(b"RIFF");
        w.extend(0u32.to_le_bytes());
        w.extend(b"WAVEfmt ");
        w.extend(16u32.to_le_bytes());
        w.extend(1u16.to_le_bytes());
        w.extend(2u16.to_le_bytes());
        w.extend(48_000u32.to_le_bytes());
        w.extend(192_000u32.to_le_bytes());
        w.extend(4u16.to_le_bytes());
        w.extend(16u16.to_le_bytes());
        w.extend(b"data");
        w.extend(96_000u32.to_le_bytes());
        assert_eq!(wav_duration(&w), Some(0.5));
        assert_eq!(wav_duration(b"nope"), None);
    }

    #[test]
    fn bundled_pack_is_present_and_licensed() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../sfx");
        let lic = std::fs::read_to_string(dir.join("LICENSE.txt")).unwrap();
        assert!(lic.contains("CC0"));
        let mut n = 0;
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            if e.path().extension().is_some_and(|x| x == "wav") {
                let name = e.file_name().to_string_lossy().into_owned();
                assert!(lic.contains(&name), "{name} figura en la licencia");
                let d = wav_duration(&std::fs::read(e.path()).unwrap()).unwrap();
                assert!(d > 0.02 && d < 5.0, "{name}: {d}");
                n += 1;
            }
        }
        assert!(n >= 8, "{n} sonidos");
    }
}
