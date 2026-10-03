//! Filtros de efectos por clip y superposiciones.
//!
//! Cada función devuelve filtros con solo números (nunca texto del usuario).

use crate::error::AppError;
use crate::graph::{Graph, Inputs};
use crate::project::*;

/// Normalización lineal con las medidas de la primera pasada (equivale a una
/// ganancia fija, igual que la que aplica el preview).
pub fn loudnorm_linear(l: &Loudness) -> String {
    format!(
        "loudnorm=I={}:TP={}:LRA={}:measured_I={}:measured_TP={}:measured_LRA={}:measured_thresh={}:offset={}:linear=true:print_format=none",
        fmt(LOUDNORM_I),
        fmt(LOUDNORM_TP),
        fmt(LOUDNORM_LRA),
        fmt(l.input_i),
        fmt(l.input_tp),
        fmt(l.input_lra),
        fmt(l.input_thresh),
        fmt(l.target_offset)
    )
}

/// Número corto: sin ceros de más ("-14", "0.25").
pub fn fmt(v: f64) -> String {
    let t = format!("{:.4}", if v.abs() < 5e-5 { 0.0 } else { v });
    t.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Ganancia (dB) que aplica loudnorm en modo lineal: target - medido.
pub fn loudnorm_gain_db(l: &Loudness) -> f64 {
    LOUDNORM_I - l.input_i
}

/// Tamaño visible del clip (después de rotar y recortar), en píxeles del original.
pub fn clip_display_size(v: &ClipVideo, media: &MediaRef) -> (f64, f64) {
    let (w, h) = rotated_size(v, media);
    match &v.crop {
        Some(c) => {
            let (_, _, cw, ch) = crop_pixels(c, w, h);
            (cw as f64, ch as f64)
        }
        None => (w as f64, h as f64),
    }
}

fn rotated_size(v: &ClipVideo, media: &MediaRef) -> (u32, u32) {
    if v.rotate % 180 == 90 {
        (media.height, media.width)
    } else {
        (media.width, media.height)
    }
}

fn even_down(v: f64) -> u32 {
    ((v / 2.0).floor() * 2.0).max(0.0) as u32
}

/// Recorte en píxeles (pares, para no correr el croma en 4:2:0), dentro del cuadro.
pub fn crop_pixels(c: &CropRect, w: u32, h: u32) -> (u32, u32, u32, u32) {
    let x = c.x.clamp(0.0, 1.0);
    let y = c.y.clamp(0.0, 1.0);
    let cw = even_down((c.w.clamp(0.0, 1.0 - x) * w as f64).round()).max(2).min(w & !1);
    let ch = even_down((c.h.clamp(0.0, 1.0 - y) * h as f64).round()).max(2).min(h & !1);
    let cx = even_down((x * w as f64).round()).min(even_down(w.saturating_sub(cw) as f64));
    let cy = even_down((y * h as f64).round()).min(even_down(h.saturating_sub(ch) as f64));
    (cx, cy, cw, ch)
}

/// Nitidez 0..=1 → peso del laplaciano (en 1/64, el mismo número usa el preview).
pub fn sharpen_weight(v: f64) -> i32 {
    (v.clamp(0.0, 1.0) * 0.6 * 64.0).round() as i32
}

/// Efectos de imagen del clip, antes de llevarlo al lienzo:
/// rotar → voltear → recortar → nitidez (luma) → color.
pub fn clip_video_effects(v: &ClipVideo, media: &MediaRef) -> Vec<String> {
    let mut f = vec![];
    match v.rotate % 360 {
        90 => f.push("transpose=clock".to_string()),
        180 => f.push("hflip,vflip".to_string()),
        270 => f.push("transpose=cclock".to_string()),
        _ => {}
    }
    if v.flip_h {
        f.push("hflip".to_string());
    }
    if v.flip_v {
        f.push("vflip".to_string());
    }
    if let Some(c) = &v.crop {
        let (w, h) = rotated_size(v, media);
        let (x, y, cw, ch) = crop_pixels(c, w, h);
        if (cw, ch) != (w & !1, h & !1) || x > 0 || y > 0 {
            f.push(format!("crop=w={cw}:h={ch}:x={x}:y={y}:exact=1"));
        }
    }
    let a = sharpen_weight(v.sharpen);
    if a > 0 {
        f.push("format=yuv420p".to_string());
        f.push(format!("convolution=0m='0 -{a} 0 -{a} {c} -{a} 0 -{a} 0':0rdiv=0.015625:0bias=0", c = 64 + 4 * a));
    }
    f.extend(crate::color::color_filters(&v.color, v.look.as_ref()));
    f
}

/// Expresión de la curva de easing para el parámetro `p` (0..1), igual que `ease()` del preview.
fn ease_expr(e: Easing, p: &str) -> String {
    match e {
        Easing::Linear => p.to_string(),
        Easing::EaseIn => format!("pow({p},3)"),
        Easing::EaseOut => format!("1-pow(1-{p},3)"),
        Easing::EaseInOut => format!("if(lt({p},0.5),4*pow({p},3),1-pow(-2*{p}+2,3)/2)"),
    }
}

/// Valor animado (zoom, cx o cy) en el tiempo `T` (segundos desde el inicio del clip).
fn keyed_expr(keys: &[ZoomKey], get: impl Fn(&ZoomKey) -> f64, t: &str) -> String {
    let n = keys.len();
    let mut expr = fmt(get(&keys[n - 1]));
    for i in (0..n - 1).rev() {
        let (a, b) = (&keys[i], &keys[i + 1]);
        let (va, vb) = (get(a), get(b));
        let seg = if (vb - va).abs() < 1e-9 {
            fmt(va)
        } else {
            let p = format!("clip(({t}-{})/{},0,1)", fmt(a.t), fmt((b.t - a.t).max(1e-6)));
            format!("{}+{}*({})", fmt(va), fmt(vb - va), ease_expr(a.easing, &p))
        };
        expr = format!("if(lt({t},{}),{},{})", fmt(b.t), seg, expr);
    }
    format!("if(lt({t},{}),{},{})", fmt(keys[0].t), fmt(get(&keys[0])), expr)
}

/// Keyframes válidos y ordenados (zoom ≥ 1).
pub fn sorted_keys(keys: &[ZoomKey]) -> Vec<ZoomKey> {
    let mut k: Vec<ZoomKey> = keys
        .iter()
        .filter(|k| k.t.is_finite() && k.zoom.is_finite() && k.cx.is_finite() && k.cy.is_finite())
        .map(|k| ZoomKey { zoom: k.zoom.clamp(1.0, 8.0), cx: k.cx.clamp(0.0, 1.0), cy: k.cy.clamp(0.0, 1.0), t: k.t.max(0.0), ..*k })
        .collect();
    k.sort_by(|a, b| a.t.total_cmp(&b.t));
    k
}

/// Zoom y paneo animado sobre el clip ya llevado al lienzo: `perspective`
/// recorta la ventana visible (centrada en cx, cy; nunca sale del cuadro).
pub fn zoom_filters(keys: &[ZoomKey], canvas: &Canvas) -> Vec<String> {
    let keys = sorted_keys(keys);
    if keys.is_empty() || keys.iter().all(|k| (k.zoom - 1.0).abs() < 1e-6) {
        return vec![];
    }
    // `in` de perspective arranca en 1 (frame_count_out + 1).
    let t = format!("((in-1)/{})", fmt(canvas.fps()));
    let z = format!("({})", keyed_expr(&keys, |k| k.zoom, &t));
    let cx = format!("clip({},0.5/{z},1-0.5/{z})", keyed_expr(&keys, |k| k.cx, &t));
    let cy = format!("clip({},0.5/{z},1-0.5/{z})", keyed_expr(&keys, |k| k.cy, &t));
    let x0 = format!("({cx}-0.5/{z})*W");
    let y0 = format!("({cy}-0.5/{z})*H");
    let x1 = format!("({cx}+0.5/{z})*W");
    let y2 = format!("({cy}+0.5/{z})*H");
    vec![format!(
        "perspective=x0='{x0}':y0='{y0}':x1='{x1}':y1='{y0}':x2='{x0}':y2='{y2}':x3='{x1}':y3='{y2}':interpolation=linear:sense=source:eval=frame"
    )]
}

/// Superposiciones sobre la secuencia: devuelve la etiqueta del resultado.
pub fn apply_overlays(
    _g: &mut Graph,
    _inputs: &mut Inputs,
    _p: &Project,
    _raster: Option<&crate::compile::RasterInputs>,
    video: &str,
    _base: f64,
    _seq_dur: f64,
) -> Result<String, AppError> {
    Ok(video.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;

    fn video() -> ClipVideo {
        ClipVideo::default()
    }

    #[test]
    fn geometry_filters_in_order() {
        let m = media("m", "/v.mp4", 10.0, 1920, 1080, 30, true);
        let mut v = video();
        assert!(clip_video_effects(&v, &m).is_empty());
        v.rotate = 90;
        v.flip_h = true;
        v.crop = Some(CropRect { x: 0.1, y: 0.25, w: 0.5, h: 0.5, aspect: None });
        let f = clip_video_effects(&v, &m);
        // Después de rotar, el cuadro es 1080x1920.
        assert_eq!(f, vec!["transpose=clock", "hflip", "crop=w=540:h=960:x=108:y=480:exact=1"]);
        assert_eq!(clip_display_size(&v, &m), (540.0, 960.0));
        v.rotate = 180;
        v.flip_h = false;
        v.crop = None;
        assert_eq!(clip_video_effects(&v, &m), vec!["hflip,vflip"]);
        v.rotate = 270;
        assert_eq!(clip_video_effects(&v, &m), vec!["transpose=cclock"]);
        assert_eq!(clip_display_size(&v, &m), (1080.0, 1920.0));
    }

    #[test]
    fn crop_is_even_and_inside() {
        let c = CropRect { x: 0.999, y: 0.0, w: 0.5, h: 1.0, aspect: None };
        let (x, y, w, h) = crop_pixels(&c, 641, 361);
        assert!(x % 2 == 0 && y % 2 == 0 && w % 2 == 0 && h % 2 == 0);
        assert!(x + w <= 641 && y + h <= 361 && w >= 2);
        // Recorte completo = sin filtro.
        let m = media("m", "/v.mp4", 10.0, 1280, 720, 30, false);
        let v = ClipVideo { crop: Some(CropRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0, aspect: None }), ..video() };
        assert!(clip_video_effects(&v, &m).is_empty());
    }

    #[test]
    fn sharpen_uses_luma_laplacian() {
        let m = media("m", "/v.mp4", 10.0, 640, 360, 30, false);
        let v = ClipVideo { sharpen: 0.5, ..video() };
        let f = clip_video_effects(&v, &m);
        assert_eq!(f[0], "format=yuv420p");
        // a = round(0.5 * 0.6 * 64) = 19 → centro 64 + 76.
        assert_eq!(f[1], "convolution=0m='0 -19 0 -19 140 -19 0 -19 0':0rdiv=0.015625:0bias=0");
    }

    #[test]
    fn color_goes_last() {
        let m = media("m", "/v.mp4", 10.0, 640, 360, 30, false);
        let v = ClipVideo { flip_v: true, color: ColorAdjust { saturation: 0.5, ..Default::default() }, ..video() };
        let f = clip_video_effects(&v, &m);
        assert_eq!(f[0], "vflip");
        assert_eq!(f[1], "format=gbrap");
        assert!(f[2].starts_with("colorchannelmixer="));
    }

    #[test]
    fn zoom_keyframes_compile_to_perspective() {
        let c = Canvas { width: 1280, height: 720, fps_num: 30, fps_den: 1, auto: true };
        assert!(zoom_filters(&[], &c).is_empty());
        let k = |id, t, zoom, cx, cy, easing| ZoomKey { id, t, zoom, cx, cy, easing };
        assert!(zoom_filters(&[k(1, 0.0, 1.0, 0.3, 0.3, Easing::Linear)], &c).is_empty());
        let f = zoom_filters(&[k(2, 2.0, 2.0, 0.75, 0.5, Easing::EaseInOut), k(1, 0.0, 1.0, 0.5, 0.5, Easing::Linear)], &c);
        assert_eq!(f.len(), 1);
        let p = &f[0];
        assert!(p.starts_with("perspective=x0='") && p.ends_with(":interpolation=linear:sense=source:eval=frame"));
        assert!(p.contains("((in-1)/30)") && p.contains("clip((((in-1)/30)-0)/2,0,1)"), "{p}");
        // Las comas de las expresiones van dentro de comillas.
        for part in p.split(':') {
            if part.contains(',') {
                assert!(part.contains('\''), "{part}");
            }
        }
    }

    #[test]
    fn loudnorm_uses_measured_values_and_linear_mode() {
        let l = Loudness { input_i: -23.5, input_tp: -5.25, input_lra: 7.0, input_thresh: -34.0, target_offset: -0.1 };
        let f = loudnorm_linear(&l);
        assert_eq!(
            f,
            "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23.5:measured_TP=-5.25:measured_LRA=7:measured_thresh=-34:offset=-0.1:linear=true:print_format=none"
        );
        assert!((loudnorm_gain_db(&l) - 9.5).abs() < 1e-9);
        assert_eq!(fmt(0.00001), "0");
    }
}
