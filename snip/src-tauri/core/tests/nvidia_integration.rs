//! Grabaciones de NVIDIA ShadowPlay / Instant Replay (y parecidas: OBS, celulares).
//!
//! Genera videos con las rarezas que rompían la exportación con NVENC —VFR con
//! base de tiempo 90000, HEVC y AV1, 10 bits HDR (PQ), 4K a 120/144 fps, dos
//! pistas de audio (juego + micrófono) y nombres con varios puntos— y verifica
//! con ffprobe que todo exporta a un H.264 8 bits normal. En este entorno no
//! hay GPU: se exporta pidiendo NVENC, que falla de verdad, y se comprueba el
//! reintento automático con libx264. `SNIP_SKIP_INTEGRATION=1` los saltea.

use snip_core::encoder::Encoder;
use snip_core::project::*;
use snip_core::project_export::{export_project, ExportEnv, ExportJob, ProjectOutcome};
use snip_core::runner::{JobControl, Tools};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

struct Fx {
    _dir: tempfile::TempDir,
    root: PathBuf,
    tools: Tools,
}

const SHADOWPLAY: &str = "Desktop 2026.10.03 - 04.28.16.07.mp4";
const HDR_4K120: &str = "Replay 2026.10.03 - 04.30.01.12.mp4";
const AV1_4K144: &str = "av1_10bit_4k144.mp4";

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
    let out = Command::new(&tools.ffmpeg).args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).output().unwrap();
    assert!(out.status.success(), "fixture: {args:?}\n{}", String::from_utf8_lossy(&out.stderr));
}

/// Pista 0 = "juego" (tono de 440 Hz), pista 1 = "micrófono" (tono de 1 kHz).
const GAME: &str = "sine=f=440:r=48000";
const MIC: &str = "sine=f=1000:r=48000";

fn fx() -> &'static Fx {
    static F: OnceLock<Fx> = OnceLock::new();
    F.get_or_init(|| {
        let dir = std::env::var_os("SNIP_FFMPEG_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/opt/ffmpeg9/bin"));
        let tools = Tools { ffmpeg: dir.join("ffmpeg"), ffprobe: dir.join("ffprobe") };
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let p = |n: &str| root.join(n).to_string_lossy().into_owned();
        // 1) ShadowPlay típico: HEVC 1080p ~60 fps VFR (cuadros con jitter y
        //    uno salteado cada tanto), base de tiempo 90000, dos pistas AAC.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=60:d=3",
            "-f", "lavfi", "-i", &format!("{GAME}:d=3"),
            "-f", "lavfi", "-i", &format!("{MIC}:d=3"),
            "-filter_complex", "[0:v]select='not(eq(mod(n\\,45)\\,7))',setpts='PTS+if(eq(mod(N\\,3)\\,1)\\,0.003/TB\\,0)'[v]",
            "-map", "[v]", "-map", "1:a", "-map", "2:a",
            "-fps_mode", "vfr", "-video_track_timescale", "90000",
            "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error", "-tag:v", "hvc1",
            "-c:a", "aac", "-shortest", &p(SHADOWPLAY),
        ]);
        // 2) HEVC 10 bits HDR (PQ / BT.2020) 4K a 120 fps con dos pistas.
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=3840x2160:r=120:d=1.2",
            "-f", "lavfi", "-i", &format!("{GAME}:d=1.2"),
            "-f", "lavfi", "-i", &format!("{MIC}:d=1.2"),
            "-map", "0:v", "-map", "1:a", "-map", "2:a",
            "-vf", "format=yuv420p10le",
            "-c:v", "libx265", "-preset", "ultrafast",
            "-x265-params", "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr10=1",
            "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
            "-tag:v", "hvc1", "-video_track_timescale", "90000", "-c:a", "aac", "-shortest", &p(HDR_4K120),
        ]);
        // 3) AV1 10 bits 4K a 144 fps con dos pistas (RTX 40/50 graban AV1).
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=3840x2160:r=144:d=1",
            "-f", "lavfi", "-i", &format!("{GAME}:d=1"),
            "-f", "lavfi", "-i", &format!("{MIC}:d=1"),
            "-map", "0:v", "-map", "1:a", "-map", "2:a",
            "-vf", "format=yuv420p10le",
            "-c:v", "libsvtav1", "-preset", "12", "-svtav1-params", "lp=4",
            "-c:a", "aac", "-shortest", &p(AV1_4K144),
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

fn media(file: &str) -> MediaRef {
    snip_core::probe_media(&fx().tools, Path::new(&path(file)), "m1").unwrap()
}

fn project(m: MediaRef, a: f64, b: f64, edit: impl FnOnce(&mut Clip)) -> Project {
    let mut c: Clip = serde_json::from_value(serde_json::json!({"id": "c1", "mediaId": "m1", "inPoint": a, "outPoint": b})).unwrap();
    edit(&mut c);
    serde_json::from_value(serde_json::json!({
        "version": 1, "id": "p", "name": "nvidia",
        "media": [m], "clips": [c],
        // Lienzo como lo arma el frontend: tamaño y fps del primer clip.
        "canvas": {"width": m.width & !1, "height": m.height & !1, "fpsNum": m.fps_num, "fpsDen": m.fps_den},
        "export": {"format": "mp4", "mode": "precise"}
    }))
    .unwrap()
}

/// Exporta pidiendo NVENC: acá falla (sin GPU) y tiene que reintentar con x264.
fn export_nvenc(p: Project, out: &str) -> (ProjectOutcome, Vec<Encoder>) {
    let env = ExportEnv { tools: &fx().tools, encoder: Encoder::Nvenc, heavy_dir: &fx().root.join("cache"), temp_dir: &fx().root.join("tmp") };
    let job = ExportJob {
        project: p,
        settings: None,
        window: None,
        output: Some(fx().root.join("out").join(out).to_string_lossy().into_owned()),
        label: None,
        save_project: false,
        raster: None,
    };
    let mut failed = vec![];
    let o = export_project(&env, &job, &JobControl::new(), |_| {}, |e| failed.push(e)).unwrap_or_else(|e| panic!("export {out}: {e:?}"));
    (o, failed)
}

struct Probe {
    vcodec: String,
    pix_fmt: String,
    width: u64,
    height: u64,
    fps: (u64, u64),
    transfer: Option<String>,
    audio_streams: usize,
    duration: f64,
}

fn ffprobe(p: &str) -> Probe {
    let out = Command::new(&fx().tools.ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", p])
        .output()
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let vs = streams.iter().find(|s| s["codec_type"] == "video").expect("hay video").clone();
    let rate = vs["avg_frame_rate"].as_str().unwrap_or("0/1").split_once('/').map(|(a, b)| (a.parse().unwrap_or(0), b.parse().unwrap_or(1))).unwrap();
    Probe {
        vcodec: vs["codec_name"].as_str().unwrap_or("").into(),
        pix_fmt: vs["pix_fmt"].as_str().unwrap_or("").into(),
        width: vs["width"].as_u64().unwrap_or(0),
        height: vs["height"].as_u64().unwrap_or(0),
        fps: rate,
        transfer: vs["color_transfer"].as_str().map(String::from),
        audio_streams: streams.iter().filter(|s| s["codec_type"] == "audio").count(),
        duration: v["format"]["duration"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0.0),
    }
}

/// Energía (RMS, 0..1) de un tono del audio exportado (pasabanda angosto).
fn tone_rms(p: &str, hz: u32) -> f64 {
    let out = Command::new(&fx().tools.ffmpeg)
        .args([
            "-v", "info", "-i", p, "-map", "0:a:0",
            "-af", &format!("bandpass=f={hz}:width_type=h:w=80,bandpass=f={hz}:width_type=h:w=80,astats=metadata=0:measure_perchannel=none:measure_overall=RMS_level"),
            "-f", "null", "-",
        ])
        .output()
        .unwrap();
    let err = String::from_utf8_lossy(&out.stderr);
    let db: f64 = err
        .lines()
        .filter_map(|l| l.split("RMS level dB:").nth(1))
        .filter_map(|v| v.trim().parse().ok())
        .next_back()
        .unwrap_or(-120.0);
    10f64.powf(db / 20.0)
}

/// Lo que tiene que cumplir cualquier exportación de estas grabaciones.
fn assert_normal_h264(o: &ProjectOutcome, failed: &[Encoder], expect_fps: (u64, u64), expect_len: f64) -> Probe {
    assert!(o.fell_back, "NVENC falló y se reintentó solo con libx264");
    assert_eq!(o.encoder, Some(Encoder::Libx264));
    assert_eq!(failed, [Encoder::Nvenc]);
    let pr = ffprobe(&o.output);
    assert_eq!(pr.vcodec, "h264");
    assert_eq!(pr.pix_fmt, "yuv420p", "8 bits 4:2:0");
    assert_eq!(pr.fps, expect_fps, "fps constantes y estándar");
    assert_eq!(pr.audio_streams, 1, "una sola pista (mezclada)");
    assert!((pr.duration - expect_len).abs() < 0.15, "duración {} (esperada {expect_len})", pr.duration);
    pr
}

#[test]
fn probe_reads_shadowplay_quirks() {
    guard!();
    let m = media(SHADOWPLAY);
    assert_eq!(m.audio_tracks, 2);
    assert_eq!((m.width, m.height), (1920, 1080));
    // VFR con 58,7 de promedio grabado a 60 → 60 (nunca 90000/1).
    assert_eq!((m.fps_num, m.fps_den), (60, 1), "fps {}", m.fps);
    assert!(!m.is_hdr());

    let h = media(HDR_4K120);
    assert!(h.is_hdr());
    assert_eq!(h.transfer.as_deref(), Some("smpte2084"));
    assert_eq!((h.fps_num, h.fps_den), (120, 1));
    assert_eq!(h.audio_tracks, 2);

    let a = media(AV1_4K144);
    assert_eq!(a.video_codec.as_deref(), Some("av1"));
    assert_eq!((a.fps_num, a.fps_den), (144, 1));
    let info = snip_core::probe_file(&fx().tools, Path::new(&path(AV1_4K144))).unwrap();
    assert_eq!(info.bit_depth, 10);
}

#[test]
fn shadowplay_vfr_hevc_with_dots_in_the_name_exports() {
    guard!();
    let (o, failed) = export_nvenc(project(media(SHADOWPLAY), 0.2, 2.6, |_| {}), "Desktop 2026.10.03 - 04.28.16.07_snip.mp4");
    // La extensión es solo lo último: el nombre conserva todos los puntos.
    assert!(o.output.ends_with("Desktop 2026.10.03 - 04.28.16.07_snip.mp4"), "{}", o.output);
    assert_normal_h264(&o, &failed, (60, 1), 2.4);
    // Las dos pistas suenan en la mezcla.
    assert!(tone_rms(&o.output, 440) > 0.03, "juego");
    assert!(tone_rms(&o.output, 1000) > 0.03, "micrófono");
}

#[test]
fn hdr_10bit_4k120_is_tonemapped_to_8bit_sdr() {
    guard!();
    let (o, failed) = export_nvenc(project(media(HDR_4K120), 0.0, 1.0, |_| {}), "hdr.mp4");
    let pr = assert_normal_h264(&o, &failed, (120, 1), 1.0);
    assert_eq!((pr.width, pr.height), (3840, 2160));
    assert_ne!(pr.transfer.as_deref(), Some("smpte2084"), "ya no es PQ");
}

#[test]
fn av1_10bit_4k144_exports() {
    guard!();
    let (o, failed) = export_nvenc(project(media(AV1_4K144), 0.0, 0.9, |_| {}), "av1.mp4");
    let pr = assert_normal_h264(&o, &failed, (144, 1), 0.9);
    assert_eq!((pr.width, pr.height), (3840, 2160));
}

#[test]
fn choosing_one_audio_track_drops_the_other() {
    guard!();
    let (o, _) = export_nvenc(project(media(SHADOWPLAY), 0.0, 1.5, |c| c.audio.track = Some(1)), "solo_mic.mp4");
    assert!(tone_rms(&o.output, 1000) > 0.03, "micrófono");
    assert!(tone_rms(&o.output, 440) < 0.01, "sin juego");
}

#[test]
fn heavy_stage_also_mixes_tracks_and_survives_nvenc_failure() {
    guard!();
    // Reversa = etapa pesada: también arranca con NVENC, falla y pasa a x264.
    let (o, failed) = export_nvenc(project(media(SHADOWPLAY), 0.5, 1.7, |c| c.reverse = true), "reversa.mp4");
    assert_normal_h264(&o, &failed, (60, 1), 1.2);
    assert!(tone_rms(&o.output, 440) > 0.03 && tone_rms(&o.output, 1000) > 0.03, "las dos pistas");
}

#[test]
fn fast_mode_never_copies_two_track_recordings() {
    guard!();
    let mut p = project(media(SHADOWPLAY), 0.0, 2.0, |_| {});
    p.export.mode = ModePreference::Auto;
    let (o, _) = export_nvenc(p, "auto.mp4");
    assert_eq!(o.mode, snip_core::project_export::OutcomeMode::Precise);
    assert_eq!(ffprobe(&o.output).audio_streams, 1);
}

#[test]
fn old_projects_with_a_timebase_as_fps_still_export() {
    guard!();
    // Un proyecto guardado con fps = base de tiempo (90000/1) se normaliza.
    let mut p = project(media(SHADOWPLAY), 0.0, 1.0, |_| {});
    p.canvas.fps_num = 90000;
    p.canvas.fps_den = 1;
    let (o, _) = export_nvenc(p, "viejo.mp4");
    let pr = ffprobe(&o.output);
    assert_eq!(pr.fps, (240, 1));
    assert!((pr.duration - 1.0).abs() < 0.1);
}

#[test]
fn output_names_keep_every_dot() {
    let n = snip_core::naming::unique_output_path(Path::new("C:/Videos/Desktop 2026.10.03 - 04.28.16.07.mp4"), |_| false);
    assert_eq!(n.file_name().unwrap().to_string_lossy(), "Desktop 2026.10.03 - 04.28.16.07_snip.mp4");
    let n = snip_core::naming::ensure_mp4_extension(Path::new("C:/Videos/Desktop 2026.10.03 - 04.28.16.07"));
    assert_eq!(n.file_name().unwrap().to_string_lossy(), "Desktop 2026.10.03 - 04.28.16.07.mp4");
    let n = snip_core::naming::project_file_for(Path::new("C:/V/Replay 2026.10.03 - 04.30.01.12_snip.mp4"));
    assert_eq!(n.file_name().unwrap().to_string_lossy(), "Replay 2026.10.03 - 04.30.01.12_snip.snip");
    assert!(snip_core::naming::is_video(Path::new("Desktop 2026.10.03 - 04.28.16.07.MP4")));
    assert!(!snip_core::naming::is_video(Path::new("Desktop 2026.10.03 - 04.28.16.07")));
}
