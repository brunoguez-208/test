//! Estado global de la app: rutas de FFmpeg, trabajos en curso, caché del
//! encoder, almacenamiento de proyectos y cola de exportación.

use serde::{Deserialize, Serialize};
use snip_core::encoder::Encoder;
use snip_core::queue::ExportQueue;
use snip_core::runner::{JobControl, Tools};
use snip_core::store::Store;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const ENCODER_CACHE_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const PROXY_TTL: Duration = Duration::from_secs(3 * 24 * 3600);
/// Los intermedios de la etapa pesada se borran si nadie los usó en 14 días.
const HEAVY_TTL: Duration = Duration::from_secs(14 * 24 * 3600);

pub struct AppState {
    pub tools: Tools,
    pub cache_dir: PathBuf,
    pub store: Store,
    pub launch_file: Mutex<Option<String>>,
    pub material: Mutex<String>,
    pub proxy_job: Mutex<Option<JobControl>>,
    /// Miniaturas por grupo (cada pedido nuevo de un grupo cancela el anterior).
    pub thumbs_jobs: Mutex<HashMap<String, JobControl>>,
    /// Etapa pesada para el preview, por clave del clip.
    pub heavy_jobs: Mutex<HashMap<String, JobControl>>,
    pub waveforms: Mutex<HashMap<String, std::sync::Arc<Vec<u8>>>>,
    pub queue: OnceLock<ExportQueue>,
    /// Datos de la app (proyectos, recientes, modelos).
    pub data_dir: PathBuf,
    /// Carpeta de whisper-cli y sus DLL (recursos de la instalación).
    pub whisper_dir: PathBuf,
    pub model_job: Mutex<Option<JobControl>>,
    pub transcribe_job: Mutex<Option<JobControl>>,
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

/// Busca ffmpeg/ffprobe en la carpeta `ffmpeg\` de la instalación (build
/// "shared": comparten las DLL que están al lado). Si no, junto al ejecutable.
pub fn resolve_tools() -> Tools {
    if let Some(dir) = std::env::var_os("SNIP_FFMPEG_DIR") {
        let dir = PathBuf::from(dir);
        return Tools {
            ffmpeg: dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)),
            ffprobe: dir.join(format!("ffprobe{}", std::env::consts::EXE_SUFFIX)),
        };
    }
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default();
    let sub = exe_dir.join("ffmpeg");
    let dir = if sub.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)).is_file() {
        sub
    } else if cfg!(debug_assertions) && !exe_dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)).is_file() {
        // Desarrollo: los binarios de src-tauri/binaries/ffmpeg.
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg")
    } else {
        exe_dir
    };
    Tools {
        ffmpeg: dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)),
        ffprobe: dir.join(format!("ffprobe{}", std::env::consts::EXE_SUFFIX)),
    }
}

/// whisper-cli: junto al ejecutable, en `whisper/` (así lo deja el instalador).
pub fn resolve_whisper_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("SNIP_WHISPER_DIR") {
        return PathBuf::from(dir);
    }
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)).unwrap_or_default();
    let installed = exe_dir.join("whisper");
    if installed.is_dir() {
        return installed;
    }
    // Desarrollo: los binarios de src-tauri/binaries/whisper.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("whisper")
}

impl AppState {
    pub fn new(tools: Tools, cache_dir: PathBuf, data_dir: PathBuf, launch_file: Option<String>) -> Self {
        for d in ["proxies", "heavy", "tmp", "raster"] {
            let _ = std::fs::create_dir_all(cache_dir.join(d));
        }
        Self {
            tools,
            store: Store::new(&data_dir),
            whisper_dir: resolve_whisper_dir(),
            data_dir,
            model_job: Mutex::new(None),
            transcribe_job: Mutex::new(None),
            cache_dir,
            launch_file: Mutex::new(launch_file),
            material: Mutex::new("none".into()),
            proxy_job: Mutex::new(None),
            thumbs_jobs: Mutex::new(HashMap::new()),
            heavy_jobs: Mutex::new(HashMap::new()),
            waveforms: Mutex::new(HashMap::new()),
            queue: OnceLock::new(),
            encoder: Mutex::new(None),
        }
    }

    pub fn heavy_dir(&self) -> PathBuf {
        self.cache_dir.join("heavy")
    }
    pub fn temp_dir(&self) -> PathBuf {
        self.cache_dir.join("tmp")
    }
    pub fn raster_dir(&self) -> PathBuf {
        self.cache_dir.join("raster")
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

    /// Borra proxies, intermedios y temporales viejos para no llenar el disco.
    pub fn cleanup_caches(&self) {
        let sweep = |dir: PathBuf, ttl: Duration| {
            let Ok(entries) = std::fs::read_dir(dir) else { return };
            for e in entries.flatten() {
                let old = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age > ttl);
                let partial = e.file_name().to_string_lossy().ends_with(".snip-part");
                if old || partial {
                    let _ = if e.path().is_dir() { std::fs::remove_dir_all(e.path()) } else { std::fs::remove_file(e.path()) };
                }
            }
        };
        sweep(self.cache_dir.join("proxies"), PROXY_TTL);
        sweep(self.heavy_dir(), HEAVY_TTL);
        sweep(self.temp_dir(), Duration::from_secs(24 * 3600));
        sweep(self.raster_dir(), Duration::from_secs(24 * 3600));
    }
}

/// Primer argumento que parezca un archivo (lo que manda "Abrir con" o el menú contextual).
pub fn file_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|a| !a.starts_with('-') && !a.trim().is_empty())
}
