//! Migraciones del formato de proyecto.
//!
//! Cada versión vieja tiene una función que la lleva a la siguiente. Al abrir un
//! `.snip` (o un autoguardado) se aplican en cadena hasta [`PROJECT_VERSION`] y
//! después se sanea el resultado (valores fuera de rango, ids repetidos…).
//!
//! - v0: recorte de Snip 1.x (`input`, `start`, `end`, opcionalmente `media`).
//! - v1: proyecto completo (actual).

use crate::error::{AppError, ErrorKind};
use crate::project::*;
use serde_json::{json, Value};
use std::collections::HashSet;

/// Convierte cualquier JSON de proyecto conocido a la versión actual.
pub fn migrate(mut v: Value) -> Result<Project, AppError> {
    let mut version = v.get("version").and_then(Value::as_u64).unwrap_or(0) as u32;
    if version > PROJECT_VERSION {
        return Err(AppError::with_message(
            ErrorKind::Unsupported,
            "Este proyecto se creó con una versión más nueva de Snip. Actualizá la app para abrirlo.",
        ));
    }
    while version < PROJECT_VERSION {
        v = match version {
            0 => v0_to_v1(v)?,
            _ => unreachable!("falta la migración desde v{version}"),
        };
        version += 1;
    }
    let mut p: Project = serde_json::from_value(v)
        .map_err(|e| AppError::with_detail(ErrorKind::BadProject, e.to_string()))?;
    sanitize(&mut p);
    Ok(p)
}

/// Lee el texto de un `.snip` o de un autoguardado.
pub fn parse(text: &str) -> Result<Project, AppError> {
    let v: Value = serde_json::from_str(text).map_err(|e| AppError::with_detail(ErrorKind::BadProject, e.to_string()))?;
    migrate(v)
}

/// v0 (recorte de Snip 1.x) → v1: un proyecto con un único clip.
fn v0_to_v1(v: Value) -> Result<Value, AppError> {
    let bad = || AppError::with_message(ErrorKind::BadProject, "El archivo no es un proyecto de Snip.");
    let input = v.get("input").and_then(Value::as_str).ok_or_else(bad)?.to_string();
    let start = v.get("start").and_then(Value::as_f64).unwrap_or(0.0);
    let end = v.get("end").and_then(Value::as_f64).ok_or_else(bad)?;
    let m = v.get("media").cloned().unwrap_or(Value::Null);
    let num = |k: &str, d: f64| m.get(k).and_then(Value::as_f64).unwrap_or(d);
    let width = num("width", 1920.0) as u32;
    let height = num("height", 1080.0) as u32;
    let fps_num = num("fpsNum", 30.0) as u32;
    let fps_den = num("fpsDen", 1.0).max(1.0) as u32;
    let name = std::path::Path::new(&input.replace('\\', "/"))
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Proyecto".into());
    Ok(json!({
        "version": 1,
        "id": v.get("id").and_then(Value::as_str).unwrap_or("migrado"),
        "name": name,
        "media": [{
            "id": "m1", "path": input, "kind": "video",
            "duration": num("duration", end), "width": width, "height": height,
            "fps": fps_num as f64 / fps_den as f64, "fpsNum": fps_num, "fpsDen": fps_den,
            "hasAudio": m.get("hasAudio").and_then(Value::as_bool).unwrap_or(true),
            "videoCodec": m.get("videoCodec").cloned().unwrap_or(Value::Null),
            "audioCodec": m.get("audioCodec").cloned().unwrap_or(Value::Null),
        }],
        "clips": [{ "id": "c1", "mediaId": "m1", "inPoint": start, "outPoint": end }],
        "canvas": { "width": width, "height": height, "fpsNum": fps_num, "fpsDen": fps_den, "auto": true },
    }))
}

fn finite_or(v: f64, d: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        d
    }
}

/// Deja el proyecto en un estado válido: rangos, ids únicos, referencias existentes.
pub fn sanitize(p: &mut Project) {
    p.version = PROJECT_VERSION;
    let media_ids: HashSet<String> = p.media.iter().map(|m| m.id.clone()).collect();
    p.clips.retain(|c| media_ids.contains(&c.media_id));
    let mut seen = HashSet::new();
    for (i, c) in p.clips.iter_mut().enumerate() {
        if !seen.insert(c.id.clone()) {
            c.id = format!("{}-{i}", c.id);
            seen.insert(c.id.clone());
        }
        c.speed = finite_or(c.speed, 1.0).clamp(MIN_SPEED, MAX_SPEED);
        c.in_point = finite_or(c.in_point, 0.0).max(0.0);
        c.out_point = finite_or(c.out_point, c.in_point).max(c.in_point);
        c.loop_count = c.loop_count.clamp(1, MAX_LOOP_COUNT);
        c.freeze_duration = finite_or(c.freeze_duration, 0.0).clamp(0.0, 3600.0);
        if c.speed >= 1.0 {
            c.smooth_slowmo = false;
        }
        let a = &mut c.audio;
        a.volume = finite_or(a.volume, 1.0).clamp(0.0, MAX_CLIP_VOLUME);
        a.fade_in = finite_or(a.fade_in, 0.0).max(0.0);
        a.fade_out = finite_or(a.fade_out, 0.0).max(0.0);
        let v = &mut c.video;
        v.rotate = (v.rotate / 90 * 90) % 360;
        v.sharpen = finite_or(v.sharpen, 0.0).clamp(0.0, 1.0);
        v.denoise = finite_or(v.denoise, 0.0).clamp(0.0, 1.0);
        for x in [
            &mut v.color.brightness,
            &mut v.color.contrast,
            &mut v.color.saturation,
            &mut v.color.temperature,
            &mut v.color.exposure,
        ] {
            *x = finite_or(*x, 0.0).clamp(-1.0, 1.0);
        }
        if let Some(cr) = &mut v.crop {
            cr.w = finite_or(cr.w, 1.0).clamp(0.02, 1.0);
            cr.h = finite_or(cr.h, 1.0).clamp(0.02, 1.0);
            cr.x = finite_or(cr.x, 0.0).clamp(0.0, 1.0 - cr.w);
            cr.y = finite_or(cr.y, 0.0).clamp(0.0, 1.0 - cr.h);
        }
        v.zoom.retain(|k| k.t.is_finite() && k.zoom.is_finite());
        for k in &mut v.zoom {
            k.zoom = k.zoom.clamp(1.0, 8.0);
            k.cx = finite_or(k.cx, 0.5).clamp(0.0, 1.0);
            k.cy = finite_or(k.cy, 0.5).clamp(0.0, 1.0);
            k.t = k.t.max(0.0);
        }
        v.zoom.sort_by(|a, b| a.t.total_cmp(&b.t));
        if let Some(t) = &mut c.transition {
            t.duration = finite_or(t.duration, 0.0).clamp(0.0, 5.0);
        }
    }
    p.overlays.retain(|o| o.duration.is_finite() && o.duration > 0.0 && o.start.is_finite());
    p.music.retain(|m| media_ids.contains(&m.media_id));
    for m in &mut p.music {
        m.start = finite_or(m.start, 0.0).max(0.0);
        m.volume = finite_or(m.volume, 0.6).clamp(0.0, MAX_CLIP_VOLUME);
        m.out_point = finite_or(m.out_point, m.in_point).max(m.in_point);
    }
    p.markers.retain(|m| m.time.is_finite() && m.time >= 0.0);
    p.markers.sort_by(|a, b| a.time.total_cmp(&b.time));
    p.ranges.retain(|r| r.start.is_finite() && r.end.is_finite() && r.end > r.start);
    p.subtitles.cues.retain(|c| c.end > c.start);
    p.subtitles.cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    p.fades.fade_in = finite_or(p.fades.fade_in, 0.0).clamp(0.0, 10.0);
    p.fades.fade_out = finite_or(p.fades.fade_out, 0.0).clamp(0.0, 10.0);
    if p.canvas.width < 2 || p.canvas.height < 2 {
        p.canvas.width = 1920;
        p.canvas.height = 1080;
    }
    p.canvas.width &= !1;
    p.canvas.height &= !1;
    if p.canvas.fps_num == 0 {
        p.canvas.fps_num = 30;
    }
    p.canvas.fps_den = p.canvas.fps_den.max(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v0_single_trim_becomes_a_one_clip_project() {
        let v0 = json!({"input": "C:\\Videos\\viaje.mp4", "start": 2.5, "end": 9.0,
            "media": {"width": 3840, "height": 2160, "fpsNum": 60, "fpsDen": 1, "duration": 30.0, "hasAudio": false}});
        let p = migrate(v0).unwrap();
        assert_eq!(p.version, PROJECT_VERSION);
        assert_eq!(p.name, "viaje");
        assert_eq!(p.clips.len(), 1);
        assert_eq!((p.clips[0].in_point, p.clips[0].out_point), (2.5, 9.0));
        assert_eq!((p.canvas.width, p.canvas.height, p.canvas.fps_num), (3840, 2160, 60));
        assert!(!p.media[0].has_audio);
        assert_eq!(p.media[0].duration, 30.0);
    }

    #[test]
    fn newer_versions_and_garbage_are_rejected_with_spanish_messages() {
        let e = migrate(json!({"version": 99})).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Unsupported);
        assert!(e.message.contains("más nueva"));
        assert_eq!(parse("no es json").unwrap_err().kind, ErrorKind::BadProject);
        assert_eq!(migrate(json!({"foo": 1})).unwrap_err().kind, ErrorKind::BadProject);
    }

    #[test]
    fn v1_roundtrip_is_identity() {
        let p = crate::testutil::sample_project();
        let text = serde_json::to_string(&p).unwrap();
        assert_eq!(parse(&text).unwrap(), p);
    }

    #[test]
    fn sanitize_clamps_and_fixes_references() {
        let mut p = crate::testutil::sample_project();
        p.clips[0].speed = 99.0;
        p.clips[0].audio.volume = f64::NAN;
        p.clips[0].loop_count = 0;
        p.clips[0].video.rotate = 95;
        p.clips[1].id = p.clips[0].id.clone();
        let mut ghost = p.clips[0].clone();
        ghost.media_id = "no-existe".into();
        p.clips.push(ghost);
        p.canvas.width = 1921;
        sanitize(&mut p);
        assert_eq!(p.clips.len(), 2);
        assert_eq!(p.clips[0].speed, MAX_SPEED);
        assert_eq!(p.clips[0].audio.volume, 1.0);
        assert_eq!(p.clips[0].loop_count, 1);
        assert_eq!(p.clips[0].video.rotate, 90);
        assert_ne!(p.clips[0].id, p.clips[1].id);
        assert_eq!(p.canvas.width, 1920);
    }
}
