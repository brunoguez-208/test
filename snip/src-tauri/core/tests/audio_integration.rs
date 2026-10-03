//! Edición de audio con FFmpeg real: audio separado, curvas de volumen, pistas
//! (volumen, silenciar, solo) y "Mejorar voz". Se mide el nivel de tonos con un
//! pasabanda angosto. `SNIP_SKIP_INTEGRATION=1` los saltea.

use snip_core::encoder::Encoder;
use snip_core::project::*;
use snip_core::project_export::{export_project, ExportEnv, ExportJob};
use snip_core::runner::{JobControl, Tools};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

struct Fx {
    _dir: tempfile::TempDir,
    root: PathBuf,
    tools: Tools,
}

macro_rules! guard {
    () => {
        if std::env::var_os("SNIP_SKIP_INTEGRATION").is_some() {
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
        // Video con un tono de 440 Hz (el "audio del video").
        gen(&tools, &[
            "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=6", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", &p("v.mp4"),
        ]);
        // "Voz": 60 Hz (zumbido) + 1 kHz, y un tono de 2 kHz para la música.
        gen(&tools, &["-f", "lavfi", "-i", "sine=f=60:r=48000:d=6", "-f", "lavfi", "-i", "sine=f=1000:r=48000:d=6", "-filter_complex", "amix=inputs=2:normalize=0", &p("voz.wav")]);
        gen(&tools, &["-f", "lavfi", "-i", "sine=f=2000:r=48000:d=6", &p("musica.wav")]);
        for d in ["out", "cache", "tmp"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        Fx { _dir: tmp, root, tools }
    })
}

fn path(n: &str) -> String {
    fx().root.join(n).to_string_lossy().into_owned()
}

fn media(id: &str, file: &str) -> MediaRef {
    snip_core::probe_media(&fx().tools, Path::new(&path(file)), id).unwrap()
}

fn base() -> Project {
    let v = media("m1", "v.mp4");
    let clip: Clip = serde_json::from_value(serde_json::json!({"id": "c1", "mediaId": "m1", "inPoint": 0.0, "outPoint": 6.0})).unwrap();
    serde_json::from_value(serde_json::json!({
        "version": 1, "id": "p", "name": "audio",
        "media": [v, media("m2", "voz.wav"), media("m3", "musica.wav")],
        "clips": [clip],
        "canvas": {"width": 320, "height": 240, "fpsNum": 30, "fpsDen": 1},
        "export": {"format": "mp4", "mode": "precise"}
    }))
    .unwrap()
}

fn audio_clip(id: &str, media: &str, start: f64, len: f64, track: u32) -> MusicClip {
    serde_json::from_value(serde_json::json!({"id": id, "mediaId": media, "start": start, "inPoint": 0.0, "outPoint": len, "volume": 1.0, "track": track})).unwrap()
}

fn export(p: Project, name: &str) -> String {
    let env = ExportEnv { tools: &fx().tools, encoder: Encoder::Libx264, heavy_dir: &fx().root.join("cache"), temp_dir: &fx().root.join("tmp") };
    let job = ExportJob {
        project: p,
        settings: None,
        window: None,
        output: Some(fx().root.join("out").join(name).to_string_lossy().into_owned()),
        label: None,
        save_project: false,
        raster: None,
    };
    export_project(&env, &job, &JobControl::new(), |_| {}, |_| {}).unwrap_or_else(|e| panic!("{name}: {e:?}")).output
}

/// Nivel (dBFS RMS) de un tono en [t, t+d) del audio exportado.
fn tone_db(file: &str, hz: u32, t: f64, d: f64) -> f64 {
    let out = Command::new(&fx().tools.ffmpeg)
        .args([
            "-v", "info", "-ss", &format!("{t}"), "-t", &format!("{d}"), "-i", file, "-map", "0:a:0",
            "-af", &format!("bandpass=f={hz}:width_type=h:w=40,bandpass=f={hz}:width_type=h:w=40,astats=metadata=0:measure_perchannel=none:measure_overall=RMS_level"),
            "-f", "null", "-",
        ])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stderr).lines().filter_map(|l| l.split("RMS level dB:").nth(1)).filter_map(|v| v.trim().parse().ok()).next_back().unwrap_or(-120.0)
}

#[test]
fn separated_audio_sounds_like_the_original() {
    guard!();
    let o1 = export(base(), "junto.mp4");
    let mut p = base();
    p.clips[0].audio.detached = true;
    p.music.push(MusicClip { linked_clip: Some("c1".into()), ..audio_clip("a1", "m1", 0.0, 6.0, 0) });
    let o2 = export(p, "separado.mp4");
    let (a, b) = (tone_db(&o1, 440, 1.0, 3.0), tone_db(&o2, 440, 1.0, 3.0));
    assert!(a > -30.0, "hay tono: {a}");
    assert!((a - b).abs() < 1.0, "mismo nivel junto ({a}) y separado ({b})");
    // Separado pero sin la pista: el clip ya no suena.
    let mut p = base();
    p.clips[0].audio.detached = true;
    let o3 = export(p, "mudo.mp4");
    assert!(tone_db(&o3, 440, 1.0, 3.0) < -60.0);
}

#[test]
fn volume_curve_follows_the_keys() {
    guard!();
    let mut p = base();
    p.clips[0].audio.muted = true;
    let mut m = audio_clip("a1", "m3", 0.0, 6.0, 0);
    m.volume_keys = vec![VolumeKey { id: 1, t: 1.0, v: 1.0 }, VolumeKey { id: 2, t: 3.0, v: 0.1 }];
    p.music.push(m);
    let o = export(p, "curva.mp4");
    let early = tone_db(&o, 2000, 0.2, 0.6);
    let late = tone_db(&o, 2000, 4.0, 1.0);
    assert!((early - late - 20.0).abs() < 1.5, "−20 dB después de la curva: {early} → {late}");
    let mid = tone_db(&o, 2000, 1.95, 0.1);
    assert!(mid < early - 3.0 && mid > late + 3.0, "a mitad de la curva queda en el medio: {mid}");
}

#[test]
fn track_volume_mute_and_solo() {
    guard!();
    let mut p = base();
    p.music.push(audio_clip("a1", "m3", 0.0, 6.0, 0));
    let normal = export(p.clone(), "pistas.mp4");
    let video_db = tone_db(&normal, 440, 1.0, 3.0);
    let music_db = tone_db(&normal, 2000, 1.0, 3.0);
    // Pista de audio a la mitad: −6 dB.
    let mut q = p.clone();
    q.tracks.audio = vec![TrackState { volume: 0.5, ..Default::default() }];
    let o = export(q, "media.mp4");
    assert!((tone_db(&o, 2000, 1.0, 3.0) - (music_db - 6.02)).abs() < 1.0);
    // Silenciar la pista.
    let mut q = p.clone();
    q.tracks.audio = vec![TrackState { muted: true, ..Default::default() }];
    let o = export(q, "silencio.mp4");
    assert!(tone_db(&o, 2000, 1.0, 3.0) < -60.0);
    assert!((tone_db(&o, 440, 1.0, 3.0) - video_db).abs() < 1.0);
    // Solo en el audio del video: la música no suena.
    let mut q = p.clone();
    q.tracks.video_audio.solo = true;
    let o = export(q, "solo.mp4");
    assert!(tone_db(&o, 2000, 1.0, 3.0) < -60.0);
    assert!((tone_db(&o, 440, 1.0, 3.0) - video_db).abs() < 1.0);
}

#[test]
fn enhance_voice_cuts_hum_and_adds_presence() {
    guard!();
    let mut p = base();
    p.clips[0].audio.muted = true;
    p.music.push(audio_clip("a1", "m2", 0.0, 6.0, 0));
    let plain = export(p.clone(), "voz-cruda.mp4");
    let mut q = p.clone();
    q.music[0].enhance = Some(VoiceEnhance { amount: 1.0, loudness: None });
    let fixed = export(q, "voz-mejorada.mp4");
    let hum = tone_db(&plain, 60, 1.0, 3.0) - tone_db(&fixed, 60, 1.0, 3.0);
    let voice = tone_db(&plain, 1000, 1.0, 3.0) - tone_db(&fixed, 1000, 1.0, 3.0);
    // El zumbido baja bastante más que la voz.
    assert!(hum - voice > 6.0, "zumbido −{hum} dB, voz −{voice} dB");
}

#[test]
fn analysis_finds_level_silence_and_attacks() {
    guard!();
    // 1 s de tono, 1 s de silencio, golpes cada 0,5 s; y un archivo con dos pistas.
    let p = |n: &str| fx().root.join(n).to_string_lossy().into_owned();
    gen(&fx().tools, &[
        "-f", "lavfi", "-i", "sine=f=440:r=48000:d=1,volume=0.5", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1",
        "-f", "lavfi", "-i", "aevalsrc='0.9*sin(2*PI*1000*t)*lt(mod(t,0.5),0.03)':s=48000:d=2",
        "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", &p("analisis.wav"),
    ]);
    let a = snip_core::analysis::analyze(&fx().tools, std::path::Path::new(&p("analisis.wav")), 1).unwrap();
    assert_eq!(a.rate, 100);
    assert!((a.level.len() as i32 - 400).abs() <= 2, "{}", a.level.len());
    let db = |i: usize| a.level[i] as f32 / 2.0 - 100.0;
    // `sine` sale con amplitud 1/8: × 0,5 → RMS −27 dBFS.
    assert!((db(50) + 27.0).abs() < 1.0, "tono: {}", db(50));
    assert!(db(150) < -80.0, "silencio: {}", db(150));
    // Los ataques más fuertes caen en los golpes (2,0 · 2,5 · 3,0 · 3,5 s).
    let mut top: Vec<usize> = (205..400).filter(|&i| a.onset[i] > 128).collect();
    top.dedup_by(|x, y| *x - *y < 10);
    assert!(top.iter().all(|&i| (i % 50) < 4 || (i % 50) > 46), "ataques en {top:?}");
    assert!(top.len() >= 3, "{top:?}");
    // Dos pistas (ShadowPlay): se mezclan.
    gen(&fx().tools, &[
        "-f", "lavfi", "-i", "sine=f=300:r=48000:d=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1",
        "-map", "0", "-map", "1", "-c:a", "aac", &p("dos.m4a"),
    ]);
    let b = snip_core::analysis::analyze(&fx().tools, std::path::Path::new(&p("dos.m4a")), 2).unwrap();
    assert!((b.level[50] as f32 / 2.0 - 100.0) > -25.0, "{}", b.level[50] as f32 / 2.0 - 100.0);
}

#[test]
fn bundled_sound_exports_where_it_was_placed() {
    guard!();
    let sfx = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../sfx/impact.wav");
    let m = snip_core::probe_media(&fx().tools, &sfx, "s1").unwrap();
    assert!(m.has_audio && (m.duration - 0.9).abs() < 0.02, "{m:?}");
    let mut p = base();
    p.clips[0].audio.muted = true;
    p.media.push(m);
    p.music.push(audio_clip("a1", "s1", 2.0, 0.9, 0));
    let o = export(p, "con-impacto.mp4");
    let level = |t: f64, d: f64| {
        let out = Command::new(&fx().tools.ffmpeg)
            .args(["-v", "info", "-ss", &format!("{t}"), "-t", &format!("{d}"), "-i", &o, "-map", "0:a:0", "-af", "astats=metadata=0:measure_perchannel=none:measure_overall=Peak_level", "-f", "null", "-"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stderr).lines().filter_map(|l| l.split("Peak level dB:").nth(1)).filter_map(|v| v.trim().parse::<f64>().ok()).next_back().unwrap_or(-120.0)
    };
    assert!(level(0.5, 1.0) < -60.0, "antes, silencio");
    assert!(level(2.0, 0.3) > -6.0, "el golpe suena en 2 s: {}", level(2.0, 0.3));
    assert!(level(3.5, 1.0) < -60.0, "después, silencio");
}
