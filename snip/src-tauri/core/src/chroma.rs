//! Chroma key de los picture-in-picture (espejo del shader `PIP_FRAG`):
//! `chromakey` de FFmpeg (distancia UV promediada en 3×3) y, si el fondo es
//! verde o azul, `despill` para sacar el reflejo del color en los bordes.

use crate::project::ChromaKey;

pub const MIN_SIMILARITY: f64 = 0.01;
pub const MAX_SIMILARITY: f64 = 0.6;
pub const MAX_SMOOTHNESS: f64 = 0.5;

/// Color `#rrggbb` → (r, g, b).
pub fn parse_color(c: &str) -> Option<(u8, u8, u8)> {
    let h = c.trim().trim_start_matches('#');
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some(((v >> 16) as u8, (v >> 8) as u8, v as u8))
}

/// De qué color es el reflejo a quitar: verde, azul o ninguno.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Spill {
    Green,
    Blue,
}

pub fn spill_of(rgb: (u8, u8, u8)) -> Option<Spill> {
    let (r, g, b) = (rgb.0 as i32, rgb.1 as i32, rgb.2 as i32);
    if g > r && g > b {
        Some(Spill::Green)
    } else if b > r && b > g {
        Some(Spill::Blue)
    } else {
        None
    }
}

fn n(v: f64) -> String {
    let t = format!("{v:.4}");
    t.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Filtros para un video en `yuva420p`: devuelve la cadena (termina en `rgba`).
pub fn filters(k: &ChromaKey) -> Option<String> {
    let rgb = parse_color(&k.color)?;
    let sim = k.similarity.clamp(MIN_SIMILARITY, MAX_SIMILARITY);
    let blend = k.smoothness.clamp(0.0, MAX_SMOOTHNESS);
    let mut f = format!("chromakey=color=0x{:02x}{:02x}{:02x}:similarity={}:blend={},format=rgba", rgb.0, rgb.1, rgb.2, n(sim), n(blend));
    let d = k.despill.clamp(0.0, 1.0);
    if d > 1e-3 {
        if let Some(sp) = spill_of(rgb) {
            let (ty, g, b) = match sp {
                Spill::Green => ("green", -d, 0.0),
                Spill::Blue => ("blue", 0.0, -d),
            };
            f.push_str(&format!(",despill=type={ty}:mix=0.5:expand=0:red=0:green={}:blue={}:brightness=0:alpha=0", n(g), n(b)));
        }
    }
    Some(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(c: &str, d: f64) -> ChromaKey {
        ChromaKey { color: c.into(), similarity: 0.15, smoothness: 0.08, despill: d }
    }

    #[test]
    fn colors_and_spill() {
        assert_eq!(parse_color("#00b140"), Some((0, 0xb1, 0x40)));
        assert_eq!(parse_color("00B140"), Some((0, 0xb1, 0x40)));
        assert_eq!(parse_color("#00b14"), None);
        assert_eq!(parse_color("#zzzzzz"), None);
        assert_eq!(spill_of((0, 177, 64)), Some(Spill::Green));
        assert_eq!(spill_of((10, 60, 220)), Some(Spill::Blue));
        assert_eq!(spill_of((200, 30, 30)), None);
    }

    #[test]
    fn filter_chain() {
        let f = filters(&key("#00b140", 0.5)).unwrap();
        assert!(f.starts_with("chromakey=color=0x00b140:similarity=0.15:blend=0.08,format=rgba"), "{f}");
        assert!(f.contains("despill=type=green:mix=0.5:expand=0:red=0:green=-0.5:blue=0"), "{f}");
        let b = filters(&key("#1040e0", 1.0)).unwrap();
        assert!(b.contains("despill=type=blue") && b.contains("blue=-1"), "{b}");
        // Sin despill, o fondo que no es verde ni azul: solo la llave.
        assert!(!filters(&key("#00b140", 0.0)).unwrap().contains("despill"));
        assert!(!filters(&key("#d02020", 1.0)).unwrap().contains("despill"));
        assert!(filters(&key("verde", 1.0)).is_none());
        // Valores fuera de rango se limitan.
        let c = filters(&ChromaKey { color: "#00ff00".into(), similarity: 5.0, smoothness: -1.0, despill: 0.0 }).unwrap();
        assert!(c.contains("similarity=0.6:blend=0,"), "{c}");
    }
}
