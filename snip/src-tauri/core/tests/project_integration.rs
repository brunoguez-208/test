//! Integración con FFmpeg real: proyectos que combinan varias funcionalidades.
//!
//! Renderiza proyectos de prueba con el mismo código que usa la app y verifica
//! con ffprobe duración, resolución, fps, códecs y tamaño. Usa `SNIP_FFMPEG_DIR`
//! (por defecto /opt/ffmpeg9/bin). `SNIP_SKIP_INTEGRATION=1` los saltea.

use snip_core::encoder::Encoder;
use snip_core::error::ErrorKind;
use snip_core::project::*;
use snip_core::project_export::{export_project, ExportEnv, ExportJob, OutcomeMode, ProjectOutcome, Window};
use snip_core::runner::{JobControl, Tools};
use snip_core::scale::ResolutionChoice;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

struct Fx {
    _dir: tempfile::TempDir,
    root: PathBuf,
    tools: Tools,
}

fn skip() -> bool {
    std::env::var_os("SNIP_SKIP_INTEGRATION").is_some()
}

macro_rules! guard {
    () => {
        if skip() {
            eprintln!("SNIP_SKIP_INTEGRATION: salteado");
            return;
        }
    };
}

fn gen(tools: &Tools, args: &[&str]) {
    let st = Command::new(&tools.ffmpeg).args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).status().unwrap();
    assert!(st.success(), "fixture: {args:?}");
}

fn fx() -> &'static Fx {
    static F: OnceLock<Fx> = OnceLock::new();
    F.get_or_init(|| {
        let dir = std::env::var_os("SNIP_FFMPEG_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/opt/ffmpeg9/bin"));
        let tools = Tools { ffmpeg: dir.join("ffmpeg"), ffprobe: dir.join("ffprobe") };
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let p = |n: &str| root.join(n).to_string_lossy().into_owned();
        // 640x360 30 fps con audio (un tono), 10 s, keyframe cada segundo.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=10", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=10",
            "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &p("a.mp4"),
        ]);
        // 1280x720 60 fps sin audio, MKV.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc=s=1280x720:r=60:d=6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &p("b.mkv"),
        ]);
        // Vertical 360x640 25 fps WebM (VP9 + Opus).
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=360x640:r=25:d=5", "-f", "lavfi", "-i", "sine=f=660:d=5",
            "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-shortest", &p("c.webm"),
        ]);
        // MOV con audio.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=f=220:d=4",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &p("d.mov"),
        ]);
        // Video "difícil" para el tamaño objetivo (ruido), 1280x720 30 fps, 12 s.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=12,noise=alls=40:allf=t", "-f", "lavfi", "-i", "anoisesrc=d=12:a=0.2",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-shortest", &p("noisy.mp4"),
        ]);
        // Música (MP3) y un tramo de voz muy bajito para normalizar.
        gen(&tools, &["-f", "lavfi", "-i", "sine=f=330:d=30", "-c:a", "libmp3lame", "-b:a", "128k", &p("music.mp3")]);
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=4", "-f", "lavfi", "-i", "sine=f=500:d=4,volume=0.02",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &p("quiet.mp4"),
        ]);
        std::fs::create_dir_all(root.join("out")).unwrap();
        std::fs::create_dir_all(root.join("cache")).unwrap();
        std::fs::create_dir_all(root.join("tmp")).unwrap();
        Fx { _dir: tmp, root, tools }
    })
}

fn path(n: &str) -> String {
    fx().root.join(n).to_string_lossy().into_owned()
}

fn media(id: &str, file: &str) -> MediaRef {
    snip_core::probe_media(&fx().tools, Path::new(&path(file)), id).unwrap()
}

fn clip(id: &str, media: &str, a: f64, b: f64) -> Clip {
    serde_json::from_value(serde_json::json!({"id": id, "mediaId": media, "inPoint": a, "outPoint": b})).unwrap()
}

fn project(media: Vec<MediaRef>, clips: Vec<Clip>) -> Project {
    let m = &media[0];
    serde_json::from_value(serde_json::json!({
        "version": 1, "id": "p", "name": "prueba",
        "media": media, "clips": clips,
        "canvas": {"width": m.width, "height": m.height, "fpsNum": m.fps_num, "fpsDen": m.fps_den}
    }))
    .unwrap()
}

struct Probe {
    duration: f64,
    width: u32,
    height: u32,
    fps: f64,
    vcodec: Option<String>,
    acodec: Option<String>,
    size: u64,
}

fn probe(p: &str) -> Probe {
    let out = Command::new(&fx().tools.ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", p])
        .output()
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let vs = streams.iter().find(|s| s["codec_type"] == "video");
    let au = streams.iter().find(|s| s["codec_type"] == "audio");
    let fps = vs
        .and_then(|s| s["avg_frame_rate"].as_str())
        .and_then(|r| r.split_once('/'))
        .map(|(a, b)| a.parse::<f64>().unwrap_or(0.0) / b.parse::<f64>().unwrap_or(1.0).max(1.0))
        .unwrap_or(0.0);
    Probe {
        duration: v["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0),
        width: vs.and_then(|s| s["width"].as_u64()).unwrap_or(0) as u32,
        height: vs.and_then(|s| s["height"].as_u64()).unwrap_or(0) as u32,
        fps,
        vcodec: vs.and_then(|s| s["codec_name"].as_str()).map(String::from),
        acodec: au.and_then(|s| s["codec_name"].as_str()).map(String::from),
        size: std::fs::metadata(p).map(|m| m.len()).unwrap_or(0),
    }
}

/// Cuadros de video reales (cuenta paquetes).
fn frame_count(p: &str) -> u64 {
    let out = Command::new(&fx().tools.ffprobe)
        .args(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", p])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0)
}

fn run(p: Project, out: &str) -> ProjectOutcome {
    run_job(job(p, out))
}

fn job(p: Project, out: &str) -> ExportJob {
    ExportJob {
        project: p,
        settings: None,
        window: None,
        output: Some(fx().root.join("out").join(out).to_string_lossy().into_owned()),
        label: None,
        save_project: false,
        raster: None,
    }
}

fn run_job(j: ExportJob) -> ProjectOutcome {
    let env = ExportEnv {
        tools: &fx().tools,
        encoder: Encoder::Libx264,
        heavy_dir: &fx().root.join("cache"),
        temp_dir: &fx().root.join("tmp"),
    };
    let mut last = 0.0;
    let o = export_project(&env, &j, &JobControl::new(), |p| {
        assert!(p.percent + 1e-9 >= last * 0.0, "progreso");
        last = p.percent;
    }, |_| {})
    .unwrap_or_else(|e| panic!("export: {e:?}"));
    o
}

/// Luma media (0..255) de un cuadro en el segundo `t`.
fn luma_at(p: &str, t: f64) -> f64 {
    let out = Command::new(&fx().tools.ffmpeg)
        .args(["-v", "error", "-ss", &format!("{t}"), "-i", p, "-frames:v", "1", "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"])
        .output()
        .unwrap();
    let b = out.stdout;
    b.iter().map(|v| *v as f64).sum::<f64>() / b.len().max(1) as f64
}

/// SSIM entre un cuadro de `a` en `ta` y uno de `b` en `tb`.
fn ssim_frames(a: &str, ta: f64, b: &str, tb: f64) -> f64 {
    let out = Command::new(&fx().tools.ffmpeg)
        .args([
            "-v", "info", "-ss", &format!("{ta}"), "-i", a, "-ss", &format!("{tb}"), "-i", b,
            "-filter_complex", "[0:v]setpts=PTS-STARTPTS,scale=320:180,format=yuv420p[x];[1:v]setpts=PTS-STARTPTS,scale=320:180,format=yuv420p[y];[x][y]ssim",
            "-frames:v", "1", "-f", "null", "-",
        ])
        .output()
        .unwrap();
    let err = String::from_utf8_lossy(&out.stderr);
    let all = err.split("All:").nth(1).unwrap_or("0");
    all.split_whitespace().next().unwrap_or("0").parse().unwrap_or(0.0)
}

#[test]
fn multi_clip_mixed_formats_go_to_the_canvas() {
    guard!();
    let p = project(
        vec![media("a", "a.mp4"), media("b", "b.mkv"), media("c", "c.webm"), media("d", "d.mov")],
        vec![clip("1", "a", 1.0, 3.0), clip("2", "b", 0.0, 1.5), clip("3", "c", 0.5, 2.5), clip("4", "d", 0.0, 1.0)],
    );
    let o = run(p, "multi.mp4");
    assert_eq!(o.mode, OutcomeMode::Precise);
    let m = probe(&o.output);
    assert_eq!((m.width, m.height), (640, 360));
    assert!((m.fps - 30.0).abs() < 0.01);
    assert!((m.duration - 6.5).abs() < 0.08, "dur {}", m.duration);
    assert_eq!(frame_count(&o.output), 195, "6,5 s × 30 fps");
    assert_eq!(m.vcodec.as_deref(), Some("h264"));
    assert_eq!(m.acodec.as_deref(), Some("aac"));
}

#[test]
fn transitions_overlap_clips() {
    guard!();
    let mut p = project(vec![media("a", "a.mp4"), media("d", "d.mov")], vec![clip("1", "a", 0.0, 3.0), clip("2", "d", 0.0, 3.0), clip("3", "a", 5.0, 8.0)]);
    p.clips[1].transition = Some(Transition { kind: TransitionKind::SlideLeft, duration: 1.0 });
    p.clips[2].transition = Some(Transition { kind: TransitionKind::CircleOpen, duration: 0.5 });
    let o = run(p, "trans.mp4");
    let m = probe(&o.output);
    assert!((m.duration - 7.5).abs() < 0.08, "dur {}", m.duration);
    assert_eq!(frame_count(&o.output), 225);
}

#[test]
fn speed_loop_and_freeze_durations() {
    guard!();
    let mut p = project(vec![media("a", "a.mp4")], vec![clip("1", "a", 0.0, 2.0), clip("2", "a", 2.0, 4.0), clip("3", "a", 4.0, 5.0), clip("4", "a", 6.0, 6.0)]);
    p.clips[0].speed = 0.5; // 4 s
    p.clips[1].speed = 4.0; // 0.5 s
    p.clips[2].loop_mode = LoopMode::Loop;
    p.clips[2].loop_count = 3; // 3 s
    p.clips[3].kind = ClipKind::Freeze;
    p.clips[3].freeze_duration = 1.5;
    let o = run(p, "speed.mp4");
    let m = probe(&o.output);
    assert!((m.duration - 9.0).abs() < 0.08, "dur {}", m.duration);
    assert_eq!(frame_count(&o.output), 270);
    // El congelado: el primer y el último cuadro del tramo final son iguales.
    assert!(ssim_frames(&o.output, 7.6, &o.output, 8.9) > 0.99);
    // El cuadro congelado es el del segundo 6 del original.
    assert!(ssim_frames(&o.output, 8.0, &path("a.mp4"), 6.0) > 0.9);
}

#[test]
fn reverse_and_boomerang_use_the_heavy_stage() {
    guard!();
    let mut p = project(vec![media("a", "a.mp4")], vec![clip("1", "a", 2.0, 5.0)]);
    p.clips[0].reverse = true;
    let o = run(p.clone(), "rev.mp4");
    let m = probe(&o.output);
    assert!((m.duration - 3.0).abs() < 0.08, "dur {}", m.duration);
    // `-ss t` toma el primer cuadro con pts ≥ t: para el cuadro k se pide (k - ½)/fps.
    // El primer cuadro invertido es el último del tramo original (cuadro 149).
    let s = ssim_frames(&o.output, 0.0, &path("a.mp4"), 148.5 / 30.0);
    assert!(s > 0.9, "ssim {s}");
    // El último cuadro invertido (89) es el primero del tramo (cuadro 60).
    let s2 = ssim_frames(&o.output, 88.5 / 30.0, &path("a.mp4"), 59.5 / 30.0);
    assert!(s2 > 0.9, "ssim {s2}");

    p.clips[0].reverse = false;
    p.clips[0].loop_mode = LoopMode::Boomerang;
    p.clips[0].loop_count = 2;
    let o = run(p, "boom.mp4");
    let m = probe(&o.output);
    assert!((m.duration - 12.0).abs() < 0.1, "dur {}", m.duration);
    // Ida (cuadros 0..89) y vuelta (90..179): el cuadro 30 de la ida (original 90)
    // reaparece en la vuelta como cuadro 90 + (149 - 90) = 149.
    assert!(ssim_frames(&o.output, 29.5 / 30.0, &o.output, 148.5 / 30.0) > 0.9);
}

#[test]
fn smooth_slow_motion_interpolates_frames() {
    guard!();
    let mut p = project(vec![media("a", "a.mp4")], vec![clip("1", "a", 1.0, 2.0)]);
    p.clips[0].speed = 0.5;
    p.clips[0].smooth_slowmo = true;
    let o = run(p, "slowmo.mp4");
    let m = probe(&o.output);
    assert!((m.duration - 2.0).abs() < 0.08, "dur {}", m.duration);
    assert_eq!(frame_count(&o.output), 60);
    // Cuadros consecutivos distintos (interpolados, no duplicados).
    assert!(ssim_frames(&o.output, 0.5, &o.output, 0.5 + 1.0 / 30.0) < 0.999);
}

#[test]
fn audio_options_mute_remove_normalize_and_denoise() {
    guard!();
    let mut p = project(vec![media("q", "quiet.mp4")], vec![clip("1", "q", 0.0, 4.0)]);
    let l = snip_core::audio::analyze_loudness(&fx().tools, Path::new(&path("quiet.mp4")), 0.0, 4.0).unwrap();
    assert!(l.input_i < -30.0, "{l:?}");
    p.clips[0].audio.normalize = Some(l);
    p.clips[0].audio.denoise = true;
    let o = run(p.clone(), "norm.mp4");
    let after = snip_core::audio::analyze_loudness(&fx().tools, Path::new(&o.output), 0.0, 4.0).unwrap();
    assert!((after.input_i - LOUDNORM_I).abs() < 2.5, "normalizado a {}", after.input_i);

    p.clips[0].audio = ClipAudio { removed: true, ..Default::default() };
    let o = run(p, "noaudio.mp4");
    assert_eq!(probe(&o.output).acodec, None, "sin audio en ningún lado: sin pista de audio");
}

#[test]
fn music_with_ducking_and_global_fades() {
    guard!();
    let mut p = project(vec![media("a", "a.mp4"), media("m", "music.mp3")], vec![clip("1", "a", 0.0, 4.0)]);
    p.music.push(MusicClip {
        id: "mu".into(),
        media_id: "m".into(),
        start: 1.0,
        in_point: 2.0,
        out_point: 20.0,
        volume: 0.8,
        fade_in: 0.5,
        fade_out: 1.0,
        ducking: true,
            track: 0,
            volume_keys: vec![],
            enhance: None,
            linked_clip: None,
            source_track: None,
            muted: false,
    });
    p.fades = Fades { fade_in: 1.0, fade_out: 1.0 };
    let o = run(p, "music.mp4");
    let m = probe(&o.output);
    assert!((m.duration - 4.0).abs() < 0.08, "la música no alarga el video: {}", m.duration);
    assert!(luma_at(&o.output, 0.0) < 20.0, "arranca en negro");
    assert!(luma_at(&o.output, 2.0) > 60.0);
    assert!(luma_at(&o.output, 3.98) < 30.0, "termina en negro");
}

#[test]
fn every_output_format() {
    guard!();
    let base = project(vec![media("a", "a.mp4")], vec![clip("1", "a", 0.0, 2.0), clip("2", "a", 4.0, 5.0)]);
    let cases = [
        (OutputFormat::Mov, "f.mov", Some("h264"), Some("aac")),
        (OutputFormat::Mkv, "f.mkv", Some("h264"), Some("aac")),
        (OutputFormat::Webm, "f.webm", Some("vp9"), Some("opus")),
        (OutputFormat::Gif, "f.gif", Some("gif"), None),
        (OutputFormat::Mp3, "f.mp3", None, Some("mp3")),
    ];
    for (fmt, name, v, a) in cases {
        let mut p = base.clone();
        p.export.format = fmt;
        p.export.mode = ModePreference::Precise;
        p.export.gif = GifSettings { fps: 10, width: 320 };
        let o = run(p, name);
        let m = probe(&o.output);
        assert_eq!(m.vcodec.as_deref(), v, "{name}");
        assert_eq!(m.acodec.as_deref(), a, "{name}");
        assert!((m.duration - 3.0).abs() < 0.15, "{name}: {}", m.duration);
        if fmt == OutputFormat::Gif {
            assert_eq!((m.width, m.height), (320, 180));
        }
    }
}

#[test]
fn size_target_always_stays_under_the_limit() {
    guard!();
    let base = project(vec![media("n", "noisy.mp4")], vec![clip("1", "n", 0.0, 12.0)]);
    for (fmt, enc_name, mb) in [(OutputFormat::Mp4, "size.mp4", 1.0), (OutputFormat::Webm, "size.webm", 1.0), (OutputFormat::Mp4, "size2.mp4", 2.5)] {
        let mut p = base.clone();
        p.export.format = fmt;
        p.export.size_target = Some(SizeTarget { preset: "custom".into(), megabytes: mb });
        let o = run(p, enc_name);
        let m = probe(&o.output);
        assert!(m.size as f64 <= mb * 1_000_000.0, "{enc_name}: {} bytes > {mb} MB", m.size);
        assert!(m.size as f64 > mb * 1_000_000.0 * 0.5, "{enc_name}: aprovecha el tamaño ({} bytes)", m.size);
        assert!((m.duration - 12.0).abs() < 0.1);
    }
}

#[test]
fn discord_preset_on_a_long_export_stays_under_20mb() {
    guard!();
    // 12 s de ruido en loop ×10 = 2 minutos de video muy difícil de comprimir.
    let mut p = project(vec![media("n", "noisy.mp4")], vec![clip("1", "n", 0.0, 12.0)]);
    p.clips[0].loop_mode = LoopMode::Loop;
    p.clips[0].loop_count = 10;
    let limits = snip_core::sizing::platform_limits();
    let discord = limits.presets.iter().find(|x| x.id == "discord").unwrap();
    p.export.size_target = Some(SizeTarget { preset: discord.id.clone(), megabytes: discord.megabytes });
    let o = run(p, "discord.mp4");
    let m = probe(&o.output);
    assert!((m.size as f64) < discord.megabytes * 1_000_000.0, "{} bytes", m.size);
    assert!((m.duration - 120.0).abs() < 0.3);
}

#[test]
fn fragments_export_only_their_range() {
    guard!();
    let p = project(vec![media("a", "a.mp4")], vec![clip("1", "a", 0.0, 3.0), clip("2", "a", 5.0, 9.0)]);
    let mut j = job(p.clone(), "frag.mp4");
    j.window = Some(Window { start: 2.0, end: 5.0 });
    j.project.export.mode = ModePreference::Precise;
    let o = run_job(j);
    let m = probe(&o.output);
    assert!((m.duration - 3.0).abs() < 0.08, "dur {}", m.duration);
    // El segundo 0 del fragmento es el segundo 2 del original.
    assert!(ssim_frames(&o.output, 0.0, &path("a.mp4"), 2.0) > 0.9);
}

#[test]
fn fast_mode_copies_cuts_without_reencoding() {
    guard!();
    let mut p = project(vec![media("a", "a.mp4")], vec![clip("1", "a", 1.0, 3.0), clip("2", "a", 6.0, 8.0)]);
    p.name = "rapido".into();
    let mut j = job(p, "x");
    j.output = None;
    j.save_project = true;
    // Salida junto al original, con .snip al lado.
    let o = run_job(j);
    assert_eq!(o.mode, OutcomeMode::Fast);
    assert!(o.output.ends_with("rapido_snip.mp4"), "{}", o.output);
    let m = probe(&o.output);
    assert_eq!(m.vcodec.as_deref(), Some("h264"));
    assert!((m.duration - 4.0).abs() < 0.2, "dur {}", m.duration);
    let snip = o.project_file.expect(".snip");
    assert!(snip.ends_with("rapido_snip.snip"));
    let back = snip_core::migrate::parse(&std::fs::read_to_string(&snip).unwrap()).unwrap();
    assert_eq!(back.clips.len(), 2);
    assert!(back.exported_at.is_some());
}

#[test]
fn cancel_removes_partials_everywhere() {
    guard!();
    let mut p = project(vec![media("n", "noisy.mp4")], vec![clip("1", "n", 0.0, 12.0)]);
    p.clips[0].smooth_slowmo = true;
    p.clips[0].speed = 0.25;
    let j = job(p, "cancel.mp4");
    let ctl = JobControl::new();
    let c2 = ctl.clone();
    let env = ExportEnv { tools: &fx().tools, encoder: Encoder::Libx264, heavy_dir: &fx().root.join("cache-cancel"), temp_dir: &fx().root.join("tmp") };
    let r = export_project(&env, &j, &ctl, |pr| {
        if pr.percent > 1.0 {
            c2.cancel();
        }
    }, |_| {});
    assert_eq!(r.unwrap_err().kind, ErrorKind::Cancelled);
    let leftovers: Vec<_> = std::fs::read_dir(fx().root.join("cache-cancel"))
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".snip-part"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    assert!(!fx().root.join("out").join("cancel.mp4").exists());
}

#[test]
fn output_resolution_and_fps_changes() {
    guard!();
    let mut p = project(vec![media("b", "b.mkv")], vec![clip("1", "b", 0.0, 2.0)]);
    p.export.resolution = ResolutionChoice::P720;
    p.export.fps = snip_core::export::FpsChoice::Fps30;
    let o = run(p, "720.mp4");
    let m = probe(&o.output);
    assert_eq!((m.width, m.height), (1280, 720));
    assert!((m.fps - 30.0).abs() < 0.01);
    assert!(m.acodec.is_none());
}

#[test]
fn waveform_and_media_probing() {
    guard!();
    let peaks = snip_core::audio::waveform(&fx().tools, Path::new(&path("a.mp4"))).unwrap();
    assert!((peaks.len() as i64 - 1000).abs() <= 2, "100 por segundo: {}", peaks.len());
    assert!(peaks.iter().skip(10).take(900).all(|p| *p > 60), "un tono constante");
    let m = media("m", "music.mp3");
    assert_eq!(m.kind, MediaKind::Audio);
    assert!((m.duration - 30.0).abs() < 0.2);
    let v = media("c", "c.webm");
    assert_eq!((v.kind, v.width, v.height), (MediaKind::Video, 360, 640));
    assert_eq!(v.video_codec.as_deref(), Some("vp9"));
}

#[test]
fn transcription_audio_is_16k_mono_wav_of_the_whole_mix() {
    guard!();
    let a = media("a", "a.mp4");
    let q = media("q", "quiet.mp4");
    let mut p = project(vec![a, q], vec![clip("c1", "a", 1.0, 3.0), clip("c2", "q", 0.0, 2.0)]);
    p.clips[0].speed = 2.0; // 1 s en el timeline
    let env = ExportEnv { tools: &fx().tools, encoder: Encoder::Libx264, heavy_dir: &fx().root.join("cache"), temp_dir: &fx().root.join("tmp") };
    let wav = fx().root.join("out").join("transcribir.wav");
    let mut last = 0.0;
    let d = snip_core::transcribe::extract_audio(&env, &p, &wav, &JobControl::new(), |pct| last = pct).unwrap();
    assert!((d - 3.0).abs() < 0.05, "duración {d}");
    assert!(last > 90.0);
    let out = Command::new(&fx().tools.ffprobe)
        .args(["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", wav.to_str().unwrap()])
        .output()
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["streams"][0]["codec_name"], "pcm_s16le");
    assert_eq!(v["streams"][0]["sample_rate"], "16000");
    assert_eq!(v["streams"][0]["channels"], 1);
    let dur: f64 = v["format"]["duration"].as_str().unwrap().parse().unwrap();
    assert!((dur - 3.0).abs() < 0.05, "wav {dur}");
    // Sin audio: error claro.
    let b = media("b", "b.mkv");
    let mute = project(vec![b], vec![clip("c", "b", 0.0, 1.0)]);
    let e = snip_core::transcribe::extract_audio(&env, &mute, &wav, &JobControl::new(), |_| {}).unwrap_err();
    assert_eq!(e.kind, ErrorKind::NoAudio);
}

/// Tanda 2: todo junto en un export (imagen, capas, zona y PiP).
#[test]
fn image_effects_layers_zones_and_pip_together() {
    guard!();
    use snip_core::project_export::{PipSpec, RasterSpec};
    let root = &fx().root;
    let r = root.join("raster-t2");
    std::fs::create_dir_all(&r).unwrap();
    let rp = |n: &str| r.join(n).to_string_lossy().into_owned();
    // Capa de decoración: un PNG con transparencia (como los del frontend) los primeros 2 s.
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=white@0.0:s=640x360,format=rgba,drawbox=x=40:y=280:w=300:h=50:color=yellow@0.9:t=fill:replace=1", "-frames:v", "1", &rp("f1.png")]);
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=white@0.0:s=640x360,format=rgba", "-frames:v", "1", &rp("f2.png")]);
    std::fs::write(r.join("decor.ffconcat"), "ffconcat version 1.0\nfile 'f1.png'\nduration 2\nfile 'f2.png'\nduration 10\nfile 'f2.png'\n").unwrap();
    // Máscara de la zona (blanco = desenfocado).
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=black:s=640x360,drawbox=x=100:y=60:w=160:h=120:color=white:t=fill", "-frames:v", "1", &rp("m1.png")]);
    std::fs::write(r.join("blur.ffconcat"), "ffconcat version 1.0\nfile 'm1.png'\nduration 10\nfile 'm1.png'\n").unwrap();
    // PiP: máscara redondeada (aproximada con un rectángulo) y sombra.
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=white:s=192x108", "-frames:v", "1", &rp("pm.png")]);
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=black@0.0:s=640x360,format=rgba,drawbox=x=420:y=230:w=200:h=116:color=black@0.4:t=fill:replace=1", "-frames:v", "1", &rp("ps.png")]);

    let a = media("a", "a.mp4");
    let d = media("d", "d.mov");
    let c = media("c", "c.webm");
    let mut p = project(vec![a, d, c], vec![clip("c1", "a", 0.0, 3.0), clip("c2", "d", 0.5, 3.5)]);
    {
        let v = &mut p.clips[0].video;
        v.crop = Some(CropRect { x: 0.1, y: 0.05, w: 0.8, h: 0.9, aspect: None });
        v.color = ColorAdjust { brightness: 0.1, contrast: 0.2, saturation: -0.3, temperature: 0.4, exposure: 0.1 };
        v.look = Some(Look { id: "cinema".into(), intensity: 0.8 });
        v.sharpen = 0.4;
        v.zoom = vec![
            ZoomKey { id: 1, t: 0.0, zoom: 1.0, cx: 0.5, cy: 0.5, easing: Easing::Linear },
            ZoomKey { id: 2, t: 3.0, zoom: 1.6, cx: 0.3, cy: 0.6, easing: Easing::EaseInOut },
        ];
    }
    {
        let v = &mut p.clips[1].video;
        v.rotate = 180;
        v.flip_h = true;
        v.stabilize = Some(Stabilize { strength: 0.5 });
        v.denoise = 0.5;
    }
    p.overlays.push(Overlay {
        id: "z".into(),
        start: 1.0,
        duration: 3.0,
        lane: 0,
        content: OverlayContent::Blur(BlurLayer { mode: BlurMode::Pixelate, strength: 0.5, rect: Rect { x: 0.15, y: 0.15, w: 0.25, h: 0.35 }, keys: vec![] }),
    });
    p.overlays.push(Overlay {
        id: "pip".into(),
        start: 2.0,
        duration: 3.0,
        lane: 1,
        content: OverlayContent::Video(PipLayer { media_id: "c".into(), in_point: 0.5, x: 0.8, y: 0.8, width: 0.3, radius: 0.1, shadow: true, volume: 0.7, chroma: None, mask: None }),
    });
    let mut j = job(p, "tanda2.mp4");
    let mut pips = std::collections::HashMap::new();
    pips.insert("pip".to_string(), PipSpec { mask: rp("pm.png"), shadow: Some(rp("ps.png")), width: 192, height: 108, x: 416, y: 234, shadow_x: 0, shadow_y: 0 });
    let mut masks = std::collections::HashMap::new();
    masks.insert("z".to_string(), r.join("blur.ffconcat").to_string_lossy().into_owned());
    j.raster = Some(RasterSpec { dir: None, decor: Some(r.join("decor.ffconcat").to_string_lossy().into_owned()), masks, pips });
    let o = run_job(j);
    let pr = probe(&o.output);
    // 3 s + 3 s, 640x360 (lienzo del primer clip: el recorte no cambia el lienzo de un proyecto armado a mano), 30 fps.
    assert!((pr.duration - 6.0).abs() < 0.12, "duración {}", pr.duration);
    assert_eq!((pr.width, pr.height), (640, 360));
    assert!((pr.fps - 30.0).abs() < 0.01);
    assert_eq!(pr.vcodec.as_deref(), Some("h264"));
    assert_eq!(pr.acodec.as_deref(), Some("aac"));
    assert!(frame_count(&o.output) >= 178);
    // La capa amarilla (decoración) se ve en los primeros 2 s.
    let yellow = |t: f64| {
        let out = Command::new(&fx().tools.ffmpeg)
            .args(["-v", "error", "-ss", &format!("{t}"), "-i", &o.output, "-frames:v", "1", "-vf", "crop=300:50:40:280,scale=1:1,format=rgb24", "-f", "rawvideo", "-"])
            .output()
            .unwrap()
            .stdout;
        (out[0] as i32, out[1] as i32, out[2] as i32)
    };
    let (r1, g1, b1) = yellow(1.0);
    assert!(r1 > 150 && g1 > 150 && b1 < 120, "amarillo: {r1},{g1},{b1}");
}

#[test]
fn speed_ramp_matches_the_timeline_length_with_or_without_audio() {
    guard!();
    for (audio, name) in [(RampAudio::Mute, "rampa-muda.mp4"), (RampAudio::Pitch, "rampa-tono.mp4")] {
        let mut c = clip("c1", "m1", 1.0, 5.0);
        c.speed_keys = snip_core::ramp::preset("slowmo-middle", 4.0);
        c.ramp_audio = audio;
        let p = project(vec![media("m1", "a.mp4")], vec![c.clone()]);
        let expected = snip_core::timeline::clip_duration(&c);
        assert!(expected > 6.0, "la cámara lenta alarga: {expected}");
        let o = run(p, name);
        let pr = probe(&o.output);
        assert!((pr.duration - expected).abs() < 0.1, "{name}: {} vs {expected}", pr.duration);
        assert_eq!(pr.fps.round(), 30.0);
        // Con tono preservado suena el tono de 440 Hz; muda, silencio.
        let loud = luma_free_audio_level(&o.output);
        if audio == RampAudio::Pitch {
            assert!(loud > -40.0, "{name}: {loud}");
        } else {
            assert!(loud < -70.0, "{name}: {loud}");
        }
    }
}

/// Nivel RMS (dB) del audio exportado.
fn luma_free_audio_level(p: &str) -> f64 {
    let out = Command::new(&fx().tools.ffmpeg)
        .args(["-v", "info", "-i", p, "-map", "0:a:0", "-af", "astats=metadata=0:measure_perchannel=none:measure_overall=RMS_level", "-f", "null", "-"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stderr).lines().filter_map(|l| l.split("RMS level dB:").nth(1)).filter_map(|v| v.trim().parse().ok()).next_back().unwrap_or(-120.0)
}

#[test]
fn pip_chroma_key_shows_the_background_and_keeps_the_subject() {
    guard!();
    use snip_core::project_export::{PipSpec, RasterSpec};
    let r = fx().root.join("chroma");
    std::fs::create_dir_all(&r).unwrap();
    let rp = |n: &str| r.join(n).to_string_lossy().into_owned();
    // Fondo azul; el PiP: pantalla verde con un cuadrado rojo al medio.
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=0x2040c0:s=640x360:r=30:d=3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &rp("fondo.mp4")]);
    gen(&fx().tools, &[
        "-f", "lavfi", "-i", "color=c=0x00b140:s=640x360:r=30:d=3,drawbox=x=220:y=120:w=200:h=120:color=0xd02020:t=fill",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &rp("verde.mp4"),
    ]);
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=white:s=640x360", "-frames:v", "1", &rp("mask.png")]);
    let px = |file: &str, x: u32, y: u32| {
        let out = Command::new(&fx().tools.ffmpeg)
            .args(["-v", "error", "-ss", "1", "-i", file, "-frames:v", "1", "-vf", &format!("crop=8:8:{x}:{y},scale=1:1,format=rgb24"), "-f", "rawvideo", "-"])
            .output()
            .unwrap()
            .stdout;
        (out[0] as i32, out[1] as i32, out[2] as i32)
    };
    for (chroma, name) in [(None, "sin-llave.mp4"), (Some(ChromaKey { color: "#00b140".into(), similarity: 0.15, smoothness: 0.08, despill: 0.5 }), "con-llave.mp4")] {
        let mut p = project(vec![media("f", "chroma/fondo.mp4"), media("g", "chroma/verde.mp4")], vec![clip("c1", "f", 0.0, 3.0)]);
        p.overlays.push(Overlay {
            id: "pip".into(),
            start: 0.0,
            duration: 3.0,
            lane: 0,
            content: OverlayContent::Video(PipLayer { media_id: "g".into(), in_point: 0.0, x: 0.5, y: 0.5, width: 1.0, radius: 0.0, shadow: false, volume: 0.0, chroma: chroma.clone(), mask: None }),
        });
        let mut j = job(p, name);
        let mut pips = std::collections::HashMap::new();
        pips.insert("pip".to_string(), PipSpec { mask: rp("mask.png"), shadow: None, width: 640, height: 360, x: 0, y: 0, shadow_x: 0, shadow_y: 0 });
        j.raster = Some(RasterSpec { dir: None, decor: None, masks: Default::default(), pips });
        let o = run_job(j);
        let (r0, g0, b0) = px(&o.output, 40, 40);
        let (r1, g1, b1) = px(&o.output, 316, 176);
        assert!(r1 > 170 && g1 < 70 && b1 < 70, "{name}: el sujeto queda rojo: {r1},{g1},{b1}");
        if chroma.is_some() {
            assert!(b0 > 160 && g0 < 100 && r0 < 70, "{name}: se ve el fondo azul: {r0},{g0},{b0}");
        } else {
            assert!(g0 > 140 && b0 < 100, "{name}: sin llave queda verde: {r0},{g0},{b0}");
        }
    }
}

#[test]
fn effect_blocks_flash_vignette_and_shake_render_where_they_should() {
    guard!();
    let r = fx().root.join("fx");
    std::fs::create_dir_all(&r).unwrap();
    let gray = r.join("gris.mp4").to_string_lossy().into_owned();
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=0x808080:s=640x360:r=30:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &gray]);
    let fxo = |id: &str, kind: EffectKind, start: f64, duration: f64| Overlay { id: id.into(), start, duration, lane: 0, content: OverlayContent::Effect(EffectLayer { kind, intensity: 1.0 }) };
    let mut p = project(vec![media("g", "fx/gris.mp4")], vec![clip("c1", "g", 0.0, 4.0)]);
    p.overlays.push(fxo("f", EffectKind::Flash, 0.5, 0.5));
    p.overlays.push(fxo("v", EffectKind::Vignette, 2.0, 1.5));
    p.overlays.push(fxo("s", EffectKind::Shake, 3.6, 0.3));
    let o = run(p, "efectos.mp4");
    let luma = |t: f64, crop: &str| {
        let out = Command::new(&fx().tools.ffmpeg)
            .args(["-v", "error", "-ss", &format!("{t}"), "-i", &o.output, "-frames:v", "1", "-vf", &format!("{crop},scale=1:1,format=gray"), "-f", "rawvideo", "-"])
            .output()
            .unwrap()
            .stdout;
        out[0] as i32
    };
    let full = "crop=iw:ih:0:0";
    let corner = "crop=40:40:0:0";
    let center = "crop=40:40:300:160";
    let base = luma(0.2, full);
    // Flash: en el pico (τ = 0,08 s) casi blanco; después vuelve.
    assert!(luma(0.6, full) > 225, "flash: {}", luma(0.6, full));
    assert!((luma(1.5, full) - base).abs() < 4, "después del flash");
    // Viñeta: esquinas oscuras, centro igual.
    assert!(luma(2.7, corner) < base - 50, "esquina {} vs {base}", luma(2.7, corner));
    assert!((luma(2.7, center) - base).abs() < 4, "centro");
    assert!((luma(3.55, corner) - base).abs() < 4, "fuera de la viñeta");
    assert!((probe(&o.output).duration - 4.0).abs() < 0.1);
}

#[test]
fn pip_mask_sequence_follows_the_timeline() {
    guard!();
    use snip_core::project_export::{PipSpec, RasterSpec};
    let r = fx().root.join("mask");
    std::fs::create_dir_all(&r).unwrap();
    let rp = |n: &str| r.join(n).to_string_lossy().into_owned();
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=0x2040c0:s=640x360:r=30:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &rp("fondo.mp4")]);
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=0xd02020:s=640x360:r=30:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &rp("rojo.mp4")]);
    // Dos estados de la máscara (mitad izquierda, después mitad derecha), como los arma el frontend.
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=black:s=640x360,drawbox=x=0:y=0:w=320:h=360:color=white:t=fill", "-frames:v", "1", &rp("pm_00001.png")]);
    gen(&fx().tools, &["-f", "lavfi", "-i", "color=c=black:s=640x360,drawbox=x=320:y=0:w=320:h=360:color=white:t=fill", "-frames:v", "1", &rp("pm_00002.png")]);
    std::fs::write(r.join("pipmask0.ffconcat"), "ffconcat version 1.0\nfile 'pm_00001.png'\nduration 2.0\nfile 'pm_00002.png'\nduration 10\nfile 'pm_00002.png'\n").unwrap();
    let mut p = project(vec![media("f", "mask/fondo.mp4"), media("g", "mask/rojo.mp4")], vec![clip("c1", "f", 0.0, 4.0)]);
    p.overlays.push(Overlay {
        id: "pip".into(),
        start: 0.0,
        duration: 4.0,
        lane: 0,
        content: OverlayContent::Video(PipLayer { media_id: "g".into(), in_point: 0.0, x: 0.5, y: 0.5, width: 1.0, radius: 0.0, shadow: false, volume: 0.0, chroma: None, mask: None }),
    });
    let mut j = job(p, "mascara.mp4");
    let mut pips = std::collections::HashMap::new();
    pips.insert("pip".to_string(), PipSpec { mask: rp("pipmask0.ffconcat"), shadow: None, width: 640, height: 360, x: 0, y: 0, shadow_x: 0, shadow_y: 0 });
    j.raster = Some(RasterSpec { dir: None, decor: None, masks: Default::default(), pips });
    let o = run_job(j);
    let red = |t: f64, x: u32| {
        let out = Command::new(&fx().tools.ffmpeg)
            .args(["-v", "error", "-ss", &format!("{t}"), "-i", &o.output, "-frames:v", "1", "-vf", &format!("crop=20:20:{x}:170,scale=1:1,format=rgb24"), "-f", "rawvideo", "-"])
            .output()
            .unwrap()
            .stdout;
        out[0] > 150 && out[2] < 100
    };
    assert!(red(1.0, 100) && !red(1.0, 500), "primero la mitad izquierda");
    assert!(!red(3.0, 100) && red(3.0, 500), "después la derecha");
}
