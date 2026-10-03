//! Ejecución de FFmpeg / FFprobe: sin ventana de consola, con progreso,
//! cancelación y limpieza del archivo parcial.

use crate::error::{classify_ffmpeg_stderr, AppError, ErrorKind};
use crate::progress::{ProgressParser, ProgressSample};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Rutas a los binarios de FFmpeg (sidecars en la app, o los del sistema en tests).
#[derive(Debug, Clone)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

/// `CREATE_NO_WINDOW`: que no parpadee una consola en Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn command(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

fn spawn_error(e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::with_detail(ErrorKind::FfmpegMissing, e.to_string())
    } else {
        AppError::from_io(&e)
    }
}

/// Corre un proceso y devuelve stdout. Si falla, clasifica el stderr.
pub fn run_capture(program: &Path, args: &[String]) -> Result<Vec<u8>, AppError> {
    let out = command(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(spawn_error)?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        let err = String::from_utf8_lossy(&out.stderr).into_owned();
        crate::log::error(&format!("{} falló: {}", program.display(), err.trim()));
        Err(AppError::with_detail(classify_ffmpeg_stderr(&err), err))
    }
}

/// Corre un proceso y devuelve si terminó bien (para el probe de encoders).
pub fn run_ok(program: &Path, args: &[String]) -> bool {
    command(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Control de un trabajo en curso: permite cancelarlo desde otro hilo.
#[derive(Clone, Default)]
pub struct JobControl {
    cancelled: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

impl JobControl {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Marca el trabajo como cancelado y mata el proceso si está corriendo.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
    }
}

/// Junta las últimas líneas de stderr sin bloquear el proceso.
fn drain_stderr(stderr: impl Read + Send + 'static) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = String::new();
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            buf.push_str(&line);
            buf.push('\n');
            if buf.len() > 64 * 1024 {
                let cut = buf.len() - 32 * 1024;
                let cut = (cut..buf.len()).find(|i| buf.is_char_boundary(*i)).unwrap_or(0);
                buf.drain(..cut);
            }
        }
        buf
    })
}

/// Argumentos como se escribirían en una consola (para el log).
pub fn quote_args(args: &[String]) -> String {
    args.iter()
        .map(|a| if a.is_empty() || a.contains([' ', ';', '[', '"']) { format!("\"{}\"", a.replace('"', "\\\"")) } else { a.clone() })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Corre FFmpeg (opcionalmente en `cwd`) reportando el progreso de `-progress pipe:1`.
/// Devuelve el stderr si terminó bien; si falla o se cancela, el error ya clasificado.
pub fn run_ffmpeg(
    tools: &Tools,
    args: &[String],
    cwd: Option<&Path>,
    job: &JobControl,
    mut on_progress: impl FnMut(ProgressSample),
) -> Result<String, AppError> {
    if job.is_cancelled() {
        return Err(AppError::new(ErrorKind::Cancelled));
    }
    let mut cmd = command(&tools.ffmpeg);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd.spawn().map_err(spawn_error)?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let stderr_handle = drain_stderr(stderr);

    // Guardamos el proceso para que `cancel()` lo pueda matar.
    if let Ok(mut g) = job.child.lock() {
        *g = Some(child);
    }
    // Carrera: si cancelaron entre el spawn y el guardado, matamos ahora.
    if job.is_cancelled() {
        job.cancel();
    }

    let mut parser = ProgressParser::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(sample) = parser.feed(&line) {
            on_progress(sample);
        }
    }

    let status = {
        let mut g = job.child.lock().map_err(|_| AppError::new(ErrorKind::Unknown))?;
        let mut child = g.take().expect("child guardado");
        child.wait().map_err(|e| AppError::from_io(&e))?
    };
    let stderr_text = stderr_handle.join().unwrap_or_default();
    if job.is_cancelled() {
        return Err(AppError::new(ErrorKind::Cancelled));
    }
    if !status.success() {
        crate::log::error(&format!("ffmpeg falló ({status})\n  comando: ffmpeg {}\n  stderr: {}", quote_args(args), stderr_text.trim().replace('\n', "\n          ")));
        return Err(AppError::with_detail(classify_ffmpeg_stderr(&stderr_text), stderr_text));
    }
    Ok(stderr_text)
}

/// Corre cualquier programa (curl, whisper) registrándolo en `job` para poder
/// cancelarlo. Cada línea de stderr pasa por `on_line`; stdout se descarta.
/// Devuelve si terminó bien y las últimas líneas de stderr.
pub fn run_streaming(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
    job: &JobControl,
    mut on_line: impl FnMut(&str),
) -> Result<(bool, String), AppError> {
    if job.is_cancelled() {
        return Err(AppError::new(ErrorKind::Cancelled));
    }
    let mut cmd = command(program);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::with_detail(ErrorKind::Unknown, format!("No se encontró {}", program.display()))
        } else {
            AppError::from_io(&e)
        }
    })?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    // stdout puede ser largo (whisper imprime la transcripción): se drena aparte.
    let drain = std::thread::spawn(move || {
        let mut sink = Vec::new();
        let _ = BufReader::new(stdout).read_to_end(&mut sink);
    });
    if let Ok(mut g) = job.child.lock() {
        *g = Some(child);
    }
    if job.is_cancelled() {
        job.cancel();
    }
    let mut tail = String::new();
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        on_line(&line);
        tail.push_str(&line);
        tail.push('\n');
        if tail.len() > 64 * 1024 {
            let cut = tail.len() - 32 * 1024;
            let cut = (cut..tail.len()).find(|i| tail.is_char_boundary(*i)).unwrap_or(0);
            tail.drain(..cut);
        }
    }
    let _ = drain.join();
    let status = {
        let mut g = job.child.lock().map_err(|_| AppError::new(ErrorKind::Unknown))?;
        let mut child = g.take().expect("child guardado");
        child.wait().map_err(|e| AppError::from_io(&e))?
    };
    if job.is_cancelled() {
        return Err(AppError::new(ErrorKind::Cancelled));
    }
    Ok((status.success(), tail))
}

/// Borra un archivo con reintentos (en Windows el handle puede tardar en liberarse).
pub fn remove_with_retry(path: &Path) {
    for _ in 0..20 {
        match std::fs::remove_file(path) {
            Ok(()) => return,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    }
}

/// Corre FFmpeg escribiendo en `partial` y reporta el progreso. Si se cancela o
/// falla, borra `partial`. Si sale bien, lo renombra a `final_path`.
pub fn run_ffmpeg_to_file(
    tools: &Tools,
    args: &[String],
    partial: &Path,
    final_path: &Path,
    job: &JobControl,
    on_progress: impl FnMut(ProgressSample),
) -> Result<(), AppError> {
    run_ffmpeg_to_file_in(tools, args, None, partial, final_path, job, on_progress)
}

/// Igual que [`run_ffmpeg_to_file`], corriendo FFmpeg en `cwd`.
pub fn run_ffmpeg_to_file_in(
    tools: &Tools,
    args: &[String],
    cwd: Option<&Path>,
    partial: &Path,
    final_path: &Path,
    job: &JobControl,
    on_progress: impl FnMut(ProgressSample),
) -> Result<(), AppError> {
    let result = run_ffmpeg(tools, args, cwd, job, on_progress);
    let cleanup = || remove_with_retry(partial);
    if let Err(e) = result {
        cleanup();
        return Err(e);
    }
    let size = std::fs::metadata(partial).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        cleanup();
        return Err(AppError::with_detail(ErrorKind::Unknown, "FFmpeg no generó datos"));
    }
    std::fs::rename(partial, final_path).map_err(|e| {
        cleanup();
        AppError::from_io(&e)
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_binary_is_reported_as_ffmpeg_missing() {
        let err = run_capture(Path::new("/definitivamente/no/existe/ffprobe"), &[]).unwrap_err();
        assert_eq!(err.kind, ErrorKind::FfmpegMissing);
        assert!(!run_ok(Path::new("/no/existe"), &[]));
    }

    #[test]
    fn streaming_reports_stderr_lines() {
        let job = JobControl::new();
        let mut lines = vec![];
        let (ok, tail) = run_streaming(Path::new("sh"), &["-c".into(), "echo uno >&2; echo salida; echo dos >&2".into()], None, &job, |l| lines.push(l.to_string())).unwrap();
        assert!(ok);
        assert_eq!(lines, vec!["uno", "dos"]);
        assert!(tail.contains("dos"));
        let (ok, _) = run_streaming(Path::new("sh"), &["-c".into(), "exit 3".into()], None, &job, |_| {}).unwrap();
        assert!(!ok);
    }

    #[test]
    fn cancel_before_start_short_circuits() {
        let job = JobControl::new();
        job.cancel();
        let tools = Tools { ffmpeg: "/no/existe".into(), ffprobe: "/no/existe".into() };
        let e = run_ffmpeg_to_file(&tools, &[], Path::new("/tmp/x"), Path::new("/tmp/y"), &job, |_| {}).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Cancelled);
    }
}
