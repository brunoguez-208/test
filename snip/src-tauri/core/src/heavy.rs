//! Etapa pesada: efectos que el preview no puede mostrar en tiempo real y que
//! conviene procesar una sola vez (invertir, boomerang, cámara lenta con cuadros
//! interpolados, estabilización y reducción de ruido de imagen o de audio).
//!
//! Para cada clip se genera un intermedio (MP4 H.264 casi sin pérdida + AAC)
//! con el clip entero ya procesado: velocidad, repeticiones e inversión
//! incluidas. El preview lo reproduce y la exportación lo usa como fuente, así
//! que lo que se ve es exactamente lo que se exporta.
//!
//! Etapas (cada una cacheada en disco por un hash de sus parámetros):
//! 1. `base`: tramo del original con estabilización (vidstab, 2 pasadas) y
//!    reducción de ruido (hqdn3d / afftdn). Si no hace falta, se lee el original.
//! 2. `rev`: el tramo invertido, por bloques (FFmpeg guarda en memoria todo lo
//!    que invierte; por bloques el consumo queda acotado).
//! 3. `spd`: velocidad (setpts + atempo) y, si es suave, minterpolate.
//! 4. Unión de las pasadas (loop/boomerang) con el demuxer concat, sin recodificar video.

use crate::compile::{atempo_chain, num, Intermediate};
use crate::encoder::Encoder;
use crate::error::{AppError, ErrorKind};
use crate::graph::s;
use crate::project::{Clip, ClipKind, LoopMode, MediaRef};
use crate::runner::{self, JobControl, Tools};
use crate::timeline;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// ¿El clip necesita la etapa pesada?
pub fn needs_heavy(c: &Clip) -> bool {
    if c.kind == ClipKind::Freeze {
        return false;
    }
    c.reverse
        || c.loop_mode == LoopMode::Boomerang
        || (c.smooth_slowmo && c.speed < 1.0 - 1e-6)
        || c.video.stabilize.is_some()
        || c.video.denoise > 1e-6
        || c.audio.denoise
}

/// Etapas de la etapa base (antes de invertir o cambiar la velocidad).
fn needs_base(c: &Clip) -> bool {
    c.video.stabilize.is_some() || c.video.denoise > 1e-6 || c.audio.denoise
}

/// Huella del archivo original (ruta, tamaño y fecha) para la caché.
pub fn source_fingerprint(path: &Path) -> u64 {
    let mut h = DefaultHasher::new();
    path.to_string_lossy().to_lowercase().hash(&mut h);
    if let Ok(m) = std::fs::metadata(path) {
        m.len().hash(&mut h);
        if let Ok(t) = m.modified() {
            t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0).hash(&mut h);
        }
    }
    h.finish()
}

fn key(parts: &[&str]) -> String {
    let mut h = DefaultHasher::new();
    for p in parts {
        p.hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

/// Parámetros que identifican cada etapa (si cambian, cambia el archivo).
#[derive(Debug, Clone, PartialEq)]
pub struct StageKeys {
    pub base: Option<String>,
    pub rev: Option<String>,
    pub fwd_speed: Option<String>,
    pub rev_speed: Option<String>,
    pub final_key: String,
}

pub fn stage_keys(c: &Clip, fingerprint: u64, canvas_fps: &str, encoder: Encoder) -> StageKeys {
    let src = format!("{fingerprint:x}|{}|{}|{:?}|{:?}", num(c.in_point), num(c.out_point), encoder, c.audio.track);
    let base_params = format!(
        "{:?}|{}|{}",
        c.video.stabilize.map(|s| (s.strength * 1000.0).round() as i64),
        (c.video.denoise * 1000.0).round(),
        c.audio.denoise
    );
    let base = needs_base(c).then(|| key(&["base", &src, &base_params]));
    let src_of_next = base.clone().unwrap_or_else(|| key(&["src", &src]));
    let wants_rev = c.reverse || c.loop_mode == LoopMode::Boomerang;
    let rev = wants_rev.then(|| key(&["rev", &src_of_next]));
    let speed = format!("{}|{}|{}", num(c.speed), c.smooth_slowmo && c.speed < 1.0, canvas_fps);
    let changes_speed = (c.speed - 1.0).abs() > 1e-6;
    let (forward, backward) = piece_directions(c);
    let fwd_speed = (forward && changes_speed).then(|| key(&["spd", &src_of_next, &speed]));
    let rev_speed = (backward && changes_speed).then(|| key(&["spd", rev.as_deref().unwrap_or(""), &speed]));
    let final_key = key(&[
        "final",
        &src_of_next,
        rev.as_deref().unwrap_or("-"),
        &speed,
        &format!("{:?}|{}|{}", c.loop_mode, c.loop_count, c.reverse),
    ]);
    StageKeys { base, rev, fwd_speed, rev_speed, final_key }
}

/// Qué piezas hacen falta: (hacia adelante, hacia atrás).
fn piece_directions(c: &Clip) -> (bool, bool) {
    let dirs = pass_directions(c);
    (dirs.iter().any(|d| *d), dirs.iter().any(|d| !*d))
}

/// Dirección de cada pasada (true = hacia adelante).
pub fn pass_directions(c: &Clip) -> Vec<bool> {
    (0..timeline::passes(c))
        .map(|k| {
            let fwd = match c.loop_mode {
                LoopMode::Boomerang => k % 2 == 0,
                _ => true,
            };
            fwd != c.reverse
        })
        .collect()
}

/// Video de los intermedios: casi sin pérdida, con un keyframe por segundo
/// (para que el preview pueda saltar rápido).
pub fn piece_video_args(encoder: Encoder, gop: u32) -> Vec<String> {
    let g = gop.max(1).to_string();
    let a: Vec<&str> = match encoder {
        Encoder::Nvenc => vec!["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "14", "-b:v", "0", "-profile:v", "high"],
        Encoder::Qsv => vec!["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", "14", "-profile:v", "high"],
        Encoder::Amf => vec!["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "14", "-qp_p", "14"],
        Encoder::Libx264 => vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-profile:v", "high"],
    };
    let mut v: Vec<String> = a.into_iter().map(s).collect();
    v.extend([s("-g"), g]);
    v
}

fn piece_audio_args(has_audio: bool) -> Vec<String> {
    if has_audio {
        vec![s("-c:a"), s("pcm_s16le"), s("-ar"), s("48000"), s("-ac"), s("2")]
    } else {
        vec![s("-an")]
    }
}

fn tail_args(out: &Path) -> Vec<String> {
    vec![
        s("-progress"),
        s("pipe:1"),
        s("-stats_period"),
        s("0.5"),
        s("-nostats"),
        s("-f"),
        s("mov"),
        out.to_string_lossy().into_owned(),
    ]
}

fn head() -> Vec<String> {
    vec![s("-hide_banner"), s("-nostdin"), s("-loglevel"), s("error"), s("-y")]
}

/// Fuente de una etapa: el original (con seek) o un archivo intermedio entero.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// `tracks`: pistas de audio del original a mezclar (vacío = la primera).
    Original { path: String, start: f64, len: f64, fps: f64, tracks: Vec<u32> },
    File { path: String },
}

/// Pistas de audio a leer de un medio según la elección del clip.
pub fn audio_tracks(media: &MediaRef, track: Option<u32>) -> Vec<u32> {
    let n = media.audio_track_count();
    match track {
        Some(t) if t < n => vec![t],
        _ if n > 1 => (0..n).collect(),
        _ => vec![0],
    }
}

/// Filtro de entrada que junta las pistas (vacío si es una sola).
pub fn mix_inputs(k: usize, tracks: &[u32]) -> (Vec<String>, Option<String>) {
    let ins = tracks.iter().map(|t| format!("{k}:a:{t}")).collect();
    let mix = (tracks.len() > 1).then(|| format!("amix=inputs={}:duration=longest:normalize=0", tracks.len()));
    (ins, mix)
}

/// `-af` + `-map` del audio de una etapa; con varias pistas, las mezcla.
fn audio_map(src: &Source, af: &str) -> Vec<String> {
    let tracks: &[u32] = match src {
        Source::Original { tracks, .. } if !tracks.is_empty() => tracks,
        _ => &[0],
    };
    let (ins, mix) = mix_inputs(0, tracks);
    match mix {
        Some(m) => {
            let ins: String = ins.iter().map(|i| format!("[{i}]")).collect();
            vec![s("-filter_complex"), format!("{ins}{m},{af}[ha]"), s("-map"), s("[ha]")]
        }
        None => vec![s("-af"), af.to_string(), s("-map"), format!("0:{}", ins[0].trim_start_matches("0:"))],
    }
}

impl Source {
    /// Argumentos de input para leer `[off, off+len)` de esta fuente.
    fn input(&self, off: f64, len: Option<f64>) -> (Vec<String>, f64) {
        match self {
            Source::Original { path, start, len: total, fps, .. } => {
                let pre = 0.25 / fps.max(1.0);
                let ss = (start + off - pre).max(0.0);
                let real_pre = start + off - ss;
                let l = len.unwrap_or(total - off);
                (vec![s("-ss"), num(ss), s("-t"), num(l), s("-i"), path.clone()], real_pre)
            }
            Source::File { path } => {
                let mut a = vec![];
                if off > 0.0 {
                    a.extend([s("-ss"), num(off)]);
                }
                if let Some(l) = len {
                    a.extend([s("-t"), num(l)]);
                }
                a.extend([s("-i"), path.clone()]);
                (a, 0.0)
            }
        }
    }
}

/// Mapeo de la intensidad de estabilización (0..1) a los parámetros de vidstab.
pub fn vidstab_params(strength: f64) -> (u32, u32) {
    let s = strength.clamp(0.0, 1.0);
    let shakiness = 3 + (s * 7.0).round() as u32; // 3..10
    let smoothing = 6 + (s * 34.0).round() as u32; // 6..40
    (shakiness, smoothing)
}

/// Reducción de ruido de imagen (0..1) → hqdn3d.
pub fn hqdn3d(amount: f64) -> String {
    let ls = 1.0 + 5.0 * amount.clamp(0.0, 1.0);
    format!("hqdn3d={:.2}:{:.2}:{:.2}:{:.2}", ls, ls * 0.75, ls * 1.5, ls * 1.125)
}

pub const AUDIO_DENOISE: &str = "afftdn=nr=15:nf=-40:tn=1";

/// Primera pasada de vidstab: analiza el movimiento y guarda `trf` (relativo a `cwd`).
pub fn stab_detect_args(src: &Source, strength: f64, trf: &str) -> Vec<String> {
    let (shakiness, _) = vidstab_params(strength);
    let (input, pre) = src.input(0.0, None);
    let mut a = head();
    a.extend(input);
    a.extend([
        s("-vf"),
        format!("trim=start={},setpts=PTS-STARTPTS,vidstabdetect=shakiness={shakiness}:accuracy=15:result={trf}", num(pre)),
        s("-an"),
        s("-progress"),
        s("pipe:1"),
        s("-nostats"),
        s("-f"),
        s("null"),
        s("-"),
    ]);
    a
}

/// Etapa base: tramo del original con estabilización y reducción de ruido.
pub fn base_args(c: &Clip, src: &Source, trf: Option<&str>, has_audio: bool, encoder: Encoder, gop: u32, out: &Path) -> Vec<String> {
    let (input, pre) = src.input(0.0, None);
    let mut a = head();
    a.extend(input);
    let mut vf = vec![format!("trim=start={}", num(pre)), s("setpts=PTS-STARTPTS")];
    if let (Some(st), Some(trf)) = (c.video.stabilize, trf) {
        let (_, smoothing) = vidstab_params(st.strength);
        vf.push(format!("vidstabtransform=input={trf}:smoothing={smoothing}:optzoom=1:interpol=bicubic"));
        vf.push(s("unsharp=5:5:0.8:3:3:0.4"));
    }
    if c.video.denoise > 1e-6 {
        vf.push(hqdn3d(c.video.denoise));
    }
    vf.push(format!("format={}", encoder.pix_fmt()));
    a.extend([s("-vf"), vf.join(",")]);
    if has_audio {
        let mut af = vec![format!("atrim=start={}", num(pre)), s("asetpts=PTS-STARTPTS")];
        if c.audio.denoise {
            af.push(s(AUDIO_DENOISE));
        }
        a.extend([s("-map"), s("0:v:0")]);
        a.extend(audio_map(src, &af.join(",")));
    } else {
        a.extend([s("-map"), s("0:v:0")]);
    }
    a.extend(piece_video_args(encoder, gop));
    a.extend(piece_audio_args(has_audio));
    a.extend(tail_args(out));
    a
}

/// Un bloque invertido: `[off, off+len)` de la fuente, al revés.
pub fn reverse_chunk_args(src: &Source, off: f64, len: f64, has_audio: bool, encoder: Encoder, gop: u32, out: &Path) -> Vec<String> {
    let (input, pre) = src.input(off, Some(len));
    let mut a = head();
    a.extend(input);
    a.extend([
        s("-vf"),
        format!("trim=start={},setpts=PTS-STARTPTS,reverse,format={}", num(pre), encoder.pix_fmt()),
    ]);
    a.extend([s("-map"), s("0:v:0")]);
    if has_audio {
        a.extend(audio_map(src, &format!("atrim=start={},asetpts=PTS-STARTPTS,areverse", num(pre))));
    }
    a.extend(piece_video_args(encoder, gop));
    a.extend(piece_audio_args(has_audio));
    a.extend(tail_args(out));
    a
}

/// Bloques para invertir sin pasar ~600 MB de cuadros en memoria.
pub fn reverse_chunks(len: f64, width: u32, height: u32, fps: f64) -> Vec<(f64, f64)> {
    let frame_bytes = (width.max(2) as f64) * (height.max(2) as f64) * 1.5;
    let budget = 600.0 * 1024.0 * 1024.0;
    let secs = (budget / frame_bytes / fps.max(1.0)).clamp(0.5, 20.0);
    let n = (len / secs).ceil().max(1.0) as usize;
    let step = len / n as f64;
    (0..n).map(|i| (i as f64 * step, if i + 1 == n { len - i as f64 * step } else { step })).collect()
}

/// Velocidad (y cámara lenta suave con minterpolate).
pub fn speed_args(src: &Source, c: &Clip, canvas_fps: &str, has_audio: bool, encoder: Encoder, gop: u32, out: &Path) -> Vec<String> {
    let (input, pre) = src.input(0.0, None);
    let mut a = head();
    a.extend(input);
    let mut vf = vec![format!("trim=start={}", num(pre)), format!("setpts=(PTS-STARTPTS)/{}", c.speed)];
    if c.smooth_slowmo && c.speed < 1.0 {
        vf.push(format!("minterpolate=fps={canvas_fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"));
    }
    vf.push(format!("format={}", encoder.pix_fmt()));
    a.extend([s("-vf"), vf.join(",")]);
    if has_audio {
        let mut af = vec![format!("atrim=start={}", num(pre)), s("asetpts=PTS-STARTPTS")];
        af.extend(atempo_chain(c.speed));
        a.extend([s("-map"), s("0:v:0")]);
        a.extend(audio_map(src, &af.join(",")));
    } else {
        a.extend([s("-map"), s("0:v:0")]);
    }
    a.extend(piece_video_args(encoder, gop));
    a.extend(piece_audio_args(has_audio));
    a.extend(tail_args(out));
    a
}

/// Línea de una lista ffconcat (con las comillas escapadas).
pub fn concat_line(path: &Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''");
    format!("file '{p}'")
}

pub fn concat_list(paths: &[PathBuf]) -> String {
    let mut out = String::from("ffconcat version 1.0\n");
    for p in paths {
        out.push_str(&concat_line(p));
        out.push('\n');
    }
    out
}

/// Une piezas sin recodificar el video (el audio PCM pasa a AAC).
pub fn join_args(list: &Path, has_audio: bool, final_mp4: bool, out: &Path) -> Vec<String> {
    let mut a = head();
    a.extend([s("-f"), s("concat"), s("-safe"), s("0"), s("-i"), list.to_string_lossy().into_owned()]);
    a.extend([s("-map"), s("0:v:0"), s("-c:v"), s("copy")]);
    if has_audio {
        a.extend([s("-map"), s("0:a:0")]);
        if final_mp4 {
            a.extend([s("-c:a"), s("aac"), s("-b:a"), s("320k")]);
        } else {
            a.extend([s("-c:a"), s("copy")]);
        }
    }
    if final_mp4 {
        a.extend([s("-movflags"), s("+faststart")]);
    }
    a.extend([s("-progress"), s("pipe:1"), s("-nostats"), s("-f"), s(if final_mp4 { "mp4" } else { "mov" })]);
    a.push(out.to_string_lossy().into_owned());
    a
}

/// Paso del plan, con su peso relativo para el progreso.
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub label: &'static str,
    pub weight: f64,
}

/// Procesa un clip y devuelve el intermedio (usa la caché si ya existe).
#[allow(clippy::too_many_arguments)]
pub fn process_clip(
    tools: &Tools,
    media: &MediaRef,
    c: &Clip,
    canvas_fps: &str,
    canvas_fps_value: f64,
    encoder: Encoder,
    cache_dir: &Path,
    job: &JobControl,
    mut on_progress: impl FnMut(f64),
) -> Result<Intermediate, AppError> {
    std::fs::create_dir_all(cache_dir).map_err(|e| AppError::from_io(&e))?;
    let fp = source_fingerprint(Path::new(&media.path));
    let keys = stage_keys(c, fp, canvas_fps, encoder);
    let duration = timeline::clip_duration(c);
    let final_path = cache_dir.join(format!("{}.mp4", keys.final_key));
    let has_audio = media.has_audio;
    if final_path.is_file() {
        touch(&final_path);
        on_progress(100.0);
        return Ok(Intermediate { path: final_path.to_string_lossy().into_owned(), duration, has_audio });
    }
    let len = (c.out_point - c.in_point).max(1e-3);
    let src_fps = media.fps.max(1.0);
    let gop = src_fps.round().max(1.0) as u32;
    let out_gop = if c.smooth_slowmo { canvas_fps_value.round() as u32 } else { gop };
    let original = Source::Original { path: media.path.clone(), start: c.in_point, len, fps: src_fps, tracks: audio_tracks(media, c.audio.track) };

    // Pesos: estimación del costo de cada etapa (en "segundos de video procesado").
    let mut total_weight = 0.0;
    let stab = c.video.stabilize.is_some();
    if keys.base.is_some() {
        total_weight += len * if stab { 2.0 } else { 1.0 };
    }
    if keys.rev.is_some() {
        total_weight += len * 1.5;
    }
    let speed_cost = if c.smooth_slowmo && c.speed < 1.0 { 8.0 } else { 1.0 };
    if keys.fwd_speed.is_some() {
        total_weight += len * speed_cost;
    }
    if keys.rev_speed.is_some() {
        total_weight += len * speed_cost;
    }
    total_weight += 0.1 * duration + 0.1;
    let mut done = 0.0;
    let mut report = |done: f64, part: f64, w: f64| on_progress(((done + part * w) / total_weight * 100.0).clamp(0.0, 99.5));

    // `make` arma los argumentos para escribir en el parcial; si todo sale bien se renombra a `out`.
    let run_stage = |make: &dyn Fn(&Path) -> Vec<String>, out: &Path, w: f64, done: f64, report: &mut dyn FnMut(f64, f64, f64)| -> Result<(), AppError> {
        let partial = crate::naming::partial_path(out);
        let args = make(&partial);
        let total = len.max(0.01);
        let mut on = |smp: crate::progress::ProgressSample| report(done, (smp.out_time / total).clamp(0.0, 1.0), w);
        runner::run_ffmpeg_to_file_in(tools, &args, Some(cache_dir), &partial, out, job, &mut on)
    };

    // 1) Base
    let base_src = if let Some(k) = &keys.base {
        let out = cache_dir.join(format!("{k}.mov"));
        if !out.is_file() {
            let w = len * if stab { 2.0 } else { 1.0 };
            let trf = format!("{k}.trf");
            if let Some(st) = c.video.stabilize {
                let args = stab_detect_args(&original, st.strength, &trf);
                let mut on = |smp: crate::progress::ProgressSample| report(done, (smp.out_time / len).clamp(0.0, 1.0) * 0.5, w);
                runner::run_ffmpeg(tools, &args, Some(cache_dir), job, &mut on)?;
            }
            let half = if stab { 0.5 } else { 0.0 };
            let trf_ref = stab.then_some(trf.as_str());
            run_stage(&|o| base_args(c, &original, trf_ref, has_audio, encoder, gop, o), &out, w * (1.0 - half), done + w * half, &mut report)?;
            let _ = std::fs::remove_file(cache_dir.join(&trf));
            done += w;
        }
        Source::File { path: out.to_string_lossy().into_owned() }
    } else {
        original.clone()
    };

    // 2) Invertido
    let rev_src = if let Some(k) = &keys.rev {
        let out = cache_dir.join(format!("{k}.mov"));
        if !out.is_file() {
            let w = len * 1.5;
            let chunks = reverse_chunks(len, media.width, media.height, src_fps);
            let mut parts = vec![];
            for (i, (off, l)) in chunks.iter().enumerate() {
                let part = cache_dir.join(format!("{k}.part{i}.mov"));
                let base_done = done + w * (*off / len);
                let partial = crate::naming::partial_path(&part);
                let args = reverse_chunk_args(&base_src, *off, *l, has_audio, encoder, gop, &partial);
                let mut on = |smp: crate::progress::ProgressSample| report(base_done, (smp.out_time / len).clamp(0.0, 1.0), w);
                if let Err(e) = runner::run_ffmpeg_to_file_in(tools, &args, Some(cache_dir), &partial, &part, job, &mut on) {
                    cleanup(&parts);
                    return Err(e);
                }
                parts.push(part);
            }
            // Los bloques invertidos van en orden inverso.
            parts.reverse();
            let list = cache_dir.join(format!("{k}.txt"));
            std::fs::write(&list, concat_list(&parts)).map_err(|e| AppError::from_io(&e))?;
            let r = run_stage(&|o| join_args(&list, has_audio, false, o), &out, 0.0, done + w, &mut report);
            cleanup(&parts);
            let _ = std::fs::remove_file(&list);
            r?;
            done += w;
        }
        Some(Source::File { path: out.to_string_lossy().into_owned() })
    } else {
        None
    };

    // 3) Velocidad
    let materialize = |k: &str| -> PathBuf { cache_dir.join(format!("{k}.mov")) };
    let fwd_piece: Option<PathBuf> = if piece_directions(c).0 {
        if let Some(k) = &keys.fwd_speed {
            let out = materialize(k);
            if !out.is_file() {
                let w = len * speed_cost;
                run_stage(&|o| speed_args(&base_src, c, canvas_fps, has_audio, encoder, out_gop, o), &out, w, done, &mut report)?;
                done += w;
            }
            Some(out)
        } else {
            Some(match &base_src {
                Source::File { path } => PathBuf::from(path),
                Source::Original { .. } => {
                    // Hace falta como pieza (para unir con la inversa): se copia el tramo recodificado.
                    let k = key(&["fwd", &keys.final_key]);
                    let out = cache_dir.join(format!("{k}.mov"));
                    if !out.is_file() {
                        let mut plain = c.clone();
                        plain.speed = 1.0;
                        plain.smooth_slowmo = false;
                        run_stage(&|o| speed_args(&base_src, &plain, canvas_fps, has_audio, encoder, gop, o), &out, len, done, &mut report)?;
                        done += len;
                    }
                    out
                }
            })
        }
    } else {
        None
    };
    let rev_piece: Option<PathBuf> = match (&rev_src, &keys.rev_speed) {
        (Some(r), Some(k)) => {
            let out = materialize(k);
            if !out.is_file() {
                let w = len * speed_cost;
                run_stage(&|o| speed_args(r, c, canvas_fps, has_audio, encoder, out_gop, o), &out, w, done, &mut report)?;
                done += w;
            }
            Some(out)
        }
        (Some(Source::File { path }), None) => Some(PathBuf::from(path)),
        _ => None,
    };

    // 4) Unir las pasadas en el MP4 final (reproducible en el preview).
    let pieces: Vec<PathBuf> = pass_directions(c)
        .into_iter()
        .filter_map(|fwd| if fwd { fwd_piece.clone() } else { rev_piece.clone() })
        .collect();
    if pieces.is_empty() {
        return Err(AppError::with_detail(ErrorKind::Unknown, "sin piezas para el intermedio"));
    }
    let list = cache_dir.join(format!("{}.txt", keys.final_key));
    std::fs::write(&list, concat_list(&pieces)).map_err(|e| AppError::from_io(&e))?;
    let r = run_stage(&|o| join_args(&list, has_audio, true, o), &final_path, 0.1 * duration + 0.1, done, &mut report);
    let _ = std::fs::remove_file(&list);
    r?;
    on_progress(100.0);
    Ok(Intermediate { path: final_path.to_string_lossy().into_owned(), duration, has_audio })
}

fn cleanup(parts: &[PathBuf]) {
    for p in parts {
        runner::remove_with_retry(p);
    }
}

/// Actualiza la fecha de un archivo de la caché (para la limpieza por antigüedad).
fn touch(path: &Path) {
    if let Ok(f) = std::fs::OpenOptions::new().append(true).open(path) {
        let _ = f.set_modified(std::time::SystemTime::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::Stabilize;
    use crate::testutil::clip;

    #[test]
    fn which_clips_are_heavy() {
        let mut c = clip("a", 0.0, 4.0);
        assert!(!needs_heavy(&c));
        c.speed = 0.5;
        assert!(!needs_heavy(&c), "la velocidad sola la hace el preview");
        c.smooth_slowmo = true;
        assert!(needs_heavy(&c));
        c.smooth_slowmo = false;
        c.loop_mode = LoopMode::Loop;
        assert!(!needs_heavy(&c));
        c.loop_mode = LoopMode::Boomerang;
        assert!(needs_heavy(&c));
        let mut c = clip("a", 0.0, 4.0);
        c.audio.denoise = true;
        assert!(needs_heavy(&c));
        let mut c = clip("a", 0.0, 4.0);
        c.video.stabilize = Some(Stabilize { strength: 0.5 });
        assert!(needs_heavy(&c));
        let mut f = clip("f", 1.0, 1.0);
        f.kind = ClipKind::Freeze;
        f.reverse = true;
        assert!(!needs_heavy(&f));
    }

    #[test]
    fn boomerang_directions() {
        let mut c = clip("a", 0.0, 4.0);
        c.loop_mode = LoopMode::Boomerang;
        c.loop_count = 2;
        assert_eq!(pass_directions(&c), vec![true, false, true, false]);
        c.reverse = true;
        assert_eq!(pass_directions(&c), vec![false, true, false, true]);
        c.loop_mode = LoopMode::None;
        assert_eq!(pass_directions(&c), vec![false]);
    }

    #[test]
    fn keys_change_only_with_relevant_params() {
        let mut c = clip("a", 0.0, 4.0);
        c.reverse = true;
        let k1 = stage_keys(&c, 1, "30", Encoder::Libx264);
        assert!(k1.base.is_none() && k1.rev.is_some() && k1.fwd_speed.is_none());
        c.audio.volume = 0.3; // no afecta la etapa pesada
        assert_eq!(stage_keys(&c, 1, "30", Encoder::Libx264), k1);
        c.speed = 0.5;
        let k2 = stage_keys(&c, 1, "30", Encoder::Libx264);
        assert_eq!(k2.rev, k1.rev, "invertir no depende de la velocidad");
        assert!(k2.rev_speed.is_some());
        assert_ne!(k2.final_key, k1.final_key);
        assert_ne!(stage_keys(&c, 2, "30", Encoder::Libx264).final_key, k2.final_key, "otro archivo, otra caché");
    }

    #[test]
    fn reverse_is_chunked_by_memory_budget() {
        let ch = reverse_chunks(60.0, 3840, 2160, 60.0);
        assert!(ch.len() >= 6, "{ch:?}");
        let sum: f64 = ch.iter().map(|c| c.1).sum();
        assert!((sum - 60.0).abs() < 1e-9);
        assert_eq!(reverse_chunks(3.0, 1280, 720, 30.0).len(), 1);
    }

    #[test]
    fn stage_args() {
        let mut c = clip("a", 2.0, 6.0);
        c.speed = 0.5;
        c.smooth_slowmo = true;
        let src = Source::Original { path: "C:\\v\\a.mp4".into(), start: 2.0, len: 4.0, fps: 30.0, tracks: vec![] };
        let a = speed_args(&src, &c, "60", true, Encoder::Libx264, 60, Path::new("o.mov")).join(" ");
        assert!(a.contains("-ss 1.991667 -t 4.000000 -i C:\\v\\a.mp4"), "{a}");
        assert!(a.contains("setpts=(PTS-STARTPTS)/0.5,minterpolate=fps=60:mi_mode=mci"));
        assert!(a.contains("atempo=0.5"));
        assert!(a.contains("-c:a pcm_s16le"));
        assert!(a.contains("-g 60"));
        assert!(a.ends_with("-f mov o.mov"));

        let r = reverse_chunk_args(&Source::File { path: "b.mov".into() }, 2.0, 1.5, false, Encoder::Nvenc, 30, Path::new("r.mov")).join(" ");
        assert!(r.contains("-ss 2.000000 -t 1.500000 -i b.mov"));
        assert!(r.contains("reverse"));
        assert!(!r.contains("areverse"));
        assert!(r.contains("-an"));
        assert!(r.contains("h264_nvenc"));

        c.video.stabilize = Some(Stabilize { strength: 1.0 });
        c.video.denoise = 0.5;
        c.audio.denoise = true;
        let d = stab_detect_args(&src, 1.0, "k.trf").join(" ");
        assert!(d.contains("vidstabdetect=shakiness=10:accuracy=15:result=k.trf"));
        assert!(d.ends_with("-f null -"));
        let b = base_args(&c, &src, Some("k.trf"), true, Encoder::Libx264, 30, Path::new("b.mov")).join(" ");
        assert!(b.contains("vidstabtransform=input=k.trf:smoothing=40:optzoom=1"));
        assert!(b.contains("hqdn3d=3.50"));
        assert!(b.contains(AUDIO_DENOISE));

        let j = join_args(Path::new("l.txt"), true, true, Path::new("f.mp4")).join(" ");
        assert!(j.contains("-f concat -safe 0 -i l.txt"));
        assert!(j.contains("-c:v copy"));
        assert!(j.contains("-c:a aac -b:a 320k"));
        assert!(j.ends_with("-f mp4 f.mp4"));
    }

    #[test]
    fn concat_lines_escape_quotes_and_backslashes() {
        assert_eq!(concat_line(Path::new("C:\\a\\it's.mov")), "file 'C:/a/it'\\''s.mov'");
        let l = concat_list(&[PathBuf::from("/a.mov"), PathBuf::from("/b.mov")]);
        assert!(l.starts_with("ffconcat version 1.0\nfile '/a.mov'\nfile '/b.mov'"));
    }
}
