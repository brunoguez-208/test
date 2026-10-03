//! Rampas de velocidad: la velocidad cambia suave entre puntos. Para renderizar
//! se aproxima con tramos cortos de velocidad constante (los mismos en Rust y en
//! `src/project/ramp.ts`), así el largo del clip y el resultado coinciden.

use crate::graph::s;
use crate::project::SpeedKey;

pub const MIN_SPEED: f64 = 0.1;
pub const MAX_SPEED: f64 = 10.0;
/// Largo de cada tramo (segundos del original) y máximo de tramos.
pub const STEP: f64 = 0.05;
pub const MAX_SEGMENTS: usize = 64;

fn smooth(x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// Velocidad en `t` (segundos del original desde la entrada).
pub fn speed_at(keys: &[SpeedKey], t: f64) -> f64 {
    let mut k: Vec<&SpeedKey> = keys.iter().collect();
    k.sort_by(|a, b| a.t.total_cmp(&b.t));
    let v = match k.as_slice() {
        [] => 1.0,
        [only] => only.v,
        all if t <= all[0].t => all[0].v,
        all => {
            let mut out = all[all.len() - 1].v;
            for w in all.windows(2) {
                if t <= w[1].t {
                    let span = (w[1].t - w[0].t).max(1e-9);
                    out = w[0].v + (w[1].v - w[0].v) * smooth((t - w[0].t) / span);
                    break;
                }
            }
            out
        }
    };
    v.clamp(MIN_SPEED, MAX_SPEED)
}

/// Tramos (inicio, fin, velocidad) en segundos del original.
pub fn segments(keys: &[SpeedKey], len: f64) -> Vec<(f64, f64, f64)> {
    let len = len.max(1e-3);
    let n = ((len / STEP).ceil() as usize).clamp(1, MAX_SEGMENTS);
    let step = len / n as f64;
    (0..n)
        .map(|i| {
            let a = i as f64 * step;
            let b = if i + 1 == n { len } else { a + step };
            (a, b, speed_at(keys, (a + b) / 2.0))
        })
        .collect()
}

/// Duración en el timeline de `len` segundos del original con la rampa.
pub fn duration(keys: &[SpeedKey], len: f64) -> f64 {
    segments(keys, len).iter().map(|(a, b, v)| (b - a) / v).sum()
}

/// Segundos del original (desde la entrada) que corresponden a `u` segundos
/// del timeline dentro de una pasada con la rampa.
pub fn source_offset(keys: &[SpeedKey], len: f64, u: f64) -> f64 {
    let mut acc = 0.0;
    for (a, b, v) in segments(keys, len) {
        let d = (b - a) / v;
        if u <= acc + d {
            return (a + (u - acc).max(0.0) * v).min(len);
        }
        acc += d;
    }
    len.max(0.0)
}

fn f(v: f64) -> String {
    let t = format!("{v:.6}");
    t.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// `setpts` que lleva cada cuadro a su tiempo nuevo (T = segundos desde el inicio).
pub fn setpts(keys: &[SpeedKey], len: f64) -> String {
    let segs = segments(keys, len);
    let mut acc = vec![0.0];
    for (a, b, v) in &segs {
        acc.push(acc.last().unwrap() + (b - a) / v);
    }
    // Del último tramo hacia atrás: if(lt(T,b0), tramo0, if(lt(T,b1), tramo1, … último)).
    let piece = |i: usize| format!("{}+(T-{})/{}", f(acc[i]), f(segs[i].0), f(segs[i].2));
    let mut e = piece(segs.len() - 1);
    for i in (0..segs.len() - 1).rev() {
        e = format!("if(lt(T,{}),{},{e})", f(segs[i].1), piece(i));
    }
    format!("setpts='({e})/TB'")
}

/// Cadena de audio con el tono preservado: un `atempo` por tramo y concat.
/// Devuelve (filtro de entrada, etiquetas): `[ain]asplit=N…concat[aout]`.
pub fn audio_graph(keys: &[SpeedKey], len: f64, pre: f64, input: &str, out: &str) -> String {
    let segs = segments(keys, len);
    let n = segs.len();
    let mut g = format!("[{input}]atrim=start={},asetpts=PTS-STARTPTS,asplit={n}", f(pre));
    for i in 0..n {
        g.push_str(&format!("[rs{i}]"));
    }
    for (i, (a, b, v)) in segs.iter().enumerate() {
        let tempo = crate::compile::atempo_chain(*v).join(",");
        let tempo = if tempo.is_empty() { s("anull") } else { tempo };
        g.push_str(&format!(";[rs{i}]atrim=start={}:end={},asetpts=PTS-STARTPTS,{tempo}[rt{i}]", f(*a), f(*b)));
    }
    g.push(';');
    for i in 0..n {
        g.push_str(&format!("[rt{i}]"));
    }
    g.push_str(&format!("concat=n={n}:v=0:a=1[{out}]"));
    g
}

/// Presets de un clic. `len` = largo del clip en el original.
pub fn preset(name: &str, len: f64) -> Vec<SpeedKey> {
    let k = |id: u64, t: f64, v: f64| SpeedKey { id, t: t * len, v };
    match name {
        // Normal → lenta en el medio → normal.
        "slowmo-middle" => vec![k(1, 0.0, 1.0), k(2, 0.35, 0.25), k(3, 0.65, 0.25), k(4, 1.0, 1.0)],
        // Arranca normal y acelera.
        "speed-up" => vec![k(1, 0.0, 1.0), k(2, 1.0, 4.0)],
        // Viene rápido y frena hasta cámara lenta.
        "slow-down" => vec![k(1, 0.0, 3.0), k(2, 1.0, 0.3)],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(t: f64, v: f64) -> SpeedKey {
        SpeedKey { id: 0, t, v }
    }

    #[test]
    fn smooth_speed_and_duration() {
        let keys = vec![key(0.0, 1.0), key(2.0, 0.5)];
        assert_eq!(speed_at(&keys, 0.0), 1.0);
        assert!((speed_at(&keys, 1.0) - 0.75).abs() < 1e-12);
        assert_eq!(speed_at(&keys, 5.0), 0.5);
        // Constante: largo / velocidad.
        assert!((duration(&[key(0.0, 2.0)], 4.0) - 2.0).abs() < 1e-9);
        // Sin puntos: velocidad 1.
        assert!((duration(&[], 3.0) - 3.0).abs() < 1e-9);
        // La rampa queda entre los dos extremos.
        let d = duration(&keys, 2.0);
        assert!(d > 2.0 && d < 4.0, "{d}");
        assert!(segments(&keys, 100.0).len() == MAX_SEGMENTS);
    }

    #[test]
    fn setpts_is_piecewise_and_monotonic() {
        let keys = vec![key(0.0, 1.0), key(0.1, 0.5)];
        let e = setpts(&keys, 0.15);
        assert!(e.starts_with("setpts='(if(lt(T,0.05),0+(T-0)/"), "{e}");
        assert!(e.ends_with(")/TB'"));
        assert_eq!(e.matches("if(").count(), 2);
    }

    #[test]
    fn source_offset_inverts_the_ramp() {
        let keys = preset("slowmo-middle", 4.0);
        let d = duration(&keys, 4.0);
        assert!(source_offset(&keys, 4.0, 0.0).abs() < 1e-9);
        assert!((source_offset(&keys, 4.0, d) - 4.0).abs() < 1e-6);
        let mut last = -1.0;
        for i in 0..=100 {
            let o = source_offset(&keys, 4.0, d * i as f64 / 100.0);
            assert!(o >= last - 1e-9);
            last = o;
        }
        // En el tramo lento el original avanza 4 veces más despacio.
        let mid = d / 2.0;
        let r = (source_offset(&keys, 4.0, mid + 0.1) - source_offset(&keys, 4.0, mid)) / 0.1;
        assert!((r - 0.25).abs() < 0.02, "{r}");
    }

    #[test]
    fn presets() {
        let p = preset("slowmo-middle", 10.0);
        assert_eq!(p.len(), 4);
        assert!((p[1].t - 3.5).abs() < 1e-9 && p[1].v == 0.25);
        assert!(duration(&preset("speed-up", 4.0), 4.0) < 4.0);
        assert!(duration(&preset("slow-down", 4.0), 4.0) > 4.0);
        assert!(preset("x", 1.0).is_empty());
    }

    #[test]
    fn audio_keeps_pitch_per_segment() {
        let g = audio_graph(&[key(0.0, 2.0)], 0.1, 0.01, "0:a:0", "ra");
        assert!(g.starts_with("[0:a:0]atrim=start=0.01,asetpts=PTS-STARTPTS,asplit=2[rs0][rs1]"), "{g}");
        assert!(g.contains("atempo=2"));
        assert!(g.ends_with("[rt0][rt1]concat=n=2:v=0:a=1[ra]"));
    }
}
