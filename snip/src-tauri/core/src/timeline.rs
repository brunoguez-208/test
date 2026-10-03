//! Matemática de tiempos del timeline (espejo exacto de `src/project/timeline.ts`).
//!
//! La pista principal es magnética: cada clip empieza donde termina el anterior,
//! salvo que tenga una transición de entrada, que solapa los dos clips.

use crate::project::{Clip, ClipKind, LoopMode, Project};

/// Menor duración aceptable para cualquier cosa (medio cuadro a 120 fps).
pub const EPS: f64 = 1.0 / 240.0;

/// Duración de una pasada del clip (sin repeticiones), ya con la velocidad aplicada.
pub fn segment_duration(c: &Clip) -> f64 {
    match c.kind {
        ClipKind::Freeze => c.freeze_duration.max(0.0),
        ClipKind::Video if !c.speed_keys.is_empty() => crate::ramp::duration(&c.speed_keys, (c.out_point - c.in_point).max(0.0)),
        ClipKind::Video => ((c.out_point - c.in_point).max(0.0)) / c.speed.clamp(0.01, 100.0),
    }
}

/// Cuántas pasadas tiene el clip (un boomerang cuenta ida y vuelta como 2).
pub fn passes(c: &Clip) -> u32 {
    if c.kind == ClipKind::Freeze {
        return 1;
    }
    match c.loop_mode {
        LoopMode::None => 1,
        LoopMode::Loop => c.loop_count.max(1),
        LoopMode::Boomerang => 2 * c.loop_count.max(1),
    }
}

/// Duración total del clip en el timeline.
pub fn clip_duration(c: &Clip) -> f64 {
    segment_duration(c) * passes(c) as f64
}

/// Posición de un clip de la pista principal.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Span {
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    /// Duración efectiva de la transición que entra a este clip (0 = corte).
    pub transition_in: f64,
}

/// Duración efectiva de la transición que entra al clip `i`: nunca más de la
/// mitad de cualquiera de los dos clips (así nunca se pisan dos transiciones).
pub fn effective_transition(clips: &[Clip], i: usize) -> f64 {
    if i == 0 || i >= clips.len() {
        return 0.0;
    }
    let Some(t) = clips[i].transition else { return 0.0 };
    let max = (clip_duration(&clips[i - 1]) * 0.5).min(clip_duration(&clips[i]) * 0.5);
    let d = t.duration.min(max);
    if d < EPS * 2.0 {
        0.0
    } else {
        d
    }
}

/// Dónde cae cada clip de la pista principal.
pub fn layout(clips: &[Clip]) -> Vec<Span> {
    let mut out = Vec::with_capacity(clips.len());
    let mut cursor = 0.0f64;
    for (i, c) in clips.iter().enumerate() {
        let d = clip_duration(c);
        let tr = effective_transition(clips, i);
        let start = (cursor - tr).max(0.0);
        out.push(Span { start, end: start + d, duration: d, transition_in: tr });
        cursor = start + d;
    }
    out
}

/// Duración total del proyecto (la de la pista principal).
pub fn total_duration(p: &Project) -> f64 {
    layout(&p.clips).last().map(|s| s.end).unwrap_or(0.0)
}

/// Segundo del original que se ve en el tiempo local `u` del clip (0..duración).
/// Contempla velocidad, invertido, loop y boomerang.
pub fn source_time(c: &Clip, u: f64) -> f64 {
    if c.kind == ClipKind::Freeze {
        return c.in_point;
    }
    let seg = segment_duration(c).max(EPS);
    let total = clip_duration(c);
    let u = u.clamp(0.0, (total - 1e-9).max(0.0));
    let pass = (u / seg).floor();
    let p = u - pass * seg;
    let forward = match c.loop_mode {
        LoopMode::Boomerang => (pass as u64).is_multiple_of(2),
        _ => true,
    };
    let forward = forward != c.reverse;
    let off = if c.speed_keys.is_empty() { p * c.speed } else { crate::ramp::source_offset(&c.speed_keys, c.out_point - c.in_point, p) };
    if forward {
        (c.in_point + off).min(c.out_point)
    } else {
        (c.out_point - off).max(c.in_point)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{Transition, TransitionKind};
    use crate::testutil::clip;

    #[test]
    fn durations_with_speed_and_loops() {
        let mut c = clip("a", 2.0, 6.0);
        assert!((clip_duration(&c) - 4.0).abs() < 1e-9);
        c.speed = 2.0;
        assert!((clip_duration(&c) - 2.0).abs() < 1e-9);
        c.speed = 0.5;
        assert!((clip_duration(&c) - 8.0).abs() < 1e-9);
        c.speed = 1.0;
        c.loop_mode = LoopMode::Loop;
        c.loop_count = 3;
        assert!((clip_duration(&c) - 12.0).abs() < 1e-9);
        c.loop_mode = LoopMode::Boomerang;
        c.loop_count = 2;
        assert!((clip_duration(&c) - 16.0).abs() < 1e-9);
        let mut f = clip("f", 3.0, 3.0);
        f.kind = ClipKind::Freeze;
        f.freeze_duration = 2.5;
        f.loop_mode = LoopMode::Loop;
        f.loop_count = 4;
        assert!((clip_duration(&f) - 2.5).abs() < 1e-9, "un congelado no se repite");
    }

    #[test]
    fn layout_is_magnetic_and_transitions_overlap() {
        let mut clips = vec![clip("a", 0.0, 4.0), clip("b", 0.0, 3.0), clip("c", 1.0, 5.0)];
        let l = layout(&clips);
        assert_eq!((l[0].start, l[1].start, l[2].start), (0.0, 4.0, 7.0));
        assert!((l[2].end - 11.0).abs() < 1e-9);

        clips[1].transition = Some(Transition { kind: TransitionKind::Fade, duration: 1.0 });
        let l = layout(&clips);
        assert!((l[1].start - 3.0).abs() < 1e-9);
        assert!((l[1].transition_in - 1.0).abs() < 1e-9);
        assert!((l[2].start - 6.0).abs() < 1e-9);
        assert!((l[2].end - 10.0).abs() < 1e-9);
        // El primero nunca tiene transición de entrada.
        clips[0].transition = Some(Transition { kind: TransitionKind::Fade, duration: 1.0 });
        assert_eq!(layout(&clips)[0].transition_in, 0.0);
    }

    #[test]
    fn transition_is_clamped_to_half_of_each_clip() {
        let mut clips = vec![clip("a", 0.0, 1.0), clip("b", 0.0, 10.0)];
        clips[1].transition = Some(Transition { kind: TransitionKind::SlideLeft, duration: 3.0 });
        assert!((effective_transition(&clips, 1) - 0.5).abs() < 1e-9);
        clips[1].transition = Some(Transition { kind: TransitionKind::SlideLeft, duration: 0.001 });
        assert_eq!(effective_transition(&clips, 1), 0.0);
    }

    #[test]
    fn source_time_mapping() {
        let mut c = clip("a", 2.0, 6.0);
        assert!((source_time(&c, 1.0) - 3.0).abs() < 1e-9);
        c.speed = 2.0;
        assert!((source_time(&c, 1.0) - 4.0).abs() < 1e-9);
        c.reverse = true;
        assert!((source_time(&c, 0.0) - 6.0).abs() < 1e-9);
        assert!((source_time(&c, 1.0) - 4.0).abs() < 1e-9);
        c.reverse = false;
        c.speed = 1.0;
        c.loop_mode = LoopMode::Boomerang;
        c.loop_count = 1;
        // ida 0..4, vuelta 4..8
        assert!((source_time(&c, 1.0) - 3.0).abs() < 1e-9);
        assert!((source_time(&c, 5.0) - 5.0).abs() < 1e-9);
        c.loop_mode = LoopMode::Loop;
        c.loop_count = 2;
        assert!((source_time(&c, 5.0) - 3.0).abs() < 1e-9);
    }
}
