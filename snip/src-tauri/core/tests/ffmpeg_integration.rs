//! Integración con FFmpeg real.
//!
//! Genera videos de prueba (H.264 y HEVC, con y sin audio, rotado, audio no
//! compatible), corre exactamente los mismos argumentos que usa la app y verifica
//! las salidas con ffprobe.
//!
//! Usa los binarios de `SNIP_FFMPEG_DIR` (por defecto /opt/ffmpeg9/bin, misma
//! versión 9.0 que se empaqueta en la app). También se compila para Windows y
//! se corre con los ffmpeg.exe/ffprobe.exe reales del instalador. Si no
//! existen, los tests fallan: poné `SNIP_SKIP_INTEGRATION=1` para saltearlos.

use snip_core::encoder::Encoder;
use snip_core::error::ErrorKind;
use snip_core::export::{ExportMode, ExportRequest, FpsChoice};
use snip_core::probe::MediaInfo;
use snip_core::runner::{JobControl, Tools};
use snip_core::scale::ResolutionChoice;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

struct Fixtures {
    _dir: tempfile::TempDir,
    root: PathBuf,
    tools: Tools,
}

fn tools_dir() -> PathBuf {
    std::env::var_os("SNIP_FFMPEG_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/opt/ffmpeg9/bin"))
}

fn skip() -> bool {
    std::env::var_os("SNIP_SKIP_INTEGRATION").is_some()
}

fn gen(tools: &Tools, args: &[&str]) {
    let st = Command::new(&tools.ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .status()
        .expect("correr ffmpeg");
    assert!(st.success(), "no se pudo generar fixture: {args:?}");
}

fn fixtures() -> &'static Fixtures {
    static F: OnceLock<Fixtures> = OnceLock::new();
    F.get_or_init(|| {
        let dir = tools_dir();
        let exe = std::env::consts::EXE_SUFFIX;
        let tools = Tools { ffmpeg: dir.join(format!("ffmpeg{exe}")), ffprobe: dir.join(format!("ffprobe{exe}")) };
        assert!(tools.ffmpeg.is_file(), "No encontré FFmpeg en {} (SNIP_FFMPEG_DIR)", dir.display());
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let p = |n: &str| root.join(n).to_string_lossy().into_owned();

        // H.264 1080p30 + AAC, keyframe cada 1 s, 10 s.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=10",
            "-f", "lavfi", "-i", "sine=f=440:r=48000:d=10",
            "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", &p("h264_aac.mp4"),
        ]);
        // H.264 720p60 sin audio, 6 s.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=60:d=6",
            "-c:v", "libx264", "-preset", "ultrafast", "-g", "60", "-pix_fmt", "yuv420p", &p("h264_noaudio.mp4"),
        ]);
        // HEVC 1080p30 + AAC, keyframe cada 2 s, 8 s.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=8",
            "-f", "lavfi", "-i", "sine=f=660:r=48000:d=8",
            "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "keyint=60:min-keyint=60:scenecut=0:log-level=error",
            "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &p("hevc_aac.mp4"),
        ]);
        // HEVC sin audio, 5 s.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=5",
            "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error", "-pix_fmt", "yuv420p",
            &p("hevc_noaudio.mp4"),
        ]);
        // Rotado 90° (como un celular grabando vertical).
        gen(&tools, &["-display_rotation", "90", "-i", &p("hevc_noaudio.mp4"), "-c", "copy", &p("hevc_rotated.mp4")]);
        // Audio PCM dentro de MP4 (no lo copiamos en modo preciso → AAC 320k).
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=d=4",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-shortest", &p("pcm_audio.mp4"),
        ]);
        // Video más largo para probar la cancelación.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=40",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", &p("long.mp4"),
        ]);
        // Solo audio con extensión .mp4.
        gen(&tools, &["-f", "lavfi", "-i", "sine=d=2", "-c:a", "aac", &p("audio_only.mp4")]);
        // Archivo corrupto: la mitad de un MP4 sin faststart (sin moov).
        let full = std::fs::read(root.join("h264_noaudio.mp4")).unwrap();
        std::fs::write(root.join("corrupt.mp4"), &full[..full.len() / 2]).unwrap();
        std::fs::write(root.join("clip.mov"), b"not really").unwrap();
        std::fs::write(root.join("clip.avi"), b"not really").unwrap();

        Fixtures { _dir: tmp, root, tools }
    })
}

fn f(name: &str) -> PathBuf {
    fixtures().root.join(name)
}

fn probe(path: &Path) -> MediaInfo {
    snip_core::probe_file(&fixtures().tools, path).unwrap_or_else(|e| panic!("probe {}: {e:?}", path.display()))
}

/// Lee codec_tag_string del video con ffprobe.
fn codec_tag(path: &Path) -> String {
    let out = Command::new(&fixtures().tools.ffprobe)
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_tag_string", "-of", "csv=p=0"])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn base_req(input: &Path, start: f64, end: f64) -> ExportRequest {
    ExportRequest {
        input: input.to_string_lossy().into_owned(),
        output: None,
        start,
        end,
        mode: ExportMode::Fast,
        resolution: ResolutionChoice::Original,
        fps: FpsChoice::Original,
        frame_exact: false,
        allow_upscale: false,
        allow_fps_increase: false,
    }
}

fn out_path(name: &str) -> Option<String> {
    Some(fixtures().root.join("out").join(name).to_string_lossy().into_owned())
}

fn run_export(req: &ExportRequest, enc: Encoder) -> (snip_core::ExportOutcome, Vec<f64>) {
    std::fs::create_dir_all(fixtures().root.join("out")).unwrap();
    let info = probe(Path::new(&req.input));
    let mut percents = vec![];
    let outcome = snip_core::export(&fixtures().tools, req, &info, enc, &JobControl::new(), |r| percents.push(r.percent), |_| {})
        .unwrap_or_else(|e| panic!("export falló: {e:?}"));
    (outcome, percents)
}

macro_rules! guard {
    () => {
        if skip() {
            eprintln!("SNIP_SKIP_INTEGRATION: salteado");
            return;
        }
    };
}

#[test]
fn probes_all_fixture_kinds() {
    guard!();
    let m = probe(&f("h264_aac.mp4"));
    assert_eq!((m.video_codec.as_str(), m.width, m.height), ("h264", 1920, 1080));
    assert!((m.fps - 30.0).abs() < 0.01);
    assert!((m.duration - 10.0).abs() < 0.1, "dur {}", m.duration);
    assert!(m.has_audio && m.audio_codec.as_deref() == Some("aac"));
    assert_eq!(m.rotation, 0);

    let m = probe(&f("h264_noaudio.mp4"));
    assert!(!m.has_audio);
    assert!((m.fps - 60.0).abs() < 0.01);

    let m = probe(&f("hevc_aac.mp4"));
    assert!(m.is_hevc());
    assert!(m.has_audio);

    let m = probe(&f("hevc_rotated.mp4"));
    assert_eq!(m.rotation % 180, 90, "rotación {}", m.rotation);
    assert_eq!((m.width, m.height), (720, 1280));
    assert_eq!((m.coded_width, m.coded_height), (1280, 720));
}

#[test]
fn probe_errors_are_friendly() {
    guard!();
    let t = &fixtures().tools;
    // Desde Snip 2 se abren MP4, MOV, MKV y WebM: un .mov roto es "dañado", un .avi no se abre.
    assert_eq!(snip_core::probe_file(t, &f("clip.mov")).unwrap_err().kind, ErrorKind::Corrupt);
    assert_eq!(snip_core::probe_file(t, &f("clip.avi")).unwrap_err().kind, ErrorKind::UnsupportedFormat);
    assert_eq!(snip_core::probe_file(t, &f("no_existe.mp4")).unwrap_err().kind, ErrorKind::NotFound);
    assert_eq!(snip_core::probe_file(t, &f("audio_only.mp4")).unwrap_err().kind, ErrorKind::NoVideo);
    assert_eq!(snip_core::probe_file(t, &f("corrupt.mp4")).unwrap_err().kind, ErrorKind::Corrupt);
}

#[test]
fn keyframes_are_listed() {
    guard!();
    let k = snip_core::keyframes(&fixtures().tools, &f("h264_aac.mp4")).unwrap();
    assert_eq!(k.len(), 10, "{k:?}");
    assert!((k[3] - 3.0).abs() < 0.01);
    let k = snip_core::keyframes(&fixtures().tools, &f("hevc_aac.mp4")).unwrap();
    assert_eq!(k.len(), 4, "{k:?}");
}

#[test]
fn fast_h264_copy_keeps_codec_and_snaps_to_keyframe() {
    guard!();
    let mut r = base_req(&f("h264_aac.mp4"), 2.5, 6.0);
    r.output = out_path("fast_h264.mp4");
    let (o, percents) = run_export(&r, Encoder::Libx264);
    assert_eq!(o.mode, ExportMode::Fast);
    assert_eq!(o.encoder, None);
    let m = probe(Path::new(&o.output));
    assert_eq!(m.video_codec, "h264");
    assert_eq!((m.width, m.height), (1920, 1080));
    assert!((m.fps - 30.0).abs() < 0.01);
    assert!(m.has_audio && m.audio_codec.as_deref() == Some("aac"));
    // Sin recodificar el corte cae en el keyframe anterior (2.0 s): dura entre 3.5 y 4.0 s.
    assert!(m.duration > 3.45 && m.duration < 4.1, "duración {}", m.duration);
    assert_eq!(percents.last().copied(), Some(100.0));
}

#[test]
fn fast_hevc_copy_keeps_hevc_with_hvc1() {
    guard!();
    let mut r = base_req(&f("hevc_aac.mp4"), 1.0, 5.0);
    r.output = out_path("fast_hevc.mp4");
    let (o, _) = run_export(&r, Encoder::Libx264);
    let m = probe(Path::new(&o.output));
    assert!(m.is_hevc());
    assert_eq!(codec_tag(Path::new(&o.output)), "hvc1");
    assert!(m.duration > 3.95 && m.duration < 5.1, "duración {}", m.duration);
}

#[test]
fn precise_frame_exact_h264() {
    guard!();
    let mut r = base_req(&f("h264_aac.mp4"), 2.5, 6.0);
    r.frame_exact = true;
    r.output = out_path("exact.mp4");
    let (o, percents) = run_export(&r, Encoder::Libx264);
    assert_eq!(o.mode, ExportMode::Precise);
    assert_eq!(o.encoder, Some(Encoder::Libx264));
    let m = probe(Path::new(&o.output));
    assert_eq!(m.video_codec, "h264");
    assert!((m.duration - 3.5).abs() < 0.05, "duración {}", m.duration);
    assert_eq!(m.frame_count, 105, "3.5 s × 30 fps");
    assert_eq!(m.audio_codec.as_deref(), Some("aac"));
    assert!(percents.len() >= 2, "debería haber progreso intermedio: {percents:?}");
    assert!(percents.windows(2).all(|w| w[1] >= w[0]), "progreso no monótono: {percents:?}");
}

#[test]
fn precise_resolution_and_fps_change() {
    guard!();
    let mut r = base_req(&f("h264_aac.mp4"), 0.0, 4.0);
    r.resolution = ResolutionChoice::P720;
    r.fps = FpsChoice::Fps24;
    r.output = out_path("720p24.mp4");
    let (o, _) = run_export(&r, Encoder::Libx264);
    let m = probe(Path::new(&o.output));
    assert_eq!((m.width, m.height), (1280, 720));
    assert!((m.fps - 24.0).abs() < 0.01, "fps {}", m.fps);
    assert!((m.duration - 4.0).abs() < 0.1);
    assert_eq!(m.video_codec, "h264");
}

#[test]
fn hevc_to_h264_with_confirmed_fps_increase() {
    guard!();
    let mut r = base_req(&f("hevc_aac.mp4"), 0.0, 3.0);
    r.fps = FpsChoice::Fps60;
    r.output = out_path("hevc60.mp4");
    let info = probe(&f("hevc_aac.mp4"));
    let e = snip_core::export(&fixtures().tools, &r, &info, Encoder::Libx264, &JobControl::new(), |_| {}, |_| {}).unwrap_err();
    assert_eq!(e.kind, ErrorKind::FpsIncreaseNotConfirmed);
    r.allow_fps_increase = true;
    let (o, _) = run_export(&r, Encoder::Libx264);
    let m = probe(Path::new(&o.output));
    assert_eq!(m.video_codec, "h264", "el modo preciso siempre exporta H.264");
    assert!((m.fps - 60.0).abs() < 0.01);
}

#[test]
fn custom_upscale_needs_confirmation_and_keeps_aspect() {
    guard!();
    let mut r = base_req(&f("h264_noaudio.mp4"), 0.0, 1.0);
    r.resolution = ResolutionChoice::Custom { width: 1921 };
    r.output = out_path("up.mp4");
    let info = probe(&f("h264_noaudio.mp4"));
    let e = snip_core::export(&fixtures().tools, &r, &info, Encoder::Libx264, &JobControl::new(), |_| {}, |_| {}).unwrap_err();
    assert_eq!(e.kind, ErrorKind::UpscaleNotConfirmed);
    r.allow_upscale = true;
    let (o, _) = run_export(&r, Encoder::Libx264);
    let m = probe(Path::new(&o.output));
    assert_eq!((m.width, m.height), (1922, 1082));
    assert!(!m.has_audio);
}

#[test]
fn rotated_source_is_autorotated_when_reencoding() {
    guard!();
    let mut r = base_req(&f("hevc_rotated.mp4"), 0.0, 2.0);
    r.resolution = ResolutionChoice::P720;
    r.output = out_path("rot.mp4");
    let (o, _) = run_export(&r, Encoder::Libx264);
    let m = probe(Path::new(&o.output));
    assert_eq!((m.width, m.height), (720, 1280));
    assert_eq!(m.rotation, 0);
    assert_eq!((m.coded_width, m.coded_height), (720, 1280));
}

#[test]
fn incompatible_audio_becomes_aac() {
    guard!();
    let info = probe(&f("pcm_audio.mp4"));
    assert_eq!(info.audio_codec.as_deref(), Some("pcm_s16le"));
    let mut r = base_req(&f("pcm_audio.mp4"), 0.0, 2.0);
    r.frame_exact = true;
    r.output = out_path("pcm.mp4");
    let (o, _) = run_export(&r, Encoder::Libx264);
    let m = probe(Path::new(&o.output));
    assert_eq!(m.audio_codec.as_deref(), Some("aac"));
    let r2 = Command::new(&fixtures().tools.ffprobe)
        .args(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=bit_rate", "-of", "csv=p=0"])
        .arg(&o.output)
        .output()
        .unwrap();
    let br: u64 = String::from_utf8_lossy(&r2.stdout).trim().parse().unwrap_or(0);
    assert!(br > 100_000, "bitrate de audio {br}");
}

#[test]
fn default_names_never_overwrite() {
    guard!();
    let dir = fixtures().root.join("naming");
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("clip.mp4");
    std::fs::copy(f("h264_noaudio.mp4"), &input).unwrap();
    let r = base_req(&input, 0.0, 1.0);
    let (a, _) = run_export(&r, Encoder::Libx264);
    let (b, _) = run_export(&r, Encoder::Libx264);
    let (c, _) = run_export(&r, Encoder::Libx264);
    assert_eq!(Path::new(&a.output).file_name().unwrap(), "clip_snip.mp4");
    assert_eq!(Path::new(&b.output).file_name().unwrap(), "clip_snip (2).mp4");
    assert_eq!(Path::new(&c.output).file_name().unwrap(), "clip_snip (3).mp4");
    // No quedan parciales.
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".snip-part"))
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
fn saving_over_the_input_is_refused() {
    guard!();
    let mut r = base_req(&f("h264_noaudio.mp4"), 0.0, 1.0);
    r.output = Some(f("h264_noaudio.mp4").to_string_lossy().into_owned());
    let info = probe(&f("h264_noaudio.mp4"));
    let e = snip_core::export(&fixtures().tools, &r, &info, Encoder::Libx264, &JobControl::new(), |_| {}, |_| {}).unwrap_err();
    assert_eq!(e.kind, ErrorKind::SameAsInput);
}

#[test]
fn cancel_kills_ffmpeg_and_deletes_the_partial() {
    guard!();
    let dir = fixtures().root.join("cancel");
    std::fs::create_dir_all(&dir).unwrap();
    let final_out = dir.join("cancelado.mp4");
    let mut r = base_req(&f("long.mp4"), 0.0, 40.0);
    r.frame_exact = true; // recodifica con libx264 slow: tarda lo suficiente
    r.output = Some(final_out.to_string_lossy().into_owned());
    let info = probe(&f("long.mp4"));
    let job = JobControl::new();
    let job2 = job.clone();
    let started = std::time::Instant::now();
    let mut saw_partial = false;
    let partial = snip_core::naming::partial_path(&final_out);
    let res = snip_core::export(
        &fixtures().tools,
        &r,
        &info,
        Encoder::Libx264,
        &job,
        |p| {
            if p.percent > 0.0 && !job2.is_cancelled() {
                saw_partial = partial.exists();
                job2.cancel();
            }
        },
        |_| {},
    );
    assert_eq!(res.unwrap_err().kind, ErrorKind::Cancelled);
    assert!(saw_partial, "el parcial debería existir mientras exporta");
    assert!(!partial.exists(), "el parcial tiene que borrarse");
    assert!(!final_out.exists(), "no tiene que quedar el archivo final");
    assert!(started.elapsed().as_secs() < 30, "cancelar tiene que ser inmediato");
}

#[test]
fn hardware_encoder_failure_falls_back_to_libx264() {
    guard!();
    // En este entorno no hay GPU: NVENC falla de verdad y se reintenta con libx264.
    let mut r = base_req(&f("h264_noaudio.mp4"), 0.0, 1.0);
    r.frame_exact = true;
    r.output = out_path("fallback.mp4");
    let info = probe(&f("h264_noaudio.mp4"));
    let mut failed = vec![];
    let o = snip_core::export(&fixtures().tools, &r, &info, Encoder::Nvenc, &JobControl::new(), |_| {}, |e| failed.push(e)).unwrap();
    assert_eq!(failed, vec![Encoder::Nvenc]);
    assert!(o.fell_back);
    assert_eq!(o.encoder, Some(Encoder::Libx264));
    assert_eq!(probe(Path::new(&o.output)).video_codec, "h264");
}

#[test]
fn encoder_detection_uses_a_real_one_frame_encode() {
    guard!();
    // Sin GPU en este entorno, la detección tiene que terminar en libx264.
    assert_eq!(snip_core::detect_encoder(&fixtures().tools), Encoder::Libx264);
    // Y el probe de libx264 con sus argumentos reales funciona.
    assert!(snip_core::runner::run_ok(&fixtures().tools.ffmpeg, &Encoder::Libx264.probe_args()));
}

#[test]
fn thumbnails_are_jpegs_generated_in_parallel() {
    guard!();
    let times = snip_core::export::thumbnail_times(10.0, 20);
    let got = std::sync::Mutex::new(vec![]);
    let t0 = std::time::Instant::now();
    snip_core::thumbnails(&fixtures().tools, &f("h264_aac.mp4"), &times, 90, 4, &JobControl::new(), |i, bytes| {
        got.lock().unwrap().push((i, bytes));
    });
    let got = got.into_inner().unwrap();
    assert_eq!(got.len(), 20);
    let mut idx: Vec<usize> = got.iter().map(|g| g.0).collect();
    idx.sort();
    assert_eq!(idx, (0..20).collect::<Vec<_>>());
    for (_, b) in &got {
        assert_eq!(&b[..2], &[0xFF, 0xD8], "JPEG");
    }
    eprintln!("20 miniaturas en {:?}", t0.elapsed());
}

#[test]
fn hevc_preview_proxy_is_h264_720p_with_same_duration() {
    guard!();
    std::fs::create_dir_all(fixtures().root.join("out")).unwrap();
    let out = fixtures().root.join("out").join("proxy.mp4");
    let info = probe(&f("hevc_aac.mp4"));
    let mut last = 0.0;
    let src = f("hevc_aac.mp4");
    let spec = snip_core::ProxySpec { input: &src, output: &out, duration: info.duration, fps: info.fps };
    let p = snip_core::make_proxy(&fixtures().tools, &spec, Encoder::Nvenc, &JobControl::new(), |r| last = r.percent).unwrap();
    let m = probe(&p);
    assert_eq!(m.video_codec, "h264");
    assert_eq!((m.width, m.height), (1280, 720));
    assert!((m.duration - info.duration).abs() < 0.1);
    assert_eq!(last, 100.0);

    let rot_out = fixtures().root.join("out").join("proxy_rot.mp4");
    let src = f("hevc_rotated.mp4");
    let spec = snip_core::ProxySpec { input: &src, output: &rot_out, duration: 5.0, fps: 25.0 };
    let p = snip_core::make_proxy(&fixtures().tools, &spec, Encoder::Libx264, &JobControl::new(), |_| {}).unwrap();
    let m = probe(&p);
    assert_eq!((m.width, m.height), (720, 1280), "vertical: lado corto 720");
}

/// Disco lleno y carpeta de solo lectura, con tmpfs (necesita root; si no se
/// puede montar, se avisa y se saltea).
#[test]
fn disk_full_and_read_only_are_classified() {
    guard!();
    let base = fixtures().root.join("mounts");
    let full = base.join("full");
    let ro = base.join("ro");
    std::fs::create_dir_all(&full).unwrap();
    std::fs::create_dir_all(&ro).unwrap();
    let mount = |opts: &str, dir: &Path| {
        Command::new("mount").args(["-t", "tmpfs", "-o", opts, "tmpfs"]).arg(dir).status().map(|s| s.success()).unwrap_or(false)
    };
    if !mount("size=256k", &full) || !mount("ro,size=1m", &ro) {
        eprintln!("No se pudo montar tmpfs (¿sin root?): test salteado");
        return;
    }
    let info = probe(&f("h264_aac.mp4"));
    let mut r = base_req(&f("h264_aac.mp4"), 0.0, 10.0);
    r.output = Some(full.join("x.mp4").to_string_lossy().into_owned());
    let e = snip_core::export(&fixtures().tools, &r, &info, Encoder::Libx264, &JobControl::new(), |_| {}, |_| {}).unwrap_err();
    let left: Vec<_> = std::fs::read_dir(&full).unwrap().collect();

    r.output = Some(ro.join("x.mp4").to_string_lossy().into_owned());
    let e2 = snip_core::export(&fixtures().tools, &r, &info, Encoder::Libx264, &JobControl::new(), |_| {}, |_| {}).unwrap_err();

    let _ = Command::new("umount").arg(&full).status();
    let _ = Command::new("umount").arg(&ro).status();
    assert_eq!(e.kind, ErrorKind::DiskFull, "{e:?}");
    assert!(left.is_empty(), "el parcial no tiene que quedar en el disco lleno");
    assert_eq!(e2.kind, ErrorKind::PermissionDenied, "{e2:?}");
}
