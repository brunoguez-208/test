//! Modo rápido sin pérdida para proyectos: se usa solo si todos los clips son
//! tramos de un mismo video, sin efectos, en orden, y la salida es MP4/MOV/MKV
//! sin tamaño objetivo. Copia los streams (`-c copy`); con varios cortes, copia
//! cada tramo y los une con el demuxer concat.

use crate::export::audio_copyable;
use crate::graph::s;
use crate::compile::num;
use crate::project::*;
use crate::timeline::{self, EPS};
use std::path::Path;

/// Tramos (inicio, fin) del original a copiar, o None si no se puede.
#[derive(Debug, Clone, PartialEq)]
pub struct FastPlan {
    pub media: MediaRef,
    pub segments: Vec<(f64, f64)>,
}

fn clip_is_plain(c: &Clip) -> bool {
    c.kind == ClipKind::Video
        && (c.speed - 1.0).abs() < 1e-9
        && !c.reverse
        && !c.smooth_slowmo
        && c.loop_mode == LoopMode::None
        && c.transition.is_none()
        && c.audio == ClipAudio::default()
        && c.video == ClipVideo::default()
}

/// ¿El codec se puede copiar tal cual a este contenedor?
pub fn copy_compatible(format: OutputFormat, media: &MediaRef) -> bool {
    let v = media.video_codec.as_deref().unwrap_or("");
    let video_ok = match format {
        OutputFormat::Mkv => true,
        OutputFormat::Mp4 => matches!(v, "h264" | "hevc" | "av1" | "vp9" | "mpeg4"),
        OutputFormat::Mov => matches!(v, "h264" | "hevc" | "prores" | "mpeg4"),
        _ => false,
    };
    let audio_ok = match (&media.audio_codec, format) {
        (None, _) => true,
        (Some(_), OutputFormat::Mkv) => true,
        (Some(a), _) => audio_copyable(a),
    };
    video_ok && audio_ok
}

pub fn plan(p: &Project, st: &ExportSettings, window: Option<(f64, f64)>) -> Option<FastPlan> {
    if st.mode != ModePreference::Auto
        || !st.format.supports_copy()
        || st.size_target.is_some()
        || st.resolution != crate::scale::ResolutionChoice::Original
        || st.fps != crate::export::FpsChoice::Original
        || p.clips.is_empty()
        || !p.overlays.is_empty()
        || !p.music.is_empty()
        || !p.subtitles.cues.is_empty()
        || p.fades.fade_in > EPS
        || p.fades.fade_out > EPS
    {
        return None;
    }
    let media = p.media(&p.clips[0].media_id)?.clone();
    if media.kind != MediaKind::Video {
        return None;
    }
    if p.canvas.width != (media.width & !1) || p.canvas.height != (media.height & !1) {
        return None;
    }
    if (p.canvas.fps() - media.fps).abs() > 0.01 || !copy_compatible(st.format, &media) {
        return None;
    }
    let mut last_out = -1.0;
    for c in &p.clips {
        if c.media_id != media.id || !clip_is_plain(c) || c.in_point < last_out - EPS {
            return None;
        }
        last_out = c.out_point;
    }
    // Pasar el rango del timeline a tramos del original.
    let spans = timeline::layout(&p.clips);
    let total = spans.last().map(|s| s.end).unwrap_or(0.0);
    let (ws, we) = window.unwrap_or((0.0, total));
    let mut segments: Vec<(f64, f64)> = vec![];
    for (c, sp) in p.clips.iter().zip(&spans) {
        let a = ws.max(sp.start);
        let b = we.min(sp.end);
        if b - a <= EPS {
            continue;
        }
        let sa = c.in_point + (a - sp.start);
        let sb = c.in_point + (b - sp.start);
        // Tramos contiguos del original se unen en uno solo.
        match segments.last_mut() {
            Some(last) if (last.1 - sa).abs() < EPS => last.1 = sb,
            _ => segments.push((sa, sb)),
        }
    }
    if segments.is_empty() {
        return None;
    }
    Some(FastPlan { media, segments })
}

/// Copia un tramo sin recodificar (corta en el keyframe anterior al inicio).
pub fn copy_args(input: &str, start: f64, end: f64, format: OutputFormat, hevc: bool, out: &Path) -> Vec<String> {
    let mut a = vec![s("-hide_banner"), s("-nostdin"), s("-loglevel"), s("error"), s("-y")];
    a.extend([s("-ss"), num(start), s("-i"), s(input), s("-t"), num(end - start)]);
    a.extend([s("-map"), s("0:v:0"), s("-map"), s("0:a?"), s("-c"), s("copy"), s("-avoid_negative_ts"), s("make_zero")]);
    if hevc && format != OutputFormat::Mkv {
        a.extend([s("-tag:v"), s("hvc1")]);
    }
    a.extend([s("-map_metadata"), s("0")]);
    if matches!(format, OutputFormat::Mp4 | OutputFormat::Mov) {
        a.extend([s("-movflags"), s("+faststart")]);
    }
    a.extend([s("-progress"), s("pipe:1"), s("-stats_period"), s("0.25"), s("-nostats"), s("-f"), s(format.muxer())]);
    a.push(out.to_string_lossy().into_owned());
    a
}

/// Une los tramos copiados (lista ffconcat) sin recodificar.
pub fn join_args(list: &Path, format: OutputFormat, hevc: bool, out: &Path) -> Vec<String> {
    let mut a = vec![s("-hide_banner"), s("-nostdin"), s("-loglevel"), s("error"), s("-y")];
    a.extend([s("-f"), s("concat"), s("-safe"), s("0"), s("-i"), list.to_string_lossy().into_owned()]);
    a.extend([s("-map"), s("0:v:0"), s("-map"), s("0:a?"), s("-c"), s("copy")]);
    if hevc && format != OutputFormat::Mkv {
        a.extend([s("-tag:v"), s("hvc1")]);
    }
    if matches!(format, OutputFormat::Mp4 | OutputFormat::Mov) {
        a.extend([s("-movflags"), s("+faststart")]);
    }
    a.extend([s("-progress"), s("pipe:1"), s("-nostats"), s("-f"), s(format.muxer())]);
    a.push(out.to_string_lossy().into_owned());
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    fn base() -> Project {
        project_with(vec![media("m1", "C:\\v\\a.mp4", 60.0, 1920, 1080, 30, true)], vec![clip("c1", 2.0, 6.0)])
    }

    #[test]
    fn single_plain_clip_is_fast() {
        let p = base();
        let f = plan(&p, &p.export, None).unwrap();
        assert_eq!(f.segments, vec![(2.0, 6.0)]);
    }

    #[test]
    fn cuts_of_the_same_video_in_order_are_fast_and_merged_when_contiguous() {
        let mut p = base();
        p.clips.push(clip("c2", 10.0, 12.0));
        p.clips.push(clip("c3", 12.0, 15.0));
        let f = plan(&p, &p.export, None).unwrap();
        assert_eq!(f.segments, vec![(2.0, 6.0), (10.0, 15.0)]);
        // Con un rango: del segundo 3 al 7 del timeline.
        let f = plan(&p, &p.export, Some((3.0, 7.0))).unwrap();
        assert_eq!(f.segments, vec![(5.0, 6.0), (10.0, 13.0)]);
    }

    #[test]
    fn anything_else_disables_fast_mode() {
        let check = |f: &dyn Fn(&mut Project)| {
            let mut p = base();
            f(&mut p);
            plan(&p, &p.export, None)
        };
        assert!(check(&|p| p.clips[0].speed = 2.0).is_none());
        assert!(check(&|p| p.clips[0].audio.volume = 0.5).is_none());
        assert!(check(&|p| p.clips[0].video.flip_h = true).is_none());
        assert!(check(&|p| p.fades.fade_in = 1.0).is_none());
        assert!(check(&|p| p.export.format = OutputFormat::Webm).is_none());
        assert!(check(&|p| p.export.size_target = Some(SizeTarget { preset: "discord".into(), megabytes: 20.0 })).is_none());
        assert!(check(&|p| p.export.mode = ModePreference::Precise).is_none());
        assert!(check(&|p| p.clips.push(clip("x", 0.0, 1.0))).is_none(), "fuera de orden");
        assert!(check(&|p| {
            p.media.push(media("m2", "C:\\b.mp4", 5.0, 1920, 1080, 30, true));
            p.clips.push(Clip { media_id: "m2".into(), ..clip("y", 0.0, 1.0) });
        })
        .is_none());
        assert!(check(&|p| p.canvas.width = 1280).is_none());
        // MKV acepta cualquier códec; MP4 no acepta PCM.
        assert!(check(&|p| p.media[0].audio_codec = Some("pcm_s16le".into())).is_none());
        assert!(check(&|p| {
            p.media[0].audio_codec = Some("pcm_s16le".into());
            p.export.format = OutputFormat::Mkv;
        })
        .is_some());
    }

    #[test]
    fn copy_and_join_args() {
        let a = copy_args("in.mov", 1.0, 3.5, OutputFormat::Mov, true, Path::new("o.mov")).join(" ");
        assert!(a.contains("-ss 1.000000 -i in.mov -t 2.500000"));
        assert!(a.contains("-c copy -avoid_negative_ts make_zero"));
        assert!(a.contains("-tag:v hvc1"));
        assert!(a.ends_with("-f mov o.mov"));
        let j = join_args(Path::new("l.txt"), OutputFormat::Mkv, true, Path::new("o.mkv")).join(" ");
        assert!(!j.contains("hvc1"));
        assert!(j.ends_with("-f matroska o.mkv"));
    }
}
