//! Color: ajustes (brillo, contraste, saturación, temperatura, exposición) y
//! looks. Todo se reduce a dos transformaciones afines (matriz 3×3 + desplazamiento,
//! con recorte a 0..1 después de cada una) y una curva por canal (lineal por
//! tramos). El preview (WebGL, `src/engine/color.ts`) usa exactamente las mismas
//! fórmulas; los looks salen de `config/looks.json`, compartido con el frontend.
//!
//! En FFmpeg: `colorchannelmixer` en `gbrap` (el desplazamiento entra por el
//! canal alfa, que vale 1) y `lutrgb` para las curvas.

use crate::project::{ColorAdjust, Look};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Pesos de luma (Rec. 709) para saturación.
pub const LUMA: [f64; 3] = [0.2126, 0.7152, 0.0722];

/// Transformación afín de color: `out = clamp(m · rgb + o)`; `m` por filas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Affine {
    pub m: [f64; 9],
    pub o: [f64; 3],
}

impl Affine {
    pub const IDENTITY: Affine = Affine { m: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], o: [0.0; 3] };

    pub fn is_identity(&self) -> bool {
        self.m.iter().zip(Self::IDENTITY.m.iter()).all(|(a, b)| (a - b).abs() < 1e-6) && self.o.iter().all(|v| v.abs() < 1e-6)
    }

    /// `self` después de `first`.
    pub fn after(&self, first: &Affine) -> Affine {
        let (a, b) = (&self.m, &first.m);
        let mut m = [0.0; 9];
        for r in 0..3 {
            for c in 0..3 {
                m[r * 3 + c] = (0..3).map(|k| a[r * 3 + k] * b[k * 3 + c]).sum();
            }
        }
        let mut o = [0.0; 3];
        for (r, v) in o.iter_mut().enumerate() {
            *v = (0..3).map(|k| a[r * 3 + k] * first.o[k]).sum::<f64>() + self.o[r];
        }
        Affine { m, o }
    }

    pub fn apply(&self, c: [f64; 3]) -> [f64; 3] {
        let mut out = [0.0; 3];
        for (r, v) in out.iter_mut().enumerate() {
            *v = (self.m[r * 3] * c[0] + self.m[r * 3 + 1] * c[1] + self.m[r * 3 + 2] * c[2] + self.o[r]).clamp(0.0, 1.0);
        }
        out
    }
}

fn diag(r: f64, g: f64, b: f64) -> Affine {
    Affine { m: [r, 0.0, 0.0, 0.0, g, 0.0, 0.0, 0.0, b], o: [0.0; 3] }
}

/// Saturación: mezcla con la luma (s = 1 sin cambio, 0 = gris).
pub fn saturation(s: f64) -> Affine {
    let mut m = [0.0; 9];
    for r in 0..3 {
        for c in 0..3 {
            m[r * 3 + c] = (1.0 - s) * LUMA[c] + if r == c { s } else { 0.0 };
        }
    }
    Affine { m, o: [0.0; 3] }
}

/// Ajustes de color (cada uno en -1..=1) como una sola transformación afín:
/// exposición → contraste y brillo → saturación → temperatura.
pub fn adjust_affine(c: &ColorAdjust) -> Affine {
    let cl = |v: f64| v.clamp(-1.0, 1.0);
    let gain = 2f64.powf(1.5 * cl(c.exposure));
    let exposure = diag(gain, gain, gain);
    let k = if c.contrast >= 0.0 { 1.0 + cl(c.contrast) } else { 1.0 + 0.7 * cl(c.contrast) };
    let off = 0.5 - 0.5 * k + 0.25 * cl(c.brightness);
    let contrast = Affine { m: [k, 0.0, 0.0, 0.0, k, 0.0, 0.0, 0.0, k], o: [off; 3] };
    let sat = saturation(1.0 + cl(c.saturation));
    let t = cl(c.temperature);
    let temp = diag(1.0 + 0.15 * t, 1.0 + 0.02 * t, 1.0 - 0.15 * t);
    temp.after(&sat.after(&contrast.after(&exposure)))
}

#[derive(Debug, Clone, Deserialize)]
pub struct LookDef {
    pub id: String,
    pub label: String,
    pub matrix: [f64; 9],
    pub offset: [f64; 3],
    #[serde(default)]
    pub curves: HashMap<String, Vec<[f64; 2]>>,
}

#[derive(Deserialize)]
struct LooksFile {
    looks: Vec<LookDef>,
}

pub fn looks() -> &'static [LookDef] {
    static L: OnceLock<Vec<LookDef>> = OnceLock::new();
    L.get_or_init(|| {
        serde_json::from_str::<LooksFile>(include_str!("../config/looks.json")).map(|f| f.looks).unwrap_or_default()
    })
}

pub fn look_def(id: &str) -> Option<&'static LookDef> {
    looks().iter().find(|l| l.id == id)
}

/// Matriz del look mezclada con la identidad según la intensidad.
pub fn look_affine(def: &LookDef, k: f64) -> Affine {
    let k = k.clamp(0.0, 1.0);
    let id = Affine::IDENTITY;
    let mut m = [0.0; 9];
    for (i, v) in m.iter_mut().enumerate() {
        *v = id.m[i] + k * (def.matrix[i] - id.m[i]);
    }
    Affine { m, o: [k * def.offset[0], k * def.offset[1], k * def.offset[2]] }
}

/// Curva de un canal ("r", "g", "b"; "all" vale para los tres si el canal no tiene la suya).
pub fn look_curve<'a>(def: &'a LookDef, ch: &str) -> Option<&'a [[f64; 2]]> {
    def.curves.get(ch).or_else(|| def.curves.get("all")).map(Vec::as_slice).filter(|p| p.len() >= 2)
}

/// Tramos de la curva ya mezclada con la identidad, en el dominio de `lutrgb`
/// (0..255): desde `from` vale `slope·val + offset`. Rust (expresión de FFmpeg) y
/// el preview (tabla de 256) evalúan exactamente estos números.
pub fn curve_segments(points: &[[f64; 2]], k: f64) -> Vec<(f64, f64, f64)> {
    let k = k.clamp(0.0, 1.0);
    let n = points.len();
    let flat = |y: f64| (1.0 - k, k * y * 255.0);
    let mut out = vec![];
    let (s0, c0) = flat(points[0][1]);
    out.push((f64::NEG_INFINITY, s0, c0));
    for w in points.windows(2) {
        let (a, b) = (w[0], w[1]);
        let slope = (b[1] - a[1]) / (b[0] - a[0]).max(1e-9);
        out.push((a[0] * 255.0, 1.0 - k + k * slope, k * (a[1] - slope * a[0]) * 255.0));
    }
    let (s1, c1) = flat(points[n - 1][1]);
    out.push((points[n - 1][0] * 255.0, s1, c1));
    out
}

/// Valor de la curva (0..255, sin redondear) para `val` (0..255).
pub fn curve_value(segs: &[(f64, f64, f64)], val: f64) -> f64 {
    let (_, s, c) = segs.iter().rev().find(|(from, _, _)| val >= *from).copied().unwrap_or(segs[0]);
    s * val + c
}

/// Tabla de 256 valores (lo que arma `lutrgb`): redondeo al entero más cercano.
pub fn curve_table(points: &[[f64; 2]], k: f64) -> [u8; 256] {
    let segs = curve_segments(points, k);
    let mut t = [0u8; 256];
    for (i, v) in t.iter_mut().enumerate() {
        *v = (curve_value(&segs, i as f64) + 0.5).floor().clamp(0.0, 255.0) as u8;
    }
    t
}

fn num(v: f64) -> String {
    let t = format!("{:.6}", if v.abs() < 5e-7 { 0.0 } else { v });
    let t = t.trim_end_matches('0').trim_end_matches('.');
    if t == "-0" { "0".into() } else { t.to_string() }
}

/// Número con precisión completa (el más corto que vuelve al mismo f64).
fn exact(v: f64) -> String {
    if v == 0.0 { "0".into() } else { format!("{v}") }
}

/// Expresión de `lutrgb` (variable `val`, 0..255) para una curva lineal por tramos.
pub fn curve_expr(points: &[[f64; 2]], k: f64) -> String {
    let segs = curve_segments(points, k);
    let term = |(_, s, c): (f64, f64, f64)| format!("{}*val+{}", exact(s), exact(c));
    let mut expr = term(segs[segs.len() - 1]);
    for i in (0..segs.len() - 1).rev() {
        expr = format!("if(lt(val,{}),{},{})", exact(segs[i + 1].0), term(segs[i]), expr);
    }
    format!("clip(floor({expr}+0.5),0,255)")
}

fn mixer(a: &Affine) -> String {
    let m = &a.m;
    format!(
        "colorchannelmixer=rr={}:rg={}:rb={}:ra={}:gr={}:gg={}:gb={}:ga={}:br={}:bg={}:bb={}:ba={}",
        num(m[0]),
        num(m[1]),
        num(m[2]),
        num(a.o[0]),
        num(m[3]),
        num(m[4]),
        num(m[5]),
        num(a.o[1]),
        num(m[6]),
        num(m[7]),
        num(m[8]),
        num(a.o[2])
    )
}

/// Filtros de color del clip (vacío si no hay ajustes ni look).
pub fn color_filters(adjust: &ColorAdjust, look: Option<&Look>) -> Vec<String> {
    let adj = adjust_affine(adjust);
    let look = look.and_then(|l| look_def(&l.id).map(|d| (d, l.intensity.clamp(0.0, 1.0)))).filter(|(_, k)| *k > 1e-6);
    if adj.is_identity() && look.is_none() {
        return vec![];
    }
    let mut f = vec!["format=gbrap".to_string()];
    if !adj.is_identity() {
        f.push(mixer(&adj));
    }
    if let Some((def, k)) = look {
        let la = look_affine(def, k);
        if !la.is_identity() {
            f.push(mixer(&la));
        }
        let chans: Vec<(char, String)> = ["r", "g", "b"]
            .iter()
            .filter_map(|ch| look_curve(def, ch).map(|p| (ch.chars().next().unwrap_or('r'), curve_expr(p, k))))
            .collect();
        if !chans.is_empty() {
            let parts: Vec<String> = chans.iter().map(|(c, e)| format!("{c}='{e}'")).collect();
            f.push(format!("lutrgb={}", parts.join(":")));
        }
    }
    f.push("format=yuv420p".to_string());
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: [f64; 3], b: [f64; 3]) -> bool {
        a.iter().zip(b.iter()).all(|(x, y)| (x - y).abs() < 1e-9)
    }

    #[test]
    fn neutral_adjust_is_identity() {
        assert!(adjust_affine(&ColorAdjust::default()).is_identity());
        assert!(color_filters(&ColorAdjust::default(), None).is_empty());
    }

    #[test]
    fn adjustments_behave() {
        let gray = [0.5, 0.5, 0.5];
        // Brillo sube todo; contraste deja el gris medio quieto.
        let b = adjust_affine(&ColorAdjust { brightness: 0.4, ..Default::default() });
        assert!(close(b.apply(gray), [0.6, 0.6, 0.6]));
        let c = adjust_affine(&ColorAdjust { contrast: 1.0, ..Default::default() });
        assert!(close(c.apply(gray), gray));
        assert!(close(c.apply([0.75, 0.25, 0.5]), [1.0, 0.0, 0.5]));
        // Saturación -1 = gris (luma 709).
        let s = adjust_affine(&ColorAdjust { saturation: -1.0, ..Default::default() });
        let l = 0.2126 * 0.8 + 0.7152 * 0.2 + 0.0722 * 0.1;
        assert!(close(s.apply([0.8, 0.2, 0.1]), [l, l, l]));
        // Temperatura cálida: más rojo, menos azul.
        let t = adjust_affine(&ColorAdjust { temperature: 1.0, ..Default::default() }).apply(gray);
        assert!(t[0] > 0.5 && t[2] < 0.5);
        // Exposición +1 → ×2^1.5.
        let e = adjust_affine(&ColorAdjust { exposure: 1.0, ..Default::default() }).apply([0.1, 0.1, 0.1]);
        assert!((e[0] - 0.1 * 2f64.powf(1.5)).abs() < 1e-9);
    }

    #[test]
    fn composition_order() {
        let a = diag(2.0, 2.0, 2.0);
        let b = Affine { m: Affine::IDENTITY.m, o: [0.1, 0.1, 0.1] };
        // b después de a: 2x + 0.1
        assert!(close(b.after(&a).apply([0.2, 0.2, 0.2]), [0.5, 0.5, 0.5]));
    }

    #[test]
    fn looks_load_and_preserve_gray_when_desaturating() {
        assert!(looks().len() >= 8);
        for l in looks() {
            assert!(!l.label.is_empty());
            for pts in l.curves.values() {
                assert!(pts.len() >= 2 && pts.windows(2).all(|w| w[1][0] > w[0][0]), "{}: curva ordenada", l.id);
            }
        }
        let bw = look_def("bw").unwrap();
        let out = look_affine(bw, 1.0).apply([0.3, 0.6, 0.9]);
        assert!((out[0] - out[1]).abs() < 1e-9 && (out[1] - out[2]).abs() < 1e-9);
        // Intensidad 0 = identidad.
        assert!(look_affine(bw, 0.0).is_identity());
    }

    #[test]
    fn curve_table_matches_curve() {
        let pts = [[0.0, 0.1], [0.5, 0.5], [1.0, 0.9]];
        let t = curve_table(&pts, 1.0);
        assert_eq!(t[0], 26); // 0.1*255 = 25.5 → 26
        assert_eq!(t[255], 230); // 0.9*255 = 229.5 → 230
        assert_eq!(t[128], 128);
        // Intensidad 0 = identidad.
        let id = curve_table(&pts, 0.0);
        assert!(id.iter().enumerate().all(|(i, v)| *v as usize == i));
    }

    /// Evalúa la expresión de lutrgb a mano (subconjunto: if/lt/clip/floor, * y +).
    fn eval_expr(e: &str, val: f64) -> f64 {
        /// Parte `s` por `sep` solo en profundidad 0 de paréntesis.
        fn split0(s: &str, sep: char) -> Vec<String> {
            let mut out = vec![];
            let mut depth = 0;
            let mut cur = String::new();
            for ch in s.chars() {
                match ch {
                    '(' => depth += 1,
                    ')' => depth -= 1,
                    _ => {}
                }
                if ch == sep && depth == 0 {
                    out.push(std::mem::take(&mut cur));
                } else {
                    cur.push(ch);
                }
            }
            out.push(cur);
            out
        }
        fn ev(s: &str, val: f64) -> f64 {
            let s = s.trim();
            let sum = split0(s, '+');
            if sum.len() > 1 {
                return sum.iter().map(|t| ev(t, val)).sum();
            }
            let prod = split0(s, '*');
            if prod.len() > 1 {
                return prod.iter().map(|t| ev(t, val)).product();
            }
            if s == "val" {
                return val;
            }
            if let Some(open) = s.find('(') {
                let name = &s[..open];
                let a = split0(&s[open + 1..s.len() - 1], ',');
                return match name {
                    "if" => {
                        if ev(&a[0], val) != 0.0 {
                            ev(&a[1], val)
                        } else {
                            ev(&a[2], val)
                        }
                    }
                    "lt" => (ev(&a[0], val) < ev(&a[1], val)) as i32 as f64,
                    "clip" => ev(&a[0], val).clamp(ev(&a[1], val), ev(&a[2], val)),
                    "floor" => ev(&a[0], val).floor(),
                    _ => panic!("función {name}"),
                };
            }
            s.parse::<f64>().unwrap_or_else(|_| panic!("término {s}"))
        }
        ev(e, val)
    }

    #[test]
    fn curve_expression_equals_table() {
        for l in looks() {
            for ch in ["r", "g", "b"] {
                if let Some(p) = look_curve(l, ch) {
                    for k in [1.0, 0.6] {
                        let t = curve_table(p, k);
                        let e = curve_expr(p, k);
                        for v in [0usize, 1, 17, 60, 127, 128, 200, 254, 255] {
                            assert_eq!(eval_expr(&e, v as f64) as u8, t[v], "{} {ch} k={k} val={v}: {e}", l.id);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn filters_use_alpha_for_offset_and_quote_curves() {
        let f = color_filters(&ColorAdjust { brightness: 0.4, ..Default::default() }, None);
        assert_eq!(f.first().unwrap(), "format=gbrap");
        assert!(f[1].contains("ra=0.1:"), "{}", f[1]);
        assert_eq!(f.last().unwrap(), "format=yuv420p");
        let f = color_filters(&ColorAdjust::default(), Some(&Look { id: "cinema".into(), intensity: 1.0 }));
        let lut = f.iter().find(|x| x.starts_with("lutrgb=")).unwrap();
        assert!(lut.contains("r='clip(") && lut.contains("b='clip("));
        // Look desconocido o intensidad 0: nada.
        assert!(color_filters(&ColorAdjust::default(), Some(&Look { id: "nope".into(), intensity: 1.0 })).is_empty());
        assert!(color_filters(&ColorAdjust::default(), Some(&Look { id: "bw".into(), intensity: 0.0 })).is_empty());
    }
}
