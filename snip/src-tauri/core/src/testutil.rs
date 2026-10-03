//! Ayudas para los tests unitarios (proyectos y clips de ejemplo).

use crate::project::*;

pub fn media(id: &str, path: &str, dur: f64, w: u32, h: u32, fps: u32, audio: bool) -> MediaRef {
    MediaRef {
        id: id.into(),
        path: path.into(),
        kind: MediaKind::Video,
        duration: dur,
        width: w,
        height: h,
        fps: fps as f64,
        fps_num: fps,
        fps_den: 1,
        has_audio: audio,
        video_codec: Some("h264".into()),
        audio_codec: audio.then(|| "aac".into()),
        rotation: 0,
        size_bytes: None,
        audio_tracks: audio as u32,
        transfer: None,
    }
}

/// Clip "normal" del medio `m1`.
pub fn clip(id: &str, a: f64, b: f64) -> Clip {
    Clip {
        id: id.into(),
        media_id: "m1".into(),
        kind: ClipKind::Video,
        in_point: a,
        out_point: b,
        speed: 1.0,
        smooth_slowmo: false,
        reverse: false,
        loop_mode: LoopMode::None,
        loop_count: 1,
        freeze_duration: 0.0,
        audio: ClipAudio::default(),
        video: ClipVideo::default(),
        transition: None,
    }
}

pub fn project_with(media: Vec<MediaRef>, clips: Vec<Clip>) -> Project {
    let (w, h, fps) = media.first().map(|m| (m.width, m.height, m.fps_num)).unwrap_or((1920, 1080, 30));
    Project {
        version: PROJECT_VERSION,
        id: "p1".into(),
        name: "Proyecto".into(),
        created_at: 1,
        updated_at: 2,
        exported_at: None,
        media,
        clips,
        overlays: vec![],
        music: vec![],
        markers: vec![],
        ranges: vec![],
        subtitles: Subtitles::default(),
        fades: Fades::default(),
        canvas: Canvas { width: w, height: h, fps_num: fps, fps_den: 1, auto: true },
        view: ViewState::default(),
        export: ExportSettings::default(),
        groups: vec![],
        tracks: Tracks::default(),
    }
}

/// Un proyecto con un poco de todo (para tests de serialización).
pub fn sample_project() -> Project {
    let mut p = project_with(
        vec![
            media("m1", "C:\\v\\a.mp4", 20.0, 1920, 1080, 30, true),
            media("m2", "C:\\v\\b.mov", 8.0, 1280, 720, 60, false),
            MediaRef { kind: MediaKind::Audio, ..media("m3", "C:\\m\\tema.mp3", 120.0, 0, 0, 0, true) },
        ],
        vec![clip("c1", 1.0, 5.0), Clip { media_id: "m2".into(), ..clip("c2", 0.0, 3.0) }],
    );
    p.clips[1].transition = Some(Transition { kind: TransitionKind::Fade, duration: 0.5 });
    p.clips[1].speed = 0.5;
    p.clips[1].smooth_slowmo = true;
    p.clips[0].video.zoom.push(ZoomKey { id: 1, t: 0.5, zoom: 1.5, cx: 0.4, cy: 0.5, easing: Easing::EaseInOut });
    p.clips[0].audio.normalize =
        Some(Loudness { input_i: -23.0, input_tp: -4.0, input_lra: 5.0, input_thresh: -33.0, target_offset: 0.2 });
    p.music.push(MusicClip {
        id: "mu1".into(),
        media_id: "m3".into(),
        start: 0.0,
        in_point: 10.0,
        out_point: 30.0,
        volume: 0.5,
        fade_in: 1.0,
        fade_out: 2.0,
        ducking: true,
            track: 0,
            volume_keys: vec![],
            enhance: None,
            linked_clip: None,
            source_track: None,
            muted: false,
    });
    p.markers.push(Marker { id: "k1".into(), time: 2.0, name: "Gol".into() });
    p.ranges.push(TimeRange { id: "r1".into(), start: 0.5, end: 2.5, name: String::new() });
    p.overlays.push(Overlay {
        id: "t1".into(),
        start: 0.0,
        duration: 3.0,
        lane: 0,
        content: OverlayContent::Text(TextLayer {
            text: "Hola".into(),
            template: Some("titulo".into()),
            style: TextStyle {
                font_family: "Segoe UI Variable Display".into(),
                size: 0.08,
                weight: 700,
                italic: false,
                color: "#FFFFFF".into(),
                align: TextAlign::Center,
                stroke: None,
                shadow: Some(Shadow { color: "#000000".into(), blur: 0.2, offset_x: 0.0, offset_y: 0.05 }),
                background: None,
            },
            x: 0.5,
            y: 0.5,
            anim_in: Some(TextAnim { kind: TextAnimKind::Pop, duration: 0.4 }),
            anim_out: None,
        }),
    });
    p.subtitles.cues.push(Cue { id: "s1".into(), start: 0.5, end: 1.5, text: "Hola mundo".into(), words: vec![] });
    p.fades = Fades { fade_in: 0.5, fade_out: 1.0 };
    p
}
