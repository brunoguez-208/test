//! Audio de las pistas: "Mejorar voz", curvas de volumen, crossfade automático
//! y volumen / silenciar / solo por pista. Las mismas fórmulas están en
//! `src/engine/audioFx.ts` (preview); los parámetros salen de `config/voice.json`.

use crate::project::{MusicClip, Project, VoiceEnhance, VolumeKey};
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Range {
    base: f64,
    range: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Peak {
    freq: f64,
    #[serde(default = "q1")]
    q: f64,
    gain_range: f64,
}

fn q1() -> f64 {
    1.0
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Comp {
    threshold_base: f64,
    threshold_range: f64,
    ratio_base: f64,
    ratio_range: f64,
    attack_ms: f64,
    release_ms: f64,
    knee_db: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Level {
    target_lufs: f64,
    min_db: f64,
    max_db: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HighPass {
    base: f64,
    range: f64,
    q: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceConfig {
    highpass: HighPass,
    mud: Peak,
    presence: Peak,
    air: Peak,
    compressor: Comp,
    denoise: Range,
    level: Level,
    crossfade: f64,
}

fn config() -> &'static VoiceConfig {
    static C: OnceLock<VoiceConfig> = OnceLock::new();
    C.get_or_init(|| serde_json::from_str(include_str!("../config/voice.json")).expect("voice.json válido"))
}

/// Largo del crossfade automático entre audios que se tocan (segundos).
pub fn auto_crossfade() -> f64 {
    config().crossfade
}

/// Parámetros concretos de "Mejorar voz" para una intensidad.
#[derive(Debug, Clone, PartialEq)]
pub struct VoiceParams {
    pub highpass_hz: f64,
    pub highpass_q: f64,
    pub mud_hz: f64,
    pub mud_q: f64,
    pub mud_db: f64,
    pub presence_hz: f64,
    pub presence_q: f64,
    pub presence_db: f64,
    pub air_hz: f64,
    pub air_db: f64,
    pub threshold_db: f64,
    pub ratio: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub knee_db: f64,
    pub denoise_nr: f64,
    /// Ganancia fija para llegar al nivel de voz (0 si no se midió).
    pub makeup_db: f64,
}

pub fn voice_params(e: &VoiceEnhance) -> VoiceParams {
    let c = config();
    let a = e.amount.clamp(0.0, 1.0);
    let makeup_db = e
        .loudness
        .map(|l| (c.level.target_lufs - l.input_i).clamp(c.level.min_db, c.level.max_db))
        .unwrap_or(0.0);
    VoiceParams {
        highpass_hz: c.highpass.base + c.highpass.range * a,
        highpass_q: c.highpass.q,
        mud_hz: c.mud.freq,
        mud_q: c.mud.q,
        mud_db: c.mud.gain_range * a,
        presence_hz: c.presence.freq,
        presence_q: c.presence.q,
        presence_db: c.presence.gain_range * a,
        air_hz: c.air.freq,
        air_db: c.air.gain_range * a,
        threshold_db: c.compressor.threshold_base + c.compressor.threshold_range * a,
        ratio: c.compressor.ratio_base + c.compressor.ratio_range * a,
        attack_ms: c.compressor.attack_ms,
        release_ms: c.compressor.release_ms,
        knee_db: c.compressor.knee_db,
        denoise_nr: c.denoise.base + c.denoise.range * a,
        makeup_db,
    }
}

fn f(v: f64) -> String {
    let t = format!("{v:.4}");
    t.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Cadena de FFmpeg de "Mejorar voz" (en el tiempo del clip, antes del volumen).
/// Biquads RBJ como los BiquadFilterNode del preview: mismo resultado.
pub fn voice_filters(e: &VoiceEnhance) -> Vec<String> {
    let v = voice_params(e);
    let db_to_lin = |db: f64| 10f64.powf(db / 20.0);
    let mut out = vec![
        format!("afftdn=nr={}:nf=-50:tn=1", f(v.denoise_nr)),
        format!("highpass=f={}:p=2:t=q:w={}", f(v.highpass_hz), f(v.highpass_q)),
        format!("equalizer=f={}:t=q:w={}:g={}", f(v.mud_hz), f(v.mud_q), f(v.mud_db)),
        format!("equalizer=f={}:t=q:w={}:g={}", f(v.presence_hz), f(v.presence_q), f(v.presence_db)),
        format!("treble=f={}:t=q:w=0.7071:g={}", f(v.air_hz), f(v.air_db)),
        format!(
            "acompressor=threshold={}:ratio={}:attack={}:release={}:knee={}:makeup=1",
            f(db_to_lin(v.threshold_db)),
            f(v.ratio),
            f(v.attack_ms),
            f(v.release_ms),
            f(db_to_lin(v.knee_db / 2.0).min(8.0))
        ),
    ];
    if v.makeup_db.abs() > 0.01 {
        out.push(format!("volume={}dB", f(v.makeup_db)));
    }
    out
}

/// Curva suave entre dos puntos (misma que `smoothstep` del preview).
fn smooth(x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// Ganancia de la curva de volumen en u (segundos desde el inicio del clip).
pub fn key_gain(keys: &[VolumeKey], u: f64) -> f64 {
    let mut k: Vec<&VolumeKey> = keys.iter().collect();
    k.sort_by(|a, b| a.t.total_cmp(&b.t));
    match k.as_slice() {
        [] => 1.0,
        [only] => only.v,
        all => {
            if u <= all[0].t {
                return all[0].v;
            }
            for w in all.windows(2) {
                if u <= w[1].t {
                    let span = (w[1].t - w[0].t).max(1e-9);
                    return w[0].v + (w[1].v - w[0].v) * smooth((u - w[0].t) / span);
                }
            }
            all[all.len() - 1].v
        }
    }
}

/// Expresión de `volume=eval=frame` para la curva; `t` del filtro empieza en
/// `offset` segundos del clip (cuando el rango exportado corta el principio).
pub fn volume_expr(keys: &[VolumeKey], offset: f64) -> Option<String> {
    if keys.is_empty() {
        return None;
    }
    let mut k: Vec<&VolumeKey> = keys.iter().collect();
    k.sort_by(|a, b| a.t.total_cmp(&b.t));
    let u = if offset.abs() > 1e-9 { format!("(t+{})", f(offset)) } else { "t".to_string() };
    // Del último tramo hacia atrás: if(lt(u,t1), tramo0, if(lt(u,t2), tramo1, … último)).
    let mut expr = f(k[k.len() - 1].v);
    for i in (0..k.len().saturating_sub(1)).rev() {
        let (a, b) = (k[i], k[i + 1]);
        let span = (b.t - a.t).max(1e-6);
        let x = format!("clip(({u}-{})/{},0,1)", f(a.t), f(span));
        let seg = format!("{}+({})*({x})*({x})*(3-2*{x})", f(a.v), f(b.v - a.v));
        expr = format!("if(lt({u},{}),{seg},{expr})", f(b.t));
    }
    expr = format!("if(lt({u},{}),{},{expr})", f(k[0].t), f(k[0].v));
    Some(format!("volume=eval=frame:volume='{}'", expr.replace(',', "\\,")))
}

/// Fades efectivos de un clip de audio: los suyos o el crossfade corto
/// automático si toca a otro clip de la misma pista (evita clics en el corte).
pub fn effective_fades(p: &Project, m: &MusicClip) -> (f64, f64) {
    let xf = auto_crossfade();
    let len = (m.out_point - m.in_point).max(0.0);
    let end = m.start + len;
    let touches = |t: f64, other_edge: fn(&MusicClip) -> f64| {
        p.music.iter().any(|o| o.id != m.id && o.track == m.track && (other_edge(o) - t).abs() < 0.02)
    };
    let mut fi = m.fade_in;
    let mut fo = m.fade_out;
    if touches(m.start, |o| o.start + (o.out_point - o.in_point)) {
        fi = fi.max(xf);
    }
    if touches(end, |o| o.start) {
        fo = fo.max(xf);
    }
    (fi.min(len / 2.0), fo.min(len / 2.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    fn music(id: &str, start: f64, len: f64, track: u32) -> MusicClip {
        MusicClip {
            id: id.into(),
            media_id: "m1".into(),
            start,
            in_point: 0.0,
            out_point: len,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            ducking: false,
            track,
            volume_keys: vec![],
            enhance: None,
            linked_clip: None,
            source_track: None,
            muted: false,
        }
    }

    #[test]
    fn voice_chain_scales_with_intensity() {
        let off = voice_params(&VoiceEnhance { amount: 0.0, loudness: None });
        let full = voice_params(&VoiceEnhance { amount: 1.0, loudness: None });
        assert_eq!(off.presence_db, 0.0);
        assert!(full.presence_db > 4.0 && full.mud_db < -3.0);
        assert!(full.highpass_hz > off.highpass_hz);
        assert!(full.ratio > off.ratio);
        let f = voice_filters(&VoiceEnhance { amount: 0.6, loudness: None }).join(",");
        assert!(f.starts_with("afftdn=nr="), "{f}");
        assert!(f.contains("highpass=f=100:p=2:t=q:w=0.7071"), "{f}");
        assert!(f.contains("equalizer=f=3500:t=q:w=0.8:g=3"), "{f}");
        assert!(!f.contains("volume="), "sin medir no hay ganancia");
    }

    #[test]
    fn voice_level_goes_to_minus_16_lufs() {
        let l = crate::project::Loudness { input_i: -30.0, input_tp: -10.0, input_lra: 5.0, input_thresh: -40.0, target_offset: 0.0 };
        let e = VoiceEnhance { amount: 0.5, loudness: Some(l) };
        assert_eq!(voice_params(&e).makeup_db, 14.0);
        assert!(voice_filters(&e).last().unwrap().ends_with("volume=14dB"));
        let loud = VoiceEnhance { amount: 0.5, loudness: Some(crate::project::Loudness { input_i: 0.0, ..l }) };
        assert_eq!(voice_params(&loud).makeup_db, -12.0, "con tope");
    }

    #[test]
    fn volume_curve_is_smooth_and_matches_the_expression() {
        let keys = vec![VolumeKey { id: 1, t: 1.0, v: 1.0 }, VolumeKey { id: 2, t: 3.0, v: 0.2 }];
        assert_eq!(key_gain(&keys, 0.0), 1.0);
        assert!((key_gain(&keys, 2.0) - 0.6).abs() < 1e-9, "a mitad de camino");
        assert!((key_gain(&keys, 1.5) - (1.0 - 0.8 * smooth(0.25))).abs() < 1e-9);
        assert_eq!(key_gain(&keys, 9.0), 0.2);
        let e = volume_expr(&keys, 0.0).unwrap();
        assert!(e.starts_with("volume=eval=frame:volume='if(lt(t\\,1)\\,1\\,if(lt(t\\,3)\\,1+(-0.8)"), "{e}");
        let shifted = volume_expr(&keys, 0.5).unwrap();
        assert!(shifted.contains("(t+0.5)"));
        assert!(volume_expr(&[], 0.0).is_none());
    }

    #[test]
    fn touching_clips_get_a_short_crossfade() {
        let mut p = project_with(vec![media("m1", "C:\\a.wav", 20.0, 0, 0, 30, true)], vec![]);
        p.music = vec![music("a", 0.0, 4.0, 0), music("b", 4.0, 3.0, 0), music("c", 4.0, 3.0, 1)];
        let a = p.music[0].clone();
        let b = p.music[1].clone();
        let c = p.music[2].clone();
        assert_eq!(effective_fades(&p, &a), (0.0, 0.03));
        assert_eq!(effective_fades(&p, &b), (0.03, 0.0));
        assert_eq!(effective_fades(&p, &c), (0.0, 0.0), "otra pista: no se tocan");
    }

    #[test]
    fn track_mute_and_solo() {
        let mut t = crate::project::Tracks {
            audio: vec![Default::default(), crate::project::TrackState { volume: 0.5, ..Default::default() }],
            ..Default::default()
        };
        assert_eq!(t.gain_of(&t.audio_track(1)), 0.5);
        t.audio[0].solo = true;
        assert_eq!(t.gain_of(&t.audio_track(1)), 0.0, "otra pista en solo");
        assert_eq!(t.gain_of(&t.audio_track(0)), 1.0);
        assert_eq!(t.gain_of(&t.video_audio), 0.0);
        t.audio[0].muted = true;
        assert_eq!(t.gain_of(&t.audio_track(0)), 0.0);
    }
}
