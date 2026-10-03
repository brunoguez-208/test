//! Estado global de la app: rutas de FFmpeg, trabajos en curso y caché del encoder.

use serde::{Deserialize, Serialize};
use snip_core::encoder::Encoder;
use snip_core::runner::{JobControl, Tools};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const ENCODER_CACHE_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const PROXY_TTL: Duration = Duration::from_secs(3 * 24 * 3600);

pub struct AppState {
    pub tools: Tools,
    pub cache_dir: PathBuf,
    pub launch_file: Mutex<Option<String>>,
    pub material: Mutex<String>,
    pub export_job: Mutex<Option<JobControl>>,
    pub proxy_job: Mutex<Option<JobControl>>,
    pub thumbs_job: Mutex<Option<JobControl>>,
    /// Encoder detectado. El Mutex también serializa la detección.
    encoder: Mutex<Option<Encoder>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncoderCache {
    encoder: Encoder,
    ffmpeg_size: u64,
    detected_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Busca ffmpeg/ffprobe junto al ejecutable (así los deja `bundle.externalBin`).
pub fn resolve_tools() -> Tools {
    if let Some(dir) = std::env::var_os("SNIP_FFMPEG_DIR") {
        let dir = PathBuf::from(dir);
        return Tools {
            ffmpeg: dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)),
            ffprobe: dir.join(format!("ffprobe{}", std::env::consts::EXE_SUFFIX)),
        };
    }
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    Tools {
        ffmpeg: dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)),
        ffprobe: dir.join(format!("ffprobe{}", std::env::consts::EXE_SUFFIX)),
    }
}

impl AppState {
    pub fn new(tools: Tools, cache_dir: PathBuf, launch_file: Option<String>) -> Self {
        let _ = std::fs::create_dir_all(cache_dir.join("proxies"));
        Self {
            tools,
            cache_dir,
            launch_file: Mutex::new(launch_file),
            material: Mutex::new("none".into()),
            export_job: Mutex::new(None),
            proxy_job: Mutex::new(None),
            thumbs_job: Mutex::new(None),
            encoder: Mutex::new(None),
        }
    }

    fn ffmpeg_size(&self) -> u64 {
        std::fs::metadata(&self.tools.ffmpeg).map(|m| m.len()).unwrap_or(0)
    }

    fn cache_file(&self) -> PathBuf {
        self.cache_dir.join("encoder.json")
    }

    fn read_cache(&self) -> Option<Encoder> {
        let text = std::fs::read_to_string(self.cache_file()).ok()?;
        let c: EncoderCache = serde_json::from_str(&text).ok()?;
        let fresh = now_secs().saturating_sub(c.detected_at) < ENCODER_CACHE_TTL.as_secs();
        (fresh && c.ffmpeg_size == self.ffmpeg_size()).then_some(c.encoder)
    }

    fn write_cache(&self, encoder: Encoder) {
        let c = EncoderCache { encoder, ffmpeg_size: self.ffmpeg_size(), detected_at: now_secs() };
        if let Ok(text) = serde_json::to_string(&c) {
            let _ = std::fs::write(self.cache_file(), text);
        }
    }

    /// Encoder a usar: memoria → caché en disco → detección real (encode de 1 frame).
    pub fn encoder(&self) -> Encoder {
        let mut g = match self.encoder.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(e) = *g {
            return e;
        }
        let e = self.read_cache().unwrap_or_else(|| {
            let e = snip_core::detect_encoder(&self.tools);
            self.write_cache(e);
            e
        });
        *g = Some(e);
        e
    }

    /// Un encoder por hardware falló en una exportación real: desde ahora, libx264.
    pub fn mark_encoder_failed(&self, failed: Encoder) {
        if failed == Encoder::Libx264 {
            return;
        }
        if let Ok(mut g) = self.encoder.lock() {
            *g = Some(Encoder::Libx264);
        }
        self.write_cache(Encoder::Libx264);
    }

    /// Ruta del proxy de preview: depende de la ruta, el tamaño y la fecha del original.
    pub fn proxy_path_for(&self, input: &Path) -> PathBuf {
        let mut h = DefaultHasher::new();
        input.to_string_lossy().to_lowercase().hash(&mut h);
        if let Ok(m) = std::fs::metadata(input) {
            m.len().hash(&mut h);
            if let Ok(t) = m.modified() {
                t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0).hash(&mut h);
            }
        }
        self.cache_dir.join("proxies").join(format!("{:016x}.mp4", h.finish()))
    }

    /// Borra proxies viejos para no llenar el disco.
    pub fn cleanup_proxies(&self) {
        let Ok(entries) = std::fs::read_dir(self.cache_dir.join("proxies")) else { return };
        for e in entries.flatten() {
            let old = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > PROXY_TTL);
            let partial = e.file_name().to_string_lossy().ends_with(".snip-part");
            if old || partial {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// Primer argumento que parezca un archivo (lo que manda "Abrir con" o el menú contextual).
pub fn file_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|a| !a.starts_with('-') && !a.trim().is_empty())
}
