//! Efectos de un clic sobre todo el cuadro (bloques en la pista de capas):
//! temblor, zoom punch, flash, glitch y viñeta. Las fórmulas son las mismas que
//! `src/engine/fx.ts` (preview). El tiempo de cada efecto `τ` se cuenta desde el
//! primer cuadro del lienzo que cae dentro del bloque.

use crate::project::{EffectKind, EffectLayer};

pub const SHAKE_AMP: f64 = 0.03;
pub const SHAKE_RAMP: f64 = 0.1;
pub const PUNCH_ZOOM: f64 = 0.35;
pub const PUNCH_ATTACK: f64 = 0.2;
pub const FLASH_ATTACK: f64 = 0.08;
pub const VIGNETTE_FADE: f64 = 0.25;
pub const VIGNETTE_MAX: f64 = 0.9;
pub const GLITCH_RATE: f64 = 15.0;
pub const GLITCH_BANDS: f64 = 18.0;
/// Tamaño (divisor) de la grilla donde se calcula el alfa del flash y la viñeta.
pub const TINT_GRID: u32 = 8;

fn n(v: f64) -> String {
    let t = format!("{v:.6}");
    t.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Primer cuadro (tiempo del lienzo) en o después de `t`.
pub fn first_frame(t: f64, fps: f64) -> f64 {
    (t * fps - 1e-6).ceil() / fps
}

/// Ventana (centro x, centro y, zoom) de los efectos que mueven el cuadro.
/// `tau`, `d` e `i` son expresiones; el resultado también.
fn window_exprs(kind: EffectKind, tau: &str, d: &str, i: &str) -> Option<(String, String, String)> {
    match kind {
        EffectKind::Shake => {
            let env = format!("max(0,min(1,min({tau}/{r},({d}-{tau})/{r})))", r = n(SHAKE_RAMP));
            let amp = format!("({i}*{}*{env})", n(SHAKE_AMP));
            let z = format!("(1+2.5*{amp})");
            let dx = format!("{amp}*(0.6*sin(2*PI*7.3*{tau})+0.4*sin(2*PI*13.1*{tau}+1.3))");
            let dy = format!("{amp}*(0.6*sin(2*PI*8.7*{tau}+0.7)+0.4*sin(2*PI*11.9*{tau}+2.1))");
            let cx = format!("clip(0.5+{dx},0.5/{z},1-0.5/{z})");
            let cy = format!("clip(0.5+{dy},0.5/{z},1-0.5/{z})");
            Some((cx, cy, z))
        }
        EffectKind::ZoomPunch => {
            let u = format!("clip({tau}/{d},0,1)");
            let a = n(PUNCH_ATTACK);
            let v = format!("(({u}-{a})/(1-{a}))");
            let io = format!("if(lt({v},0.5),4*pow({v},3),1-pow(-2*{v}+2,3)/2)");
            let p = format!("if(lt({u},{a}),1-pow(1-{u}/{a},3),1-{io})");
            Some(("0.5".into(), "0.5".into(), format!("(1+{}*{i}*{p})", n(PUNCH_ZOOM))))
        }
        _ => None,
    }
}

/// Cadena para el tramo del efecto (el video entra ya recortado a [g0, g1) y con
/// sus tiempos originales). `tau0` = τ del primer cuadro del tramo.
pub fn segment_filters(e: &EffectLayer, duration: f64, tau0: f64, fps: f64) -> Option<String> {
    let i = n(e.intensity.clamp(0.0, 1.0));
    let d = n(duration.max(1e-3));
    match e.kind {
        EffectKind::Shake | EffectKind::ZoomPunch => {
            // `in` de perspective arranca en 1.
            let tau = format!("((in-1)/{}+{})", n(fps), n(tau0));
            let (cx, cy, z) = window_exprs(e.kind, &tau, &d, &i)?;
            let x0 = format!("({cx}-0.5/{z})*W");
            let y0 = format!("({cy}-0.5/{z})*H");
            let x1 = format!("({cx}+0.5/{z})*W");
            let y2 = format!("({cy}+0.5/{z})*H");
            Some(format!(
                "perspective=x0='{x0}':y0='{y0}':x1='{x1}':y1='{y0}':x2='{x0}':y2='{y2}':x3='{x1}':y3='{y2}':interpolation=linear:sense=source:eval=frame"
            ))
        }
        // N = cuadro dentro del tramo (no T: los tiempos del original pueden venir truncados al ms).
        EffectKind::Glitch => Some(glitch_geq(&i, &glitch_step_expr(fps, tau0))),
        _ => None,
    }
}

/// Glitch: bandas horizontales corridas y separación RGB, cambiando 15 veces
/// por segundo. Todo con enteros (igual en el shader). `k` = paso de tiempo.
fn glitch_geq(i: &str, k: &str) -> String {
    let k = format!("({k})");
    let b = format!("floor(Y*{}/H)", n(GLITCH_BANDS));
    let h = format!("(mod({b}*37+{k}*101+7,23)/23)");
    let shift = format!("if(gt({h},0.62),round({i}*W*0.06*({h}-0.62)/0.38)*(2*mod({b}+{k},2)-1),0)");
    let split = format!("round({i}*W*0.006*(1+mod({k}*7,3)))");
    format!(
        "format=gbrp,geq=r='r(clip(X+{shift}+{split},0,W-1),Y)':g='g(clip(X+{shift},0,W-1),Y)':b='b(clip(X+{shift}-{split},0,W-1),Y)'"
    )
}

/// Paso del glitch para el cuadro N del tramo: `floor((N/fps + tau0)·15)`.
pub fn glitch_step_expr(fps: f64, tau0: f64) -> String {
    format!("floor((N/{}+{})*{}+0.000001)", n(fps), n(tau0), n(GLITCH_RATE))
}

/// Alfa del flash (blanco) o la viñeta (negro) en (x, y normalizados) y τ.
/// Devuelve (color, expresión de alfa 0..255 para geq sobre la grilla chica).
pub fn tint_alpha(e: &EffectLayer, duration: f64, tau: &str) -> Option<(&'static str, String)> {
    let i = n(e.intensity.clamp(0.0, 1.0));
    let d = duration.max(1e-3);
    match e.kind {
        EffectKind::Flash => {
            let a = FLASH_ATTACK.min(0.25 * d);
            let rest = (d - a).max(1e-3);
            let env = format!("if(lt({tau},{a}),{tau}/{a},max(0,1-({tau}-{a})/{rest}))", a = n(a), rest = n(rest));
            Some(("white", format!("255*{i}*clip({env},0,1)")))
        }
        EffectKind::Vignette => {
            let f = n(VIGNETTE_FADE.min(d / 2.0));
            let env = format!("max(0,min(1,min({tau}/{f},({d}-{tau})/{f})))", d = n(d));
            // Distancia al centro (elipse del cuadro), 0 en el centro y 1 en las esquinas.
            let dist = "(hypot(2*(X+0.5)/W-1,2*(Y+0.5)/H-1)/sqrt(2))";
            let ss = format!("clip(({dist}-0.3)/0.7,0,1)");
            let smooth = format!("({ss}*{ss}*(3-2*{ss}))");
            Some(("black", format!("255*{i}*{}*{smooth}*{env}", n(VIGNETTE_MAX))))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(kind: EffectKind) -> EffectLayer {
        EffectLayer { kind, intensity: 0.8 }
    }

    #[test]
    fn first_frame_on_the_grid() {
        assert!((first_frame(1.0, 30.0) - 1.0).abs() < 1e-9);
        assert!((first_frame(1.01, 30.0) - 31.0 / 30.0).abs() < 1e-9);
    }

    #[test]
    fn moving_effects_use_perspective() {
        let s = segment_filters(&fx(EffectKind::Shake), 1.0, 0.0, 30.0).unwrap();
        assert!(s.starts_with("perspective=") && s.contains("sin(2*PI*7.3*((in-1)/30+0))") && s.contains("sense=source"), "{s}");
        let z = segment_filters(&fx(EffectKind::ZoomPunch), 0.5, 0.1, 30.0).unwrap();
        assert!(z.contains("1+0.35*0.8*") && z.contains("((in-1)/30+0.1)"), "{z}");
        assert!(segment_filters(&fx(EffectKind::Flash), 1.0, 0.0, 30.0).is_none());
    }

    #[test]
    fn glitch_and_tints() {
        let g = segment_filters(&fx(EffectKind::Glitch), 1.0, 0.0, 30.0).unwrap();
        assert!(g.starts_with("format=gbrp,geq=r='r(clip(X+") && g.contains("mod((floor((N/30+0)*15+0.000001))*7,3)"), "{g}");
        assert_eq!(glitch_step_expr(30.0, 0.5), "floor((N/30+0.5)*15+0.000001)");
        let (c, a) = tint_alpha(&fx(EffectKind::Flash), 0.5, "t").unwrap();
        assert_eq!(c, "white");
        assert!(a.contains("if(lt(t,0.08),t/0.08,max(0,1-(t-0.08)/0.42))"), "{a}");
        let (c, a) = tint_alpha(&fx(EffectKind::Vignette), 3.0, "t").unwrap();
        assert_eq!(c, "black");
        assert!(a.contains("hypot(2*(X+0.5)/W-1") && a.contains("0.9*"), "{a}");
        assert!(tint_alpha(&fx(EffectKind::Shake), 1.0, "t").is_none());
    }
}
