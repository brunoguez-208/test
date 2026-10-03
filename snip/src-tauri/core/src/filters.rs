//! Filtros de efectos por clip y superposiciones.
//!
//! Cada función devuelve filtros con solo números (nunca texto del usuario).

use crate::error::{AppError, ErrorKind};
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
/// HDR → SDR (BT.709, 8 bits) con tonemap Hable; nada si el medio es SDR.
/// Los encoders por hardware no aceptan 10 bits/PQ en H.264, y sin esto el
/// video HDR se vería lavado.
pub fn hdr_to_sdr(media: &MediaRef) -> Option<String> {
    let tin = media.transfer.as_deref().filter(|_| media.is_hdr())?;
    Some(format!(
        "zscale=tin={tin}:min=bt2020nc:pin=bt2020:rin=tv:t=linear:npl=100,format=gbrpf32le,\
zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
    ))
}

pub fn clip_video_effects(v: &ClipVideo, media: &MediaRef) -> Vec<String> {
    let mut f = vec![];
    f.extend(hdr_to_sdr(media));
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

/// Radio del desenfoque (px del lienzo) para una intensidad 0..=1 (el mismo usa el preview).
pub fn blur_radius(strength: f64, canvas_h: u32) -> u32 {
    ((strength.clamp(0.0, 1.0) * canvas_h as f64 * 0.04).round() as u32).max(1)
}

/// Tamaño del bloque del pixelado (px del lienzo).
pub fn pixel_size(strength: f64, canvas_h: u32) -> u32 {
    ((strength.clamp(0.0, 1.0) * canvas_h as f64 * 0.06).round() as u32).max(2)
}

/// Parte de [start, end) del timeline que cae en la secuencia exportada
/// [base, base + seq_dur): (desde, hasta) en tiempo del timeline.
fn visible_part(start: f64, end: f64, base: f64, seq_dur: f64) -> Option<(f64, f64)> {
    let s0 = start.max(base);
    let s1 = end.min(base + seq_dur);
    (s1 - s0 > EPS_T).then_some((s0, s1))
}

const EPS_T: f64 = 1e-4;

fn num(v: f64) -> String {
    crate::compile::num(v)
}

/// Superposiciones sobre la secuencia: devuelve la etiqueta del resultado.
///
/// Orden (igual que el preview): zonas desenfocadas → picture-in-picture →
/// capa de "decoración" (textos, subtítulos, logos). Las máscaras, la sombra
/// del PiP y la decoración las rasteriza el frontend con el mismo código del
/// preview; la decoración cubre todo el timeline y acá se recorta a la ventana.
pub fn apply_overlays(
    g: &mut Graph,
    inputs: &mut Inputs,
    p: &Project,
    raster: Option<&crate::compile::RasterInputs>,
    video: &str,
    base: f64,
    seq_dur: f64,
) -> Result<String, AppError> {
    let mut cur = video.to_string();
    // Pista de video oculta (ojo): negro, con las capas encima como siempre.
    if p.tracks.video.hidden {
        let out = g.label("hid");
        g.add(&[&cur], "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill", &out);
        cur = out;
    }
    // Filas de capas ocultas: no se dibujan (ni suena su PiP).
    let mut ordered: Vec<&Overlay> = p.overlays.iter().filter(|o| !p.tracks.overlay(o.lane).hidden).collect();
    ordered.sort_by(|a, b| a.lane.cmp(&b.lane).then(a.start.total_cmp(&b.start)));
    let missing = || AppError::with_message(ErrorKind::BadProject, "Faltan las capas de desenfoque o PiP: volvé a exportar.");

    // 1) Zonas desenfocadas o pixeladas.
    for o in ordered.iter().filter(|o| matches!(o.content, OverlayContent::Blur(_))) {
        let OverlayContent::Blur(b) = &o.content else { continue };
        if visible_part(o.start, o.start + o.duration, base, seq_dur).is_none() {
            continue;
        }
        let mask = raster.and_then(|r| r.masks.get(&o.id)).ok_or_else(missing)?;
        let k = inputs.add(vec!["-f".into(), "concat".into(), "-safe".into(), "0".into()], mask);
        let (w, h) = (p.canvas.width, p.canvas.height);
        let mk = g.label("mk");
        g.add(
            &[&format!("{k}:v:0")],
            &format!("format=gray,scale={w}:{h},trim=start={}:duration={},setpts=PTS-STARTPTS", num(base), num(seq_dur + 1.0)),
            &mk,
        );
        let (a, bb) = (g.label("bs"), g.label("bs"));
        g.add(&[&cur], "split", &format!("{a}][{bb}"));
        let effect = match b.mode {
            BlurMode::Blur => {
                let r = blur_radius(b.strength, h);
                format!("boxblur=luma_radius={r}:luma_power=1:chroma_radius={}:chroma_power=1", (r / 2).max(1))
            }
            BlurMode::Pixelate => {
                let n = pixel_size(b.strength, h);
                format!("pixelize=width={n}:height={n}:mode=avg")
            }
        };
        let bl = g.label("bl");
        g.add(&[&bb], &format!("{effect},format=yuva420p"), &bl);
        let ba = g.label("ba");
        g.add(&[&bl, &mk], "alphamerge", &ba);
        let out = g.label("ov");
        g.add(&[&a, &ba], "overlay=format=auto", &out);
        cur = out;
    }

    // 2) Picture-in-picture.
    let fps = p.canvas.fps_expr();
    for o in ordered.iter().filter(|o| matches!(o.content, OverlayContent::Video(_))) {
        let OverlayContent::Video(v) = &o.content else { continue };
        let Some((s0, s1)) = visible_part(o.start, o.start + o.duration, base, seq_dur) else { continue };
        let spec = raster.and_then(|r| r.pip.get(&o.id)).ok_or_else(missing)?;
        let media = p.media(&v.media_id).ok_or_else(|| AppError::new(ErrorKind::BadProject))?;
        let (ss, dur, offset) = (v.in_point + (s0 - o.start), s1 - s0, s0 - base);
        let k = inputs.add(vec!["-ss".into(), num(ss), "-t".into(), num(dur)], &media.path);
        let pv = g.label("pv");
        g.add(
            &[&format!("{k}:v:0")],
            &format!(
                "setpts=PTS-STARTPTS,fps={fps},scale={}:{}:flags=lanczos,setsar=1,format=yuva420p,tpad=stop_mode=clone:stop_duration=1,trim=duration={}",
                spec.width,
                spec.height,
                num(dur)
            ),
            &pv,
        );
        let mk = inputs.add(vec!["-loop".into(), "1".into(), "-t".into(), num(dur)], &spec.mask);
        let pm = g.label("pm");
        g.add(&[&format!("{mk}:v:0")], &format!("format=gray,scale={}:{},fps={fps}", spec.width, spec.height), &pm);
        let pa = g.label("pa");
        match v.chroma.as_ref().and_then(crate::chroma::filters) {
            // Con chroma key: alfa = máscara × llave (como el shader del preview).
            Some(key) => {
                let (pc, pk) = (g.label("pc"), g.label("pk"));
                g.add(&[&pv], &format!("{key},split"), &format!("{pc}][{pk}"));
                let ka = g.label("ka");
                g.add(&[&pk], "alphaextract", &ka);
                let am = g.label("am");
                g.add(&[&ka, &pm], "blend=all_mode=multiply", &am);
                g.add(&[&pc, &am], &format!("alphamerge,setpts=PTS+{}/TB", num(offset)), &pa);
            }
            None => g.add(&[&pv, &pm], &format!("alphamerge,setpts=PTS+{}/TB", num(offset)), &pa),
        }
        let enable = format!("enable='between(t,{},{})'", num(offset), num(offset + dur - EPS_T));
        if let Some(shadow) = &spec.shadow {
            let sk = inputs.add(vec!["-loop".into(), "1".into(), "-t".into(), num(dur)], shadow);
            let ps = g.label("ps");
            g.add(&[&format!("{sk}:v:0")], &format!("format=rgba,fps={fps},setpts=PTS+{}/TB", num(offset)), &ps);
            let out = g.label("ov");
            g.add(&[&cur, &ps], &format!("overlay=0:0:eof_action=pass:format=auto:{enable}"), &out);
            cur = out;
        }
        let out = g.label("ov");
        g.add(&[&cur, &pa], &format!("overlay=x={}:y={}:eof_action=pass:format=auto:{enable}", spec.x, spec.y), &out);
        cur = out;
    }

    // 3) Decoración (textos, subtítulos, logos).
    if let Some(decor) = raster.and_then(|r| r.decor.as_ref()) {
        let k = inputs.add(vec!["-f".into(), "concat".into(), "-safe".into(), "0".into()], decor);
        let d = g.label("dec");
        g.add(&[&format!("{k}:v:0")], &format!("format=rgba,trim=start={}:duration={},setpts=PTS-STARTPTS", num(base), num(seq_dur + 1.0)), &d);
        let out = g.label("ov");
        g.add(&[&cur, &d], "overlay=format=auto", &out);
        cur = out;
    }
    Ok(cur)
}

/// Audio de los picture-in-picture con volumen (ya ubicado en la secuencia).
pub fn pip_audio(g: &mut Graph, inputs: &mut Inputs, p: &Project, base: f64, seq_dur: f64) -> Result<Vec<String>, AppError> {
    let mut out = vec![];
    for o in &p.overlays {
        let OverlayContent::Video(v) = &o.content else { continue };
        if v.volume <= 1e-6 || p.tracks.overlay(o.lane).hidden {
            continue;
        }
        let Some((s0, s1)) = visible_part(o.start, o.start + o.duration, base, seq_dur) else { continue };
        let media = p.media(&v.media_id).ok_or_else(|| AppError::new(ErrorKind::BadProject))?;
        if !media.has_audio {
            continue;
        }
        let (ss, dur, offset) = (v.in_point + (s0 - o.start), s1 - s0, s0 - base);
        let k = inputs.add(vec!["-ss".into(), num(ss), "-t".into(), num(dur)], &media.path);
        let mut chain = vec![
            "asetpts=PTS-STARTPTS".to_string(),
            "aresample=48000".to_string(),
            "aformat=sample_fmts=fltp:channel_layouts=stereo".to_string(),
            format!("volume={}", num(v.volume.min(2.0))),
        ];
        let delay = (offset * 1000.0).round() as i64;
        if delay > 0 {
            chain.push(format!("adelay=delays={delay}:all=1"));
        }
        let l = g.label("pip");
        g.add(&[&format!("{k}:a:0")], &chain.join(","), &l);
        out.push(l);
    }
    Ok(out)
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
    fn decor_layer_is_trimmed_to_the_window() {
        let p = crate::testutil::sample_project();
        let mut g = Graph::new();
        let mut inputs = Inputs::new();
        assert_eq!(apply_overlays(&mut g, &mut inputs, &p, None, "v", 0.0, 5.0).unwrap(), "v");
        let r = crate::compile::RasterInputs { decor: Some("/tmp/r/decor.ffconcat".into()), ..Default::default() };
        let out = apply_overlays(&mut g, &mut inputs, &p, Some(&r), "v", 2.5, 4.0).unwrap();
        assert_eq!(inputs.list[0], vec!["-f", "concat", "-safe", "0", "-i", "/tmp/r/decor.ffconcat"]);
        let f = g.build();
        assert!(f.contains("[0:v:0]format=rgba,trim=start=2.500000:duration=5.000000,setpts=PTS-STARTPTS[dec"), "{f}");
        assert!(f.contains("overlay=format=auto[") && f.ends_with(&format!("[{out}]")), "{f}");
    }

    fn with_overlay(content: OverlayContent, start: f64, duration: f64) -> Project {
        let mut p = crate::testutil::sample_project();
        p.overlays.push(Overlay { id: "o1".into(), start, duration, lane: 0, content });
        p
    }

    #[test]
    fn blur_uses_mask_alphamerge_and_needs_raster() {
        let rect = Rect { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
        let p = with_overlay(OverlayContent::Blur(BlurLayer { mode: BlurMode::Blur, strength: 0.5, rect, keys: vec![] }), 1.0, 2.0);
        let (mut g, mut inputs) = (Graph::new(), Inputs::new());
        // Sin máscaras no se exporta (no puede quedar una zona sin tapar).
        assert_eq!(apply_overlays(&mut g, &mut inputs, &p, None, "v", 0.0, 10.0).unwrap_err().kind, ErrorKind::BadProject);
        let mut r = crate::compile::RasterInputs::default();
        r.masks.insert("o1".into(), "/r/blur-o1.ffconcat".into());
        let (mut g, mut inputs) = (Graph::new(), Inputs::new());
        apply_overlays(&mut g, &mut inputs, &p, Some(&r), "v", 0.0, 10.0).unwrap();
        let f = g.build();
        let rad = blur_radius(0.5, p.canvas.height);
        assert!(f.contains(&format!("boxblur=luma_radius={rad}:luma_power=1")), "{f}");
        assert!(f.contains("alphamerge") && f.contains("format=gray"), "{f}");
        assert_eq!(inputs.list[0][..4], ["-f", "concat", "-safe", "0"]);
        // Pixelado.
        let p = with_overlay(OverlayContent::Blur(BlurLayer { mode: BlurMode::Pixelate, strength: 1.0, rect, keys: vec![] }), 1.0, 2.0);
        let (mut g, mut inputs) = (Graph::new(), Inputs::new());
        apply_overlays(&mut g, &mut inputs, &p, Some(&r), "v", 0.0, 10.0).unwrap();
        assert!(g.build().contains(&format!("pixelize=width={n}:height={n}:mode=avg", n = pixel_size(1.0, p.canvas.height))));
        // Fuera de la ventana exportada: nada.
        let (mut g, mut inputs) = (Graph::new(), Inputs::new());
        assert_eq!(apply_overlays(&mut g, &mut inputs, &p, Some(&r), "v", 5.0, 2.0).unwrap(), "v");
    }

    #[test]
    fn pip_is_cut_to_the_window_and_mixes_audio() {
        let mut p = with_overlay(
            OverlayContent::Video(PipLayer { media_id: "m1".into(), in_point: 2.0, x: 0.8, y: 0.8, width: 0.3, radius: 0.1, shadow: true, volume: 0.5, chroma: None }),
            1.0,
            4.0,
        );
        p.media[0].has_audio = true;
        let mut r = crate::compile::RasterInputs::default();
        r.pip.insert(
            "o1".into(),
            crate::compile::PipRaster { mask: "/r/pip-mask.png".into(), shadow: Some("/r/pip-shadow.png".into()), width: 384, height: 216, x: 800, y: 450, shadow_x: 0, shadow_y: 0 },
        );
        // Exportando el fragmento [3, 6): el PiP (1..5) se ve de 3 a 5, desde el segundo 4 del original.
        let (mut g, mut inputs) = (Graph::new(), Inputs::new());
        apply_overlays(&mut g, &mut inputs, &p, Some(&r), "v", 3.0, 3.0).unwrap();
        assert_eq!(inputs.list[0][..4], ["-ss", "4.000000", "-t", "2.000000"]);
        assert_eq!(inputs.list[1][..4], ["-loop", "1", "-t", "2.000000"]);
        let f = g.build();
        assert!(f.contains("scale=384:216:flags=lanczos") && f.contains("alphamerge,setpts=PTS+0.000000/TB"), "{f}");
        assert!(f.contains("overlay=x=800:y=450:eof_action=pass:format=auto:enable='between(t,0.000000,1.999900)'"), "{f}");
        let (mut g, mut inputs) = (Graph::new(), Inputs::new());
        let a = pip_audio(&mut g, &mut inputs, &p, 0.0, 10.0).unwrap();
        assert_eq!(a.len(), 1);
        let f = g.build();
        assert!(f.contains("volume=0.500000") && f.contains("adelay=delays=1000:all=1"), "{f}");
        // Sin volumen no se mezcla.
        if let Some(OverlayContent::Video(v)) = p.overlays.last_mut().map(|o| &mut o.content) {
            v.volume = 0.0;
        }
        assert!(pip_audio(&mut Graph::new(), &mut Inputs::new(), &p, 0.0, 10.0).unwrap().is_empty());
    }

    #[test]
    fn pip_chroma_multiplies_the_key_with_the_mask() {
        let mut p = with_overlay(
            OverlayContent::Video(PipLayer {
                media_id: "m1".into(),
                in_point: 0.0,
                x: 0.5,
                y: 0.5,
                width: 0.3,
                radius: 0.1,
                shadow: false,
                volume: 0.0,
                chroma: Some(ChromaKey { color: "#00b140".into(), similarity: 0.2, smoothness: 0.1, despill: 0.6 }),
            }),
            0.0,
            5.0,
        );
        let mut r = crate::compile::RasterInputs::default();
        r.pip.insert("o1".into(), crate::compile::PipRaster { mask: "/r/m.png".into(), shadow: None, width: 384, height: 216, x: 10, y: 10, shadow_x: 0, shadow_y: 0 });
        p.overlays[0].id = "o1".into();
        let (mut g, mut inputs) = (Graph::new(), Inputs::new());
        apply_overlays(&mut g, &mut inputs, &p, Some(&r), "v", 0.0, 5.0).unwrap();
        let s = g.build();
        assert!(s.contains("chromakey=color=0x00b140:similarity=0.2:blend=0.1,format=rgba,despill=type=green"), "{s}");
        assert!(s.contains("alphaextract") && s.contains("blend=all_mode=multiply"), "{s}");
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
