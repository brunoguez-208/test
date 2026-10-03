//! Herramienta de desarrollo: usa el motor de exportación desde la línea de
//! comandos (tests de paridad preview/exportación).
//!
//!   snip_render probe <archivo> <id>     → MediaRef en JSON
//!   snip_render export <job.json> <dir>  → exporta con libx264 (dir = caché/temporales)
//!
//! FFmpeg se busca en `SNIP_FFMPEG_DIR` (por defecto /opt/ffmpeg9/bin).

use snip_core::encoder::Encoder;
use snip_core::project_export::{export_project, ExportEnv, ExportJob};
use snip_core::runner::{JobControl, Tools};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn tools() -> Tools {
    let dir = std::env::var_os("SNIP_FFMPEG_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/opt/ffmpeg9/bin"));
    let exe = |n: &str| dir.join(if cfg!(windows) { format!("{n}.exe") } else { n.to_string() });
    Tools { ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe") }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let tools = tools();
    let result = match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["probe", file, id] => snip_core::probe_media(&tools, Path::new(file), id)
            .map(|m| serde_json::to_string(&m).unwrap_or_default())
            .map_err(|e| format!("{e:?}")),
        ["export", job, dir] => (|| {
            let raw = std::fs::read_to_string(job).map_err(|e| e.to_string())?;
            let job: ExportJob = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            let dir = Path::new(dir);
            let (heavy, tmp) = (dir.join("cache"), dir.join("tmp"));
            std::fs::create_dir_all(&heavy).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
            let env = ExportEnv { tools: &tools, encoder: Encoder::Libx264, heavy_dir: &heavy, temp_dir: &tmp };
            export_project(&env, &job, &JobControl::new(), |_| {}, |_| {})
                .map(|o| serde_json::to_string(&o).unwrap_or_default())
                .map_err(|e| format!("{e:?}"))
        })(),
        _ => Err("uso: snip_render probe <archivo> <id> | export <job.json> <dir>".into()),
    };
    match result {
        Ok(s) => {
            println!("{s}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
