//! Cálculo de escalado: mantiene el aspect ratio, usa dimensiones pares y
//! detecta cuándo un cambio sería un agrandado (upscale).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ResolutionChoice {
    Original,
    P2160,
    P1440,
    P1080,
    P720,
    /// Ancho elegido por el usuario; el alto se calcula con el aspect ratio.
    Custom { width: u32 },
}

impl ResolutionChoice {
    /// Lado corto objetivo de los presets ("1080p" = lado corto de 1080 px,
    /// así un video vertical 1080×1920 sigue siendo "1080p").
    pub fn short_side(self) -> Option<u32> {
        match self {
            ResolutionChoice::P2160 => Some(2160),
            ResolutionChoice::P1440 => Some(1440),
            ResolutionChoice::P1080 => Some(1080),
            ResolutionChoice::P720 => Some(720),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dims {
    pub width: u32,
    pub height: u32,
}

impl Dims {
    pub const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }
}

/// Redondea al par más cercano (mínimo 2).
pub fn round_even(x: f64) -> u32 {
    let v = (x / 2.0).round() * 2.0;
    if v.is_finite() && v >= 2.0 { v as u32 } else { 2 }
}

/// Trunca al par inferior (mínimo 2). Se usa para "Original" con medidas impares,
/// así nunca agrandamos ni un píxel.
pub fn floor_even(x: u32) -> u32 {
    (x & !1).max(2)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalePlan {
    pub width: u32,
    pub height: u32,
    /// Hace falta un filtro `scale` (cambió el tamaño o había medidas impares).
    pub needs_scale: bool,
    /// El resultado es más grande que el original en algún eje.
    pub upscale: bool,
}

/// Calcula el tamaño de salida a partir del tamaño de visualización del original.
pub fn plan_scale(src: Dims, choice: ResolutionChoice) -> ScalePlan {
    let (w, h) = (src.width.max(2) as f64, src.height.max(2) as f64);
    let (tw, th) = match choice {
        ResolutionChoice::Original => (floor_even(src.width), floor_even(src.height)),
        ResolutionChoice::Custom { width } => {
            let tw = round_even(width.clamp(2, 16384) as f64);
            (tw, round_even(h * tw as f64 / w))
        }
        preset => {
            let target = preset.short_side().unwrap_or(1080) as f64;
            if w >= h {
                (round_even(w * target / h), target as u32)
            } else {
                (target as u32, round_even(h * target / w))
            }
        }
    };
    ScalePlan {
        width: tw,
        height: th,
        needs_scale: tw != src.width || th != src.height,
        upscale: tw > src.width || th > src.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ResolutionChoice::*;

    fn plan(w: u32, h: u32, c: ResolutionChoice) -> (u32, u32, bool, bool) {
        let p = plan_scale(Dims::new(w, h), c);
        (p.width, p.height, p.needs_scale, p.upscale)
    }

    #[test]
    fn presets_on_landscape() {
        assert_eq!(plan(3840, 2160, P1080), (1920, 1080, true, false));
        assert_eq!(plan(3840, 2160, P720), (1280, 720, true, false));
        assert_eq!(plan(3840, 2160, P1440), (2560, 1440, true, false));
        assert_eq!(plan(1920, 1080, P2160), (3840, 2160, true, true));
        assert_eq!(plan(1920, 1080, P1080), (1920, 1080, false, false));
    }

    #[test]
    fn presets_on_portrait_use_the_short_side() {
        assert_eq!(plan(1080, 1920, P720), (720, 1280, true, false));
        assert_eq!(plan(2160, 3840, P1080), (1080, 1920, true, false));
    }

    #[test]
    fn keeps_aspect_ratio_with_even_dimensions() {
        // Cinemascope 2.39:1
        let (w, h, _, up) = plan(2560, 1072, P720);
        assert_eq!(h, 720);
        assert_eq!(w % 2, 0);
        assert!(((w as f64 / h as f64) - 2560.0 / 1072.0).abs() < 0.01);
        assert!(!up);
        // 4:3
        assert_eq!(plan(1440, 1080, P720), (960, 720, true, false));
        // Medidas que dan impar al escalar.
        let (w, h, _, _) = plan(1366, 768, P720);
        assert_eq!((w % 2, h % 2), (0, 0));
        assert_eq!((w, h), (1280, 720));
    }

    #[test]
    fn custom_width_derives_height() {
        assert_eq!(plan(1920, 1080, Custom { width: 1000 }), (1000, 562, true, false));
        assert_eq!(plan(1920, 1080, Custom { width: 1001 }), (1002, 564, true, false));
        assert_eq!(plan(1920, 1080, Custom { width: 2560 }), (2560, 1440, true, true));
        assert_eq!(plan(1080, 1920, Custom { width: 540 }), (540, 960, true, false));
    }

    #[test]
    fn original_fixes_odd_sizes_without_upscaling() {
        assert_eq!(plan(1921, 1081, Original), (1920, 1080, true, false));
        assert_eq!(plan(1920, 1080, Original), (1920, 1080, false, false));
    }

    #[test]
    fn upscale_detection() {
        assert!(plan_scale(Dims::new(1280, 720), P1080).upscale);
        assert!(!plan_scale(Dims::new(1280, 720), P720).upscale);
        assert!(plan_scale(Dims::new(640, 480), P720).upscale);
    }

    #[test]
    fn serde_shape() {
        let c: ResolutionChoice = serde_json::from_str(r#"{"kind":"custom","width":800}"#).unwrap();
        assert_eq!(c, Custom { width: 800 });
        let c: ResolutionChoice = serde_json::from_str(r#"{"kind":"p1080"}"#).unwrap();
        assert_eq!(c, P1080);
    }
}
