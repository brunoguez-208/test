//! Subtítulos automáticos con whisper.cpp.
//!
//! 1. El modelo multilingüe (large-v3-turbo cuantizado, ~550 MB) se baja la
//!    primera vez con `curl` (viene con Windows 10/11), con reanudación.
//! 2. El audio del proyecto (la misma mezcla que se exporta) se pasa a WAV de
//!    16 kHz mono.
//! 3. `whisper-cli` transcribe palabra por palabra (`-ml 1 -sow`); primero con
//!    GPU (Vulkan) y, si falla, de nuevo solo con CPU.
//! 4. Las palabras se agrupan en subtítulos cortos y legibles.

use crate::compile::{self, CompileOptions};
use crate::error::{AppError, ErrorKind};
use crate::project::{Cue, ExportSettings, OutputFormat, Project, Word};
use crate::project_export::{prepare_intermediates, ExportEnv};
use crate::runner::{self, JobControl};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const MODEL_FILE: &str = "ggml-large-v3-turbo-q5_0.bin";
pub const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
/// El archivo real pesa ~547 MB: menos que esto es una descarga cortada o una página de error.
pub const MODEL_MIN_BYTES: u64 = 400_000_000;

fn network_error(detail: impl Into<String>) -> AppError {
    AppError {
        kind: ErrorKind::Network,
        message: "No se pudo descargar el modelo de reconocimiento de voz. Revisá la conexión a internet y probá de nuevo; la descarga sigue donde quedó.".into(),
        detail: Some(detail.into()),
    }
}

/// ¿El archivo parece un modelo de whisper.cpp? (tamaño y firma "lmgg"/"ggml").
pub fn model_file_ok(path: &Path, min_bytes: u64) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if meta.len() < min_bytes {
        return false;
    }
    let mut magic = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| std::io::Read::read_exact(&mut f, &mut magic)).is_ok() && (&magic == b"lmgg" || &magic == b"ggml")
}

/// Último `Content-Length` de una respuesta de `curl -sIL` (después de las redirecciones).
pub fn parse_content_length(headers: &str) -> Option<u64> {
    headers
        .lines()
        .rev()
        .filter_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.trim().eq_ignore_ascii_case("content-length").then(|| v.trim().parse::<u64>().ok()).flatten()
        })
        .next()
}

/// Baja `url` a `dest` con curl (reanuda si quedó un `.partial`), avisando
/// (bytes recibidos, total si se conoce). Valida el modelo antes de dejarlo.
pub fn download_model(curl: &Path, url: &str, dest: &Path, min_bytes: u64, ctl: &JobControl, mut on_progress: impl FnMut(u64, Option<u64>)) -> Result<(), AppError> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::from_io(&e))?;
    }
    let partial = dest.with_extension("bin.partial");
    // Tamaño total (para la barra de progreso); si falla, igual se baja.
    let total = runner::run_capture(curl, &["-sIL".into(), "--max-time".into(), "20".into(), url.into()])
        .ok()
        .and_then(|h| parse_content_length(&String::from_utf8_lossy(&h)));
    let done = Arc::new(AtomicBool::new(false));
    let args: Vec<String> = vec![
        "-L".into(),
        "--fail".into(),
        "--retry".into(),
        "3".into(),
        "--retry-delay".into(),
        "2".into(),
        "-C".into(),
        "-".into(),
        "-sS".into(),
        "-o".into(),
        partial.to_string_lossy().into_owned(),
        url.into(),
    ];
    // Un hilo aparte mide el archivo parcial mientras curl corre.
    let (tx, rx) = std::sync::mpsc::channel::<u64>();
    let reporter = {
        let (done, partial) = (done.clone(), partial.clone());
        std::thread::spawn(move || {
            let mut last = u64::MAX;
            while !done.load(Ordering::SeqCst) {
                let s = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
                if s != last {
                    last = s;
                    let _ = tx.send(s);
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        })
    };
    let result = std::thread::scope(|scope| {
        let run = scope.spawn(|| runner::run_streaming(curl, &args, None, ctl, |_| {}));
        while !run.is_finished() {
            while let Ok(s) = rx.try_recv() {
                on_progress(s, total);
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        run.join().unwrap_or_else(|_| Err(AppError::new(ErrorKind::Unknown)))
    });
    done.store(true, Ordering::SeqCst);
    let _ = reporter.join();
    let (ok, tail) = result?;
    if !ok {
        return Err(network_error(tail));
    }
    let got = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
    on_progress(got, total.or(Some(got)));
    if !model_file_ok(&partial, min_bytes) {
        runner::remove_with_retry(&partial);
        return Err(network_error(format!("archivo inválido ({got} bytes)")));
    }
    std::fs::rename(&partial, dest).map_err(|e| AppError::from_io(&e))?;
    Ok(())
}

/// Mezcla de audio del proyecto (como en la exportación) a WAV 16 kHz mono.
pub fn extract_audio(env: &ExportEnv, p: &Project, wav: &Path, ctl: &JobControl, mut on_progress: impl FnMut(f64)) -> Result<f64, AppError> {
    if !compile::project_has_audio(p) {
        return Err(AppError::with_message(ErrorKind::NoAudio, "El proyecto no tiene audio para transcribir."));
    }
    let intermediates = prepare_intermediates(env, p, None, ctl, |pct| on_progress(pct * 0.3))?;
    let settings = ExportSettings { format: OutputFormat::Mp3, ..p.export.clone() };
    let c = compile::compile(p, &CompileOptions { settings: &settings, window: None, encoder: env.encoder, intermediates: &intermediates, raster: None })?;
    let aout = c.audio_out.clone().ok_or_else(|| AppError::new(ErrorKind::NoAudio))?;
    let partial = wav.with_extension("wav.partial");
    let mut a: Vec<String> = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"].iter().map(|s| s.to_string()).collect();
    a.extend(c.input_args());
    a.extend([
        "-filter_complex".into(),
        c.filter.clone(),
        "-map".into(),
        format!("[{aout}]"),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-stats_period".into(),
        "0.25".into(),
        "-nostats".into(),
        "-f".into(),
        "wav".into(),
        partial.to_string_lossy().into_owned(),
    ]);
    let dur = c.duration.max(0.01);
    runner::run_ffmpeg_to_file(env.tools, &a, &partial, wav, ctl, |s| on_progress(30.0 + 70.0 * (s.out_time / dur).min(1.0)))?;
    Ok(c.duration)
}

/// Argumentos de whisper-cli: palabra por palabra, salida JSON, progreso.
pub fn whisper_args(model: &Path, wav: &Path, out_base: &Path, language: Option<&str>, threads: usize, gpu: bool) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-m".into(),
        model.to_string_lossy().into_owned(),
        "-f".into(),
        wav.to_string_lossy().into_owned(),
        "-l".into(),
        language.filter(|l| valid_language(l)).unwrap_or("auto").into(),
        "-t".into(),
        threads.clamp(1, 16).to_string(),
        "-ml".into(),
        "1".into(),
        "-sow".into(),
        "-oj".into(),
        "-of".into(),
        out_base.to_string_lossy().into_owned(),
        "-pp".into(),
        "-np".into(),
    ];
    if !gpu {
        a.push("-ng".into());
    }
    a
}

/// Códigos de idioma que acepta whisper ("es", "en", "pt"…, o "auto").
pub fn valid_language(l: &str) -> bool {
    l == "auto" || (l.len() >= 2 && l.len() <= 3 && l.chars().all(|c| c.is_ascii_lowercase()))
}

/// "whisper_print_progress_callback: progress =  45%" → 45.
pub fn parse_progress(line: &str) -> Option<f64> {
    let rest = line.split("progress =").nth(1)?;
    rest.trim().trim_end_matches('%').trim().parse().ok()
}

#[derive(Deserialize)]
struct WJson {
    #[serde(default)]
    result: Option<WResult>,
    #[serde(default)]
    transcription: Vec<WSegment>,
}
#[derive(Deserialize)]
struct WResult {
    #[serde(default)]
    language: Option<String>,
}
#[derive(Deserialize)]
struct WSegment {
    offsets: WOffsets,
    text: String,
}
#[derive(Deserialize)]
struct WOffsets {
    from: i64,
    to: i64,
}

/// Palabras con tiempos (segundos) y el idioma detectado. Los trozos que no
/// empiezan con espacio se pegan a la palabra anterior (signos, sílabas).
pub fn parse_whisper_json(json: &str) -> Result<(Vec<Word>, Option<String>), AppError> {
    let w: WJson = serde_json::from_str(json).map_err(|e| AppError::with_detail(ErrorKind::Unknown, format!("JSON de whisper: {e}")))?;
    let mut words: Vec<Word> = vec![];
    for seg in w.transcription {
        let text = seg.text;
        if text.trim().is_empty() || is_noise(&text) {
            continue;
        }
        let (start, end) = (seg.offsets.from as f64 / 1000.0, seg.offsets.to as f64 / 1000.0);
        let glue = !text.starts_with(' ') && !words.is_empty();
        if glue {
            let last = words.last_mut().expect("hay palabras");
            last.text.push_str(text.trim_end());
            last.end = last.end.max(end);
        } else {
            words.push(Word { start, end: end.max(start + 0.01), text: text.trim().to_string() });
        }
    }
    Ok((words, w.result.and_then(|r| r.language)))
}

/// Marcas que whisper inventa en silencios: "[Música]", "(risas)", "♪".
fn is_noise(t: &str) -> bool {
    let t = t.trim();
    (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) || t.chars().all(|c| c == '♪' || c.is_whitespace())
}

pub const MAX_CUE_CHARS: usize = 42;
pub const MAX_CUE_SECS: f64 = 5.0;
pub const MAX_GAP_SECS: f64 = 0.7;

/// Agrupa palabras en subtítulos: hasta 42 caracteres y 5 s, cortando en las
/// pausas y después de un punto, signo de pregunta o exclamación.
pub fn group_words(words: &[Word], mut make_id: impl FnMut(usize) -> String) -> Vec<Cue> {
    let mut cues: Vec<Cue> = vec![];
    let mut cur: Vec<Word> = vec![];
    let flush = |cur: &mut Vec<Word>, cues: &mut Vec<Cue>, make_id: &mut dyn FnMut(usize) -> String| {
        if cur.is_empty() {
            return;
        }
        let text = cur.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
        let start = cur[0].start;
        let end = cur.last().map(|w| w.end).unwrap_or(start).max(start + 0.2);
        cues.push(Cue { id: make_id(cues.len()), start, end, text, words: std::mem::take(cur) });
    };
    for w in words {
        if let Some(last) = cur.last() {
            let len = cur.iter().map(|x| x.text.chars().count() + 1).sum::<usize>() + w.text.chars().count();
            let ends_sentence = last.text.ends_with(['.', '?', '!', '…']);
            if len > MAX_CUE_CHARS || w.end - cur[0].start > MAX_CUE_SECS || w.start - last.end > MAX_GAP_SECS || ends_sentence {
                flush(&mut cur, &mut cues, &mut make_id);
            }
        }
        cur.push(w.clone());
    }
    flush(&mut cur, &mut cues, &mut make_id);
    // Que un subtítulo no tape al siguiente.
    for i in 1..cues.len() {
        let next_start = cues[i].start;
        if cues[i - 1].end > next_start {
            cues[i - 1].end = next_start.max(cues[i - 1].start + 0.05);
        }
    }
    cues
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub cues: Vec<Cue>,
    pub language: Option<String>,
    /// ¿Se usó la GPU?
    pub gpu: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TranscribeStage {
    Audio,
    Transcribing,
}

/// Corre whisper-cli (GPU y, si falla, CPU) y arma los subtítulos.
pub fn run_whisper(whisper: &Path, model: &Path, wav: &Path, work: &Path, language: Option<&str>, ctl: &JobControl, mut on_progress: impl FnMut(f64)) -> Result<Transcript, AppError> {
    let out_base: PathBuf = work.join("transcript");
    let json = out_base.with_extension("json");
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let mut last_err = String::new();
    for gpu in [true, false] {
        let _ = std::fs::remove_file(&json);
        let mut used_gpu = false;
        let (ok, tail) = runner::run_streaming(whisper, &whisper_args(model, wav, &out_base, language, threads, gpu), whisper.parent(), ctl, |line| {
            if let Some(p) = parse_progress(line) {
                on_progress(p);
            }
            if line.contains("whisper_backend_init_gpu: using") {
                used_gpu = true;
            }
        })?;
        if ok {
            if let Ok(text) = std::fs::read_to_string(&json) {
                let (words, lang) = parse_whisper_json(&text)?;
                let mut n = 0;
                let cues = group_words(&words, |_| {
                    n += 1;
                    format!("w{n}")
                });
                return Ok(Transcript { cues, language: lang, gpu: gpu && used_gpu });
            }
        }
        last_err = tail;
    }
    Err(AppError {
        kind: ErrorKind::Unknown,
        message: "No se pudieron generar los subtítulos. Probá de nuevo; si sigue fallando, importá un .srt.".into(),
        detail: Some(last_err),
    })
}

/// Dónde está whisper-cli dentro de la instalación.
pub fn whisper_exe(dir: &Path) -> PathBuf {
    dir.join(if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" })
}

/// El programa curl del sistema.
pub fn curl_program() -> PathBuf {
    if cfg!(windows) {
        let sys = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let p = sys.join("System32").join("curl.exe");
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("curl")
}

/// Usado por los tests y la app: el modelo vive en `data/models`.
pub fn model_path(data_dir: &Path) -> PathBuf {
    data_dir.join("models").join(MODEL_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(start: f64, end: f64, text: &str) -> Word {
        Word { start, end, text: text.into() }
    }

    #[test]
    fn args_for_gpu_and_cpu() {
        let a = whisper_args(Path::new("/m.bin"), Path::new("/a.wav"), Path::new("/w/t"), Some("es"), 32, true);
        assert_eq!(a[..6], ["-m", "/m.bin", "-f", "/a.wav", "-l", "es"]);
        assert!(a.contains(&"-sow".to_string()) && a.contains(&"-oj".to_string()) && !a.contains(&"-ng".to_string()));
        assert_eq!(a[a.iter().position(|x| x == "-t").unwrap() + 1], "16");
        let b = whisper_args(Path::new("/m.bin"), Path::new("/a.wav"), Path::new("/w/t"), Some("--evil"), 4, false);
        assert_eq!(b[5], "auto");
        assert_eq!(b.last().unwrap(), "-ng");
    }

    #[test]
    fn progress_and_headers() {
        assert_eq!(parse_progress("whisper_print_progress_callback: progress =  45%"), Some(45.0));
        assert_eq!(parse_progress("otra cosa"), None);
        let h = "HTTP/2 302\r\nlocation: x\r\ncontent-length: 0\r\n\r\nHTTP/2 200\r\nContent-Length: 574041195\r\n";
        assert_eq!(parse_content_length(h), Some(574041195));
    }

    #[test]
    fn parses_json_and_glues_pieces() {
        let json = r#"{"result":{"language":"es"},"transcription":[
            {"offsets":{"from":0,"to":400},"text":" Hola"},
            {"offsets":{"from":400,"to":450},"text":","},
            {"offsets":{"from":500,"to":900},"text":" ¿qué"},
            {"offsets":{"from":900,"to":1300},"text":" tal?"},
            {"offsets":{"from":1300,"to":2000},"text":" [Música]"}
        ]}"#;
        let (words, lang) = parse_whisper_json(json).unwrap();
        assert_eq!(lang.as_deref(), Some("es"));
        assert_eq!(words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), vec!["Hola,", "¿qué", "tal?"]);
        assert_eq!(words[0].end, 0.45);
    }

    #[test]
    fn groups_by_length_pauses_and_sentences() {
        let words = vec![
            w(0.0, 0.3, "Hola"),
            w(0.3, 0.6, "a"),
            w(0.6, 1.0, "todos."),
            w(1.1, 1.4, "Esto"),
            w(1.4, 1.6, "es"),
            w(1.6, 2.0, "una"),
            w(2.0, 2.4, "prueba"),
            w(3.5, 3.8, "después"),
            w(3.8, 4.0, "de"),
            w(4.0, 4.3, "una"),
            w(4.3, 4.8, "pausa"),
        ];
        let mut n = 0;
        let cues = group_words(&words, |_| {
            n += 1;
            format!("c{n}")
        });
        assert_eq!(cues.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(), vec!["Hola a todos.", "Esto es una prueba", "después de una pausa"]);
        assert_eq!(cues[0].words.len(), 3);
        assert_eq!((cues[1].start, cues[1].end), (1.1, 2.4));
        assert_eq!(cues[2].id, "c3");
        // Un discurso largo sin pausas se corta en ≤ 42 caracteres.
        let long: Vec<Word> = (0..30).map(|i| w(i as f64 * 0.2, i as f64 * 0.2 + 0.2, "palabra")).collect();
        let cues = group_words(&long, |i| format!("x{i}"));
        assert!(cues.iter().all(|c| c.text.chars().count() <= MAX_CUE_CHARS));
        assert!(cues.windows(2).all(|p| p[0].end <= p[1].start));
    }

    #[test]
    fn model_validation_and_download_with_file_url() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("modelo.bin");
        let mut bytes = b"lmgg".to_vec();
        bytes.extend(vec![7u8; 300_000]);
        std::fs::write(&src, &bytes).unwrap();
        assert!(model_file_ok(&src, 1000));
        assert!(!model_file_ok(&src, 10_000_000));
        let bad = tmp.path().join("malo.bin");
        std::fs::write(&bad, vec![0u8; 5000]).unwrap();
        assert!(!model_file_ok(&bad, 1000));
        // Descarga real con curl (file://), con progreso y validación.
        let dest = tmp.path().join("models").join(MODEL_FILE);
        let mut seen = vec![];
        let url = format!("file://{}", src.display());
        download_model(&curl_program(), &url, &dest, 1000, &JobControl::new(), |got, _| seen.push(got)).unwrap();
        assert!(model_file_ok(&dest, 1000));
        assert_eq!(*seen.last().unwrap(), bytes.len() as u64);
        // Una "descarga" que no es un modelo se descarta.
        let dest2 = tmp.path().join("models").join("otro.bin");
        let e = download_model(&curl_program(), &format!("file://{}", bad.display()), &dest2, 1000, &JobControl::new(), |_, _| {}).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Network);
        assert!(!dest2.exists());
    }
}
