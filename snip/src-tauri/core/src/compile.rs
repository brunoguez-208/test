//! Motor de render: compila un [`Project`] a un `filter_complex` de FFmpeg.
//!
//! Reglas:
//! - Cada pasada de cada clip es un input propio con `-ss/-t` (seek por input,
//!   rápido y sin acumular cuadros en memoria como haría `split`).
//! - Cada clip se lleva al lienzo (escala lanczos + pad, fps, yuv420p) con su
//!   duración exacta, así `concat` y `xfade` reciben streams idénticos.
//! - El audio de cada clip siempre existe (silencio si no tiene o está
//!   silenciado), a 48 kHz estéreo y con la duración exacta del clip.
//! - Los clips con efectos pesados (invertir, boomerang, cámara lenta suave,
//!   estabilización, reducción de ruido) usan el intermedio ya procesado.
//!
//! Nada de esto arma strings con datos del usuario dentro de los filtros: solo
//! números. Las rutas van como argumentos separados.

use crate::encoder::Encoder;
use crate::error::{AppError, ErrorKind};
use crate::export::{is_fps_increase, FpsChoice};
use crate::filters;
use crate::graph::{Graph, Inputs};
use crate::heavy;
use crate::project::*;
use crate::scale::{plan_scale, Dims, ResolutionChoice};
use crate::sizing::BitratePlan;
use crate::timeline::{self, Span, EPS};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// Resultado de la etapa pesada de un clip (archivo ya procesado).
#[derive(Debug, Clone, PartialEq)]
pub struct Intermediate {
    pub path: String,
    pub duration: f64,
    pub has_audio: bool,
}

/// Capas rasterizadas por el frontend (texto, subtítulos, logos, máscaras).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RasterInputs {
    /// Lista ffconcat con la capa de "decoración" (texto, subtítulos, imágenes).
    pub decor: Option<String>,
    /// Máscaras de las zonas desenfocadas: id de la superposición → lista ffconcat.
    pub masks: HashMap<String, String>,
    /// Máscara (esquinas redondeadas) y sombra de cada PiP de video: id → (máscara, sombra).
    pub pip: HashMap<String, PipRaster>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PipRaster {
    pub mask: String,
    pub shadow: Option<String>,
    /// Tamaño del PiP en píxeles del lienzo.
    pub width: u32,
    pub height: u32,
    pub x: i64,
    pub y: i64,
    pub shadow_x: i64,
    pub shadow_y: i64,
}

pub struct CompileOptions<'a> {
    pub settings: &'a ExportSettings,
    /// Solo una parte del timeline (exportar fragmentos).
    pub window: Option<(f64, f64)>,
    pub encoder: Encoder,
    pub intermediates: &'a HashMap<String, Intermediate>,
    pub raster: Option<&'a RasterInputs>,
}

/// Comando compilado, listo para sumarle los argumentos de salida.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compiled {
    pub inputs: Vec<Vec<String>>,
    pub filter: String,
    pub video_out: Option<String>,
    pub audio_out: Option<String>,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub format: OutputFormat,
}

impl Compiled {
    pub fn input_args(&self) -> Vec<String> {
        self.inputs.iter().flatten().cloned().collect()
    }
}

use crate::graph::s;

/// Número con 6 decimales, sin "-0.000000".
pub fn num(v: f64) -> String {
    let v = if v.abs() < 5e-7 { 0.0 } else { v };
    format!("{v:.6}")
}

/// Cadena de `atempo` para cualquier velocidad (cada instancia admite 0.5..2).
pub fn atempo_chain(speed: f64) -> Vec<String> {
    let mut f = speed;
    let mut out = vec![];
    if (f - 1.0).abs() < 1e-6 {
        return out;
    }
    while f > 2.0 + 1e-9 {
        out.push(s("atempo=2"));
        f /= 2.0;
    }
    while f < 0.5 - 1e-9 {
        out.push(s("atempo=0.5"));
        f /= 0.5;
    }
    if (f - 1.0).abs() > 1e-6 {
        out.push(format!("atempo={}", trim_num(f)));
    }
    out
}

fn trim_num(v: f64) -> String {
    let t = format!("{v:.6}");
    let t = t.trim_end_matches('0').trim_end_matches('.');
    t.to_string()
}

/// Lleva un stream de video al lienzo: tamaño exacto (sin deformar), fps y duración.
pub fn normalize_video(canvas: &Canvas, duration: f64) -> String {
    let (w, h) = (canvas.width, canvas.height);
    format!(
        "scale=w={w}:h={h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,\
pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p,\
tpad=stop_mode=clone:stop_duration=1,trim=duration={d},setpts=PTS-STARTPTS",
        fps = canvas.fps_expr(),
        d = num(duration)
    )
}

/// Formato de audio común: 48 kHz estéreo y duración exacta.
pub fn normalize_audio(duration: f64) -> String {
    format!(
        "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur={d},atrim=duration={d},asetpts=PTS-STARTPTS",
        d = num(duration)
    )
}

fn silence(duration: f64) -> String {
    format!("anullsrc=r=48000:cl=stereo:d={}", num(duration))
}

/// Filtros de audio propios del clip (normalizar, volumen, fades), ya en el tiempo del timeline.
fn clip_audio_effects(a: &ClipAudio, duration: f64) -> Vec<String> {
    let mut f = vec![];
    if let Some(l) = &a.normalize {
        f.push(filters::loudnorm_linear(l));
    }
    f.push(s("aresample=48000"));
    if (a.volume - 1.0).abs() > 1e-6 {
        f.push(format!("volume={}", trim_num(a.volume)));
    }
    let fi = a.fade_in.min(duration);
    if fi > EPS {
        f.push(format!("afade=t=in:st=0:d={}", num(fi)));
    }
    let fo = a.fade_out.min(duration);
    if fo > EPS {
        f.push(format!("afade=t=out:st={}:d={}", num(duration - fo), num(fo)));
    }
    f
}

/// Tolerancia de seek: arrancamos un cuarto de cuadro antes para que el
/// redondeo de los timestamps nunca se coma el primer cuadro.
fn preroll(media: &MediaRef) -> f64 {
    0.25 / media.fps.max(1.0)
}

struct ClipOut {
    video: Option<String>,
    audio: Option<String>,
}

#[allow(clippy::too_many_arguments)]
fn compile_clip(
    g: &mut Graph,
    inputs: &mut Inputs,
    p: &Project,
    clip: &Clip,
    span: &Span,
    want_video: bool,
    want_audio: bool,
    inter: Option<&Intermediate>,
) -> Result<ClipOut, AppError> {
    let media = p
        .media(&clip.media_id)
        .ok_or_else(|| AppError::with_message(ErrorKind::BadProject, "Un clip usa un archivo que no está en el proyecto."))?;
    let d = span.duration;
    let mut out = ClipOut { video: None, audio: None };
    let audible = media.has_audio && !clip.audio.removed && !clip.audio.muted;

    if let Some(inter) = inter {
        // Clip ya procesado por la etapa pesada: el archivo es el clip entero.
        let k = inputs.add(vec![], &inter.path);
        if want_video {
            let v = g.label("v");
            let mut chain = vec![s("setpts=PTS-STARTPTS")];
            chain.extend(filters::clip_video_effects(&clip.video, media));
            chain.push(normalize_video(&p.canvas, d));
            chain.extend(filters::zoom_filters(&clip.video.zoom, &p.canvas));
            g.add(&[&format!("{k}:v:0")], &chain.join(","), &v);
            out.video = Some(v);
        }
        if want_audio {
            let a = g.label("a");
            if audible && inter.has_audio {
                let mut chain = vec![s("asetpts=PTS-STARTPTS")];
                chain.extend(clip_audio_effects(&clip.audio, d));
                chain.push(normalize_audio(d));
                g.add(&[&format!("{k}:a:0")], &chain.join(","), &a);
            } else {
                g.source(&silence(d), &a);
            }
            out.audio = Some(a);
        }
        return Ok(out);
    }

    if heavy::needs_heavy(clip) {
        return Err(AppError::with_message(ErrorKind::Unknown, "Falta procesar un clip con efectos pesados."));
    }

    let pre = preroll(media);
    match clip.kind {
        ClipKind::Freeze => {
            let ss = (clip.in_point - pre).max(0.0);
            let k = inputs.add(vec![s("-ss"), num(ss)], &media.path);
            if want_video {
                let v = g.label("v");
                let mut chain = vec![s("trim=end_frame=1"), s("setpts=PTS-STARTPTS")];
                chain.extend(filters::clip_video_effects(&clip.video, media));
                chain.push(format!("tpad=stop_mode=clone:stop_duration={}", num(d + 1.0)));
                chain.push(normalize_video(&p.canvas, d));
                chain.extend(filters::zoom_filters(&clip.video.zoom, &p.canvas));
                g.add(&[&format!("{k}:v:0")], &chain.join(","), &v);
                out.video = Some(v);
            }
            if want_audio {
                let a = g.label("a");
                g.source(&silence(d), &a);
                out.audio = Some(a);
            }
        }
        ClipKind::Video => {
            let passes = timeline::passes(clip) as usize;
            let len = (clip.out_point - clip.in_point).max(EPS);
            let ss = (clip.in_point - pre).max(0.0);
            let real_pre = clip.in_point - ss;
            let mut ks = vec![];
            for _ in 0..passes {
                // -t = largo exacto: con el preroll de ¼ de cuadro, el último cuadro
                // queda adentro y el siguiente afuera con ¼ de cuadro de margen.
                ks.push(inputs.add(vec![s("-ss"), num(ss), s("-t"), num(len)], &media.path));
            }
            if want_video {
                let speed_pts = if (clip.speed - 1.0).abs() > 1e-6 {
                    format!("setpts=(PTS-STARTPTS)/{}", trim_num(clip.speed))
                } else {
                    s("setpts=PTS-STARTPTS")
                };
                let mut parts = vec![];
                for &k in &ks {
                    let l = g.label("p");
                    g.add(&[&format!("{k}:v:0")], &speed_pts, &l);
                    parts.push(l);
                }
                let joined = if parts.len() > 1 {
                    let l = g.label("j");
                    let refs: Vec<&str> = parts.iter().map(String::as_str).collect();
                    g.add(&refs, &format!("concat=n={}:v=1:a=0", parts.len()), &l);
                    l
                } else {
                    parts.remove(0)
                };
                let v = g.label("v");
                let mut chain = filters::clip_video_effects(&clip.video, media);
                chain.push(normalize_video(&p.canvas, d));
                chain.extend(filters::zoom_filters(&clip.video.zoom, &p.canvas));
                g.add(&[&joined], &chain.join(","), &v);
                out.video = Some(v);
            }
            if want_audio {
                let a = g.label("a");
                if audible {
                    let mut tempo = vec![format!("atrim=start={}", num(real_pre)), s("asetpts=PTS-STARTPTS")];
                    tempo.extend(atempo_chain(clip.speed));
                    let mut parts = vec![];
                    let tracks = heavy::audio_tracks(media, clip.audio.track);
                    for &k in &ks {
                        let l = g.label("q");
                        let (ins, mix) = heavy::mix_inputs(k, &tracks);
                        let refs: Vec<&str> = ins.iter().map(String::as_str).collect();
                        let chain: Vec<String> = mix.into_iter().chain(tempo.iter().cloned()).collect();
                        g.add(&refs, &chain.join(","), &l);
                        parts.push(l);
                    }
                    let joined = if parts.len() > 1 {
                        let l = g.label("j");
                        let refs: Vec<&str> = parts.iter().map(String::as_str).collect();
                        g.add(&refs, &format!("concat=n={}:v=0:a=1", parts.len()), &l);
                        l
                    } else {
                        parts.remove(0)
                    };
                    let mut chain = clip_audio_effects(&clip.audio, d);
                    chain.push(normalize_audio(d));
                    g.add(&[&joined], &chain.join(","), &a);
                } else {
                    g.source(&silence(d), &a);
                }
                out.audio = Some(a);
            }
        }
    }
    Ok(out)
}

/// Clips que hay que incluir para un rango del timeline (con los vecinos que
/// participan de una transición en el borde). Devuelve (primero, último).
pub fn window_clips(spans: &[Span], ws: f64, we: f64) -> Option<(usize, usize)> {
    let hit: Vec<usize> = (0..spans.len()).filter(|&i| spans[i].end > ws + EPS && spans[i].start < we - EPS).collect();
    let (mut a, b) = (*hit.first()?, *hit.last()?);
    // Si el rango arranca dentro de la transición de entrada de `a`, hace falta el anterior.
    while a > 0 && ws < spans[a].start + spans[a].transition_in - EPS {
        a -= 1;
    }
    Some((a, b))
}

/// Tamaño y fps de salida según la configuración (valida confirmaciones).
pub fn output_geometry(p: &Project, st: &ExportSettings) -> Result<(u32, u32, f64, Option<String>), AppError> {
    let canvas = Dims::new(p.canvas.width, p.canvas.height);
    let scale = plan_scale(canvas, st.resolution);
    if scale.upscale && st.resolution != ResolutionChoice::Original && !st.allow_upscale {
        return Err(AppError::new(ErrorKind::UpscaleNotConfirmed));
    }
    let src_fps = p.canvas.fps();
    let fps = match st.fps.value() {
        Some(f) => {
            if is_fps_increase(f as f64, src_fps) && !st.allow_fps_increase {
                return Err(AppError::new(ErrorKind::FpsIncreaseNotConfirmed));
            }
            Some(f)
        }
        None => None,
    };
    let (out_fps, fps_filter) = match fps {
        Some(f) if (f as f64 - src_fps).abs() > 0.01 => (f as f64, Some(format!("fps={f}"))),
        _ => (src_fps, None),
    };
    Ok((scale.width, scale.height, out_fps, fps_filter))
}

/// ¿El proyecto tiene audio para exportar?
pub fn project_has_audio(p: &Project) -> bool {
    let clip_audio = p.clips.iter().any(|c| {
        c.kind == ClipKind::Video && !c.audio.removed && p.media(&c.media_id).is_some_and(|m| m.has_audio)
    });
    clip_audio || !p.music.is_empty()
}

/// Compila el proyecto completo (o un rango) a inputs + filter_complex.
pub fn compile(p: &Project, o: &CompileOptions) -> Result<Compiled, AppError> {
    if p.clips.is_empty() {
        return Err(AppError::with_message(ErrorKind::InvalidRange, "El proyecto está vacío: agregá al menos un video."));
    }
    let st = o.settings;
    let format = st.format;
    let spans = timeline::layout(&p.clips);
    let total = spans.last().map(|s| s.end).unwrap_or(0.0);
    let (ws, we) = o.window.unwrap_or((0.0, total));
    let (ws, we) = (ws.clamp(0.0, total), we.clamp(0.0, total));
    let min_len = 1.0 / p.canvas.fps().max(1.0);
    if we - ws < min_len * 0.5 {
        return Err(AppError::with_message(ErrorKind::InvalidRange, "El rango tiene que durar al menos un cuadro."));
    }
    let (a, b) = window_clips(&spans, ws, we).ok_or_else(|| AppError::new(ErrorKind::InvalidRange))?;
    let base = spans[a].start;
    let (lws, lwe) = (ws - base, we - base);
    let full = a == 0 && b == spans.len() - 1 && ws <= EPS && we >= total - EPS;

    let want_video = format.has_video();
    let want_audio = format.has_audio() && project_has_audio(p);
    if !want_video && !want_audio {
        return Err(AppError::with_message(ErrorKind::NoAudio, "El proyecto no tiene audio para exportar."));
    }
    let (out_w, out_h, out_fps, fps_filter) = if want_video {
        output_geometry(p, st)?
    } else {
        (0, 0, p.canvas.fps(), None)
    };

    let mut g = Graph::new();
    let mut inputs = Inputs::new();

    // 1) Clips
    let mut outs = vec![];
    for (c, span) in p.clips[a..=b].iter().zip(&spans[a..=b]) {
        let inter = o.intermediates.get(&c.id);
        outs.push(compile_clip(&mut g, &mut inputs, p, c, span, want_video, want_audio, inter)?);
    }

    // 2) Unir con concat / xfade
    let mut vacc = outs[0].video.clone();
    let mut aacc = outs[0].audio.clone();
    let mut acc_dur = spans[a].duration;
    for (j, i) in ((a + 1)..=b).enumerate() {
        let tr = spans[i].transition_in;
        let next = &outs[j + 1];
        if let (Some(v0), Some(v1)) = (&vacc, &next.video) {
            let l = g.label("x");
            if tr > 0.0 {
                let kind = p.clips[i].transition.map(|t| t.kind).unwrap_or(TransitionKind::Fade);
                g.add(
                    &[v0, v1],
                    &format!(
                        "xfade=transition={}:duration={}:offset={}",
                        kind.xfade_name(),
                        num(tr),
                        num(acc_dur - tr)
                    ),
                    &l,
                );
            } else {
                g.add(&[v0, v1], "concat=n=2:v=1:a=0", &l);
            }
            vacc = Some(l);
        }
        if let (Some(a0), Some(a1)) = (&aacc, &next.audio) {
            let l = g.label("y");
            if tr > 0.0 {
                g.add(&[a0, a1], &format!("acrossfade=d={}:c1=tri:c2=tri", num(tr)), &l);
            } else {
                g.add(&[a0, a1], "concat=n=2:v=0:a=1", &l);
            }
            aacc = Some(l);
        }
        acc_dur += spans[i].duration - tr;
    }
    let seq_dur = acc_dur;

    // 3) Superposiciones (texto, PiP, logos, desenfoque) sobre la secuencia.
    if let Some(v) = vacc.clone() {
        vacc = Some(filters::apply_overlays(&mut g, &mut inputs, p, o.raster, &v, base, seq_dur)?);
    }

    // 4) Música y audio de los PiP
    if want_audio {
        if let Some(main) = aacc.clone() {
            let mut mixed = mix_music(&mut g, &mut inputs, p, &main, base, seq_dur)?;
            let pips = filters::pip_audio(&mut g, &mut inputs, p, base, seq_dur)?;
            if !pips.is_empty() {
                let mut all = vec![mixed.clone()];
                all.extend(pips);
                let refs: Vec<&str> = all.iter().map(String::as_str).collect();
                let out = g.label("mix");
                g.add(&refs, &format!("amix=inputs={}:duration=first:normalize=0:dropout_transition=0,{}", all.len(), normalize_audio(seq_dur)), &out);
                mixed = out;
            }
            aacc = Some(mixed);
        }
    }

    // 5) Fundidos globales (solo si el rango incluye el principio / el final).
    let mut vpost = vec![];
    let mut apost = vec![];
    if a == 0 && p.fades.fade_in > EPS {
        let d = p.fades.fade_in.min(total);
        vpost.push(format!("fade=t=in:st=0:d={}:color=black", num(d)));
        apost.push(format!("afade=t=in:st=0:d={}", num(d)));
    }
    if b == spans.len() - 1 && p.fades.fade_out > EPS {
        let d = p.fades.fade_out.min(total);
        vpost.push(format!("fade=t=out:st={}:d={}:color=black", num(seq_dur - d), num(d)));
        apost.push(format!("afade=t=out:st={}:d={}", num(seq_dur - d), num(d)));
    }
    // 6) Recorte al rango pedido.
    let trim_needed = !full && (lws > EPS || lwe < seq_dur - EPS);
    if trim_needed {
        vpost.push(format!("trim=start={}:end={},setpts=PTS-STARTPTS", num(lws), num(lwe)));
        apost.push(format!("atrim=start={}:end={},asetpts=PTS-STARTPTS", num(lws), num(lwe)));
    }
    let duration = if trim_needed { lwe - lws } else { seq_dur };

    // 7) Salida: fps, tamaño y formato de píxel según el formato.
    let mut video_out = None;
    if let Some(v) = vacc {
        if let Some(f) = &fps_filter {
            vpost.push(f.clone());
        }
        match format {
            OutputFormat::Gif => {
                let gw = st.gif.width.clamp(64, out_w.max(64)) & !1;
                let gf = st.gif.fps.clamp(5, 50);
                vpost.push(format!("fps={gf},scale={gw}:-2:flags=lanczos"));
                let pre = g.label("g");
                let chain = if vpost.is_empty() { s("null") } else { vpost.join(",") };
                g.add(&[&v], &chain, &pre);
                let (s0, s1, pal, outl) = (g.label("gs"), g.label("gs"), g.label("pal"), g.label("vout"));
                g.add(&[&pre], "split", &format!("{s0}][{s1}"));
                g.add(&[&s0], "palettegen=stats_mode=diff:max_colors=256", &pal);
                g.add(&[&s1, &pal], "paletteuse=dither=sierra2_4a:diff_mode=rectangle", &outl);
                video_out = Some(outl);
            }
            _ => {
                if out_w != p.canvas.width || out_h != p.canvas.height {
                    vpost.push(format!("scale={out_w}:{out_h}:flags=lanczos"));
                }
                let pix = match format {
                    OutputFormat::Webm => "yuv420p",
                    _ => o.encoder.pix_fmt(),
                };
                vpost.push(format!("format={pix}"));
                let outl = g.label("vout");
                g.add(&[&v], &vpost.join(","), &outl);
                video_out = Some(outl);
            }
        }
    }
    let mut audio_out = None;
    if let Some(aa) = aacc {
        let outl = g.label("aout");
        let chain = if apost.is_empty() { s("anull") } else { apost.join(",") };
        g.add(&[&aa], &chain, &outl);
        audio_out = Some(outl);
    }

    let (w, h) = match format {
        OutputFormat::Gif => {
            let gw = st.gif.width.clamp(64, out_w.max(64)) & !1;
            let gh = ((out_h as f64 * gw as f64 / out_w.max(1) as f64 / 2.0).round() * 2.0) as u32;
            (gw, gh)
        }
        _ => (out_w, out_h),
    };
    let fps = match format {
        OutputFormat::Gif => st.gif.fps.clamp(5, 50) as f64,
        _ => out_fps,
    };
    Ok(Compiled { inputs: inputs.list, filter: g.build(), video_out, audio_out, duration, width: w, height: h, fps, format })
}

/// Mezcla la música con el audio principal (con ducking opcional).
fn mix_music(g: &mut Graph, inputs: &mut Inputs, p: &Project, main: &str, base: f64, seq_dur: f64) -> Result<String, AppError> {
    let mut tracks = vec![];
    let ducked: Vec<&MusicClip> = p.music.iter().filter(|m| m.ducking).collect();
    // El audio principal se reparte entre la mezcla y las entradas de sidechain.
    let mut main_mix = main.to_string();
    let mut sidechains = vec![];
    if !ducked.is_empty() {
        let mix_l = g.label("am");
        let mut outs = vec![mix_l.clone()];
        for _ in &ducked {
            outs.push(g.label("sc"));
        }
        g.add(&[main], &format!("asplit={}", outs.len()), &outs.join("]["));
        main_mix = mix_l;
        sidechains = outs[1..].to_vec();
    }
    let mut sc_iter = sidechains.into_iter();
    for m in &p.music {
        let media = p.media(&m.media_id).ok_or_else(|| AppError::new(ErrorKind::BadProject))?;
        if !media.has_audio {
            continue;
        }
        let len = (m.out_point - m.in_point).max(0.0);
        let local_start = m.start - base;
        // Parte visible dentro de la secuencia.
        let head_cut = (-local_start).max(0.0);
        let visible = (len - head_cut).min(seq_dur - local_start.max(0.0));
        if visible <= EPS {
            if m.ducking {
                // Igual hay que consumir la salida del asplit.
                if let Some(sc) = sc_iter.next() {
                    g.sink(&sc);
                }
            }
            continue;
        }
        let k = inputs.add(vec![s("-ss"), num(m.in_point + head_cut), s("-t"), num(visible)], &media.path);
        let mut chain = vec![s("asetpts=PTS-STARTPTS"), s("aresample=48000"), s("aformat=sample_fmts=fltp:channel_layouts=stereo")];
        if (m.volume - 1.0).abs() > 1e-6 {
            chain.push(format!("volume={}", trim_num(m.volume)));
        }
        // Los fades son del clip de música completo (antes del recorte por el rango).
        if m.fade_in > EPS && head_cut < m.fade_in {
            chain.push(format!("afade=t=in:st={}:d={}", num(-head_cut), num(m.fade_in)));
        }
        if m.fade_out > EPS {
            let st = len - m.fade_out - head_cut;
            chain.push(format!("afade=t=out:st={}:d={}", num(st.max(0.0)), num(m.fade_out.min(len))));
        }
        let delay_ms = (local_start.max(0.0) * 1000.0).round() as i64;
        if delay_ms > 0 {
            chain.push(format!("adelay=delays={delay_ms}:all=1"));
        }
        let l = g.label("mu");
        g.add(&[&format!("{k}:a:0")], &chain.join(","), &l);
        if m.ducking {
            let sc = sc_iter.next().unwrap_or_default();
            let d = g.label("md");
            g.add(&[&l, &sc], "sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400:makeup=1:level_sc=1", &d);
            tracks.push(d);
        } else {
            tracks.push(l);
        }
    }
    // Las salidas de sidechain que sobran se descartan.
    for sc in sc_iter {
        g.sink(&sc);
    }
    if tracks.is_empty() {
        return Ok(main_mix);
    }
    let mut all = vec![main_mix];
    all.extend(tracks);
    let refs: Vec<&str> = all.iter().map(String::as_str).collect();
    let out = g.label("mix");
    g.add(
        &refs,
        &format!("amix=inputs={}:duration=first:normalize=0:dropout_transition=0,{}", all.len(), normalize_audio(seq_dur)),
        &out,
    );
    Ok(out)
}

// --------------------------------- Salida -------------------------------------

/// Pasada de un encode de 2 pasadas.
#[derive(Debug, Clone, PartialEq)]
pub enum Pass {
    Single,
    First { log: String },
    Second { log: String },
}

/// Bitrate de audio por defecto (calidad máxima).
pub const AUDIO_KBPS_DEFAULT: u32 = 320;

/// Argumentos de codificación y salida.
pub fn output_args(c: &Compiled, encoder: Encoder, bitrate: Option<&BitratePlan>, pass: &Pass, out: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec![];
    a.extend([s("-filter_complex"), c.filter.clone()]);
    let first_pass = matches!(pass, Pass::First { .. });
    if let Some(v) = &c.video_out {
        a.extend([s("-map"), format!("[{v}]")]);
    }
    if let Some(au) = &c.audio_out {
        // En la primera pasada el audio igual hay que mapearlo (todas las salidas del
        // grafo tienen que estar conectadas); va a null como PCM, que no cuesta nada.
        a.extend([s("-map"), format!("[{au}]")]);
    }
    match c.format {
        OutputFormat::Mp4 | OutputFormat::Mov | OutputFormat::Mkv => {
            a.extend(h264_args(encoder, bitrate, pass));
            if !first_pass && c.audio_out.is_some() {
                let kbps = bitrate.map(|b| b.audio_kbps).unwrap_or(AUDIO_KBPS_DEFAULT);
                a.extend([s("-c:a"), s("aac"), s("-b:a"), format!("{kbps}k")]);
            }
        }
        OutputFormat::Webm => {
            a.extend([s("-c:v"), s("libvpx-vp9"), s("-row-mt"), s("1"), s("-deadline"), s("good"), s("-cpu-used"), s("2")]);
            match bitrate {
                Some(b) => a.extend([s("-b:v"), format!("{}k", b.video_kbps)]),
                None => a.extend([s("-crf"), s("28"), s("-b:v"), s("0")]),
            }
            a.extend(pass_args(pass));
            if !first_pass && c.audio_out.is_some() {
                let kbps = bitrate.map(|b| b.audio_kbps).unwrap_or(192).min(256);
                a.extend([s("-c:a"), s("libopus"), s("-b:a"), format!("{kbps}k")]);
            }
        }
        OutputFormat::Gif => {
            a.extend([s("-c:v"), s("gif"), s("-loop"), s("0")]);
        }
        OutputFormat::Mp3 => {
            let kbps = bitrate.map(|b| b.audio_kbps).unwrap_or(AUDIO_KBPS_DEFAULT);
            a.extend([s("-c:a"), s("libmp3lame"), s("-b:a"), format!("{kbps}k")]);
        }
    }
    if first_pass && c.audio_out.is_some() {
        a.extend([s("-c:a"), s("pcm_s16le")]);
    }
    a.extend([s("-map_metadata"), s("-1")]);
    if matches!(c.format, OutputFormat::Mp4 | OutputFormat::Mov) && !first_pass {
        a.extend([s("-movflags"), s("+faststart")]);
    }
    a.extend([s("-progress"), s("pipe:1"), s("-stats_period"), s("0.25"), s("-nostats")]);
    if first_pass {
        a.extend([s("-f"), s("null"), s(if cfg!(windows) { "NUL" } else { "/dev/null" })]);
    } else {
        a.extend([s("-f"), s(c.format.muxer()), out.to_string_lossy().into_owned()]);
    }
    a
}

fn pass_args(pass: &Pass) -> Vec<String> {
    match pass {
        Pass::Single => vec![],
        Pass::First { log } => vec![s("-pass"), s("1"), s("-passlogfile"), log.clone()],
        Pass::Second { log } => vec![s("-pass"), s("2"), s("-passlogfile"), log.clone()],
    }
}

/// H.264: calidad máxima (como Snip 1.x) o bitrate fijo para un tamaño objetivo.
pub fn h264_args(encoder: Encoder, bitrate: Option<&BitratePlan>, pass: &Pass) -> Vec<String> {
    let Some(b) = bitrate else {
        return encoder.quality_args();
    };
    let v = b.video_kbps;
    let mut a: Vec<String> = match encoder {
        Encoder::Nvenc => vec![
            s("-c:v"),
            s("h264_nvenc"),
            s("-preset"),
            s("p7"),
            s("-tune"),
            s("hq"),
            s("-rc"),
            s("vbr"),
            s("-multipass"),
            s("fullres"),
            s("-b:v"),
            format!("{v}k"),
            s("-maxrate"),
            format!("{}k", v * 3 / 2),
            s("-bufsize"),
            format!("{}k", v * 2),
            s("-profile:v"),
            s("high"),
        ],
        Encoder::Qsv => vec![
            s("-c:v"),
            s("h264_qsv"),
            s("-preset"),
            s("veryslow"),
            s("-b:v"),
            format!("{v}k"),
            s("-maxrate"),
            format!("{}k", v * 3 / 2),
            s("-profile:v"),
            s("high"),
        ],
        Encoder::Amf => vec![
            s("-c:v"),
            s("h264_amf"),
            s("-usage"),
            s("transcoding"),
            s("-quality"),
            s("quality"),
            s("-rc"),
            s("vbr_peak"),
            s("-b:v"),
            format!("{v}k"),
            s("-maxrate"),
            format!("{}k", v * 3 / 2),
            s("-profile:v"),
            s("high"),
        ],
        Encoder::Libx264 => vec![s("-c:v"), s("libx264"), s("-preset"), s("slow"), s("-b:v"), format!("{v}k"), s("-profile:v"), s("high")],
    };
    if encoder == Encoder::Libx264 {
        a.extend(pass_args(pass));
    }
    a
}

/// ¿Este encode usa 2 pasadas? (x264 o VP9 con tamaño objetivo).
pub fn uses_two_pass(format: OutputFormat, encoder: Encoder, bitrate: Option<&BitratePlan>) -> bool {
    bitrate.is_some()
        && match format {
            OutputFormat::Webm => true,
            OutputFormat::Mp4 | OutputFormat::Mov | OutputFormat::Mkv => encoder == Encoder::Libx264,
            _ => false,
        }
}

/// fps elegidos sin confirmar → se usa en la UI para avisar.
pub fn fps_choice_value(c: FpsChoice) -> Option<u32> {
    c.value()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;
    use std::path::PathBuf;

    fn opts<'a>(st: &'a ExportSettings, inter: &'a HashMap<String, Intermediate>) -> CompileOptions<'a> {
        CompileOptions { settings: st, window: None, encoder: Encoder::Libx264, intermediates: inter, raster: None }
    }

    fn base() -> Project {
        project_with(vec![media("m1", "C:\\v\\a.mp4", 20.0, 1920, 1080, 30, true)], vec![clip("c1", 2.0, 6.0)])
    }

    fn run(p: &Project) -> Compiled {
        let st = p.export.clone();
        let inter = HashMap::new();
        compile(p, &opts(&st, &inter)).unwrap()
    }

    #[test]
    fn single_clip_is_seeked_by_input_and_normalized() {
        let c = run(&base());
        assert_eq!(c.inputs.len(), 1);
        let i = c.inputs[0].join(" ");
        assert!(i.starts_with("-ss 1.991667 -t 4.000000 -i C:\\v\\a.mp4"), "{i}");
        assert!(c.filter.contains("setpts=PTS-STARTPTS"));
        assert!(c.filter.contains("scale=w=1920:h=1080:force_original_aspect_ratio=decrease"));
        assert!(c.filter.contains("pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black"));
        assert!(c.filter.contains("fps=30,format=yuv420p"));
        assert!(c.filter.contains("trim=duration=4.000000"));
        assert!(c.filter.contains("atrim=start=0.008333"), "{}", c.filter);
        assert!((c.duration - 4.0).abs() < 1e-9);
        assert_eq!((c.width, c.height), (1920, 1080));
        assert!(c.video_out.is_some() && c.audio_out.is_some());
    }

    #[test]
    fn multiple_clips_are_concatenated_in_order() {
        let mut p = base();
        p.media.push(media("m2", "C:\\v\\b.mkv", 10.0, 1280, 720, 60, false));
        p.clips.push(Clip { media_id: "m2".into(), ..clip("c2", 0.0, 3.0) });
        p.clips.push(clip("c3", 10.0, 12.0));
        let c = run(&p);
        assert_eq!(c.inputs.len(), 3);
        assert!(c.inputs[1].join(" ").ends_with("-i C:\\v\\b.mkv"));
        assert_eq!(c.filter.matches("concat=n=2:v=1:a=0").count(), 2);
        assert_eq!(c.filter.matches("concat=n=2:v=0:a=1").count(), 2);
        // El clip sin audio aporta silencio de la duración exacta.
        assert!(c.filter.contains("anullsrc=r=48000:cl=stereo:d=3.000000"), "{}", c.filter);
        // El clip 720p60 se lleva al lienzo 1080p30.
        assert_eq!(c.filter.matches("fps=30,format=yuv420p").count(), 3);
        assert!((c.duration - 9.0).abs() < 1e-9);
    }

    #[test]
    fn transitions_use_xfade_with_running_offset() {
        let mut p = base();
        p.clips.push(clip("c2", 8.0, 12.0));
        p.clips.push(clip("c3", 12.0, 15.0));
        p.clips[1].transition = Some(Transition { kind: TransitionKind::SlideLeft, duration: 1.0 });
        p.clips[2].transition = Some(Transition { kind: TransitionKind::FadeBlack, duration: 0.5 });
        let c = run(&p);
        assert!(c.filter.contains("xfade=transition=slideleft:duration=1.000000:offset=3.000000"), "{}", c.filter);
        // offset del segundo = (4 + 4 - 1) - 0.5
        assert!(c.filter.contains("xfade=transition=fadeblack:duration=0.500000:offset=6.500000"), "{}", c.filter);
        assert!(c.filter.contains("acrossfade=d=1.000000:c1=tri:c2=tri"));
        assert!(c.filter.contains("acrossfade=d=0.500000"));
        assert!((c.duration - 9.5).abs() < 1e-9);
    }

    #[test]
    fn speed_changes_video_pts_and_uses_atempo_chain() {
        let mut p = base();
        p.clips[0].speed = 0.25;
        let c = run(&p);
        assert!(c.filter.contains("setpts=(PTS-STARTPTS)/0.25"), "{}", c.filter);
        assert!(c.filter.contains("atempo=0.5,atempo=0.5"), "{}", c.filter);
        assert!((c.duration - 16.0).abs() < 1e-9);
        assert_eq!(atempo_chain(4.0), vec!["atempo=2", "atempo=2"]);
        assert_eq!(atempo_chain(3.0), vec!["atempo=2", "atempo=1.5"]);
        assert_eq!(atempo_chain(0.3), vec!["atempo=0.5", "atempo=0.6"]);
        assert!(atempo_chain(1.0).is_empty());
    }

    #[test]
    fn plain_loop_uses_one_input_per_pass() {
        let mut p = base();
        p.clips[0].loop_mode = LoopMode::Loop;
        p.clips[0].loop_count = 3;
        let c = run(&p);
        assert_eq!(c.inputs.len(), 3);
        assert!(c.filter.contains("concat=n=3:v=1:a=0"));
        assert!(c.filter.contains("concat=n=3:v=0:a=1"));
        assert!((c.duration - 12.0).abs() < 1e-9);
    }

    #[test]
    fn freeze_frame_clones_one_frame() {
        let mut p = base();
        let mut f = clip("f", 3.0, 3.0);
        f.kind = ClipKind::Freeze;
        f.freeze_duration = 2.0;
        p.clips.push(f);
        let c = run(&p);
        assert!(c.inputs[1].join(" ").starts_with("-ss 2.991667 -i"), "{:?}", c.inputs[1]);
        assert!(c.filter.contains("trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3.000000"), "{}", c.filter);
        assert!(c.filter.contains("anullsrc=r=48000:cl=stereo:d=2.000000"));
        assert!((c.duration - 6.0).abs() < 1e-9);
    }

    #[test]
    fn heavy_clips_need_their_intermediate() {
        let mut p = base();
        p.clips[0].reverse = true;
        let st = p.export.clone();
        let none = HashMap::new();
        assert!(compile(&p, &opts(&st, &none)).is_err());
        let mut inter = HashMap::new();
        inter.insert("c1".to_string(), Intermediate { path: "C:\\cache\\c1.mp4".into(), duration: 4.0, has_audio: true });
        let c = compile(&p, &opts(&st, &inter)).unwrap();
        assert_eq!(c.inputs[0], vec!["-i", "C:\\cache\\c1.mp4"]);
        assert!(!c.filter.contains("reverse"), "la inversión ya está en el intermedio");
        assert!(c.filter.contains("[0:a:0]asetpts=PTS-STARTPTS"));
    }

    #[test]
    fn audio_options_per_clip() {
        let mut p = base();
        p.clips[0].audio.volume = 1.5;
        p.clips[0].audio.fade_in = 0.5;
        p.clips[0].audio.fade_out = 1.0;
        p.clips[0].audio.normalize =
            Some(Loudness { input_i: -24.0, input_tp: -3.0, input_lra: 6.0, input_thresh: -34.5, target_offset: 0.3 });
        let c = run(&p);
        assert!(c.filter.contains("volume=1.5"));
        assert!(c.filter.contains("afade=t=in:st=0:d=0.500000"));
        assert!(c.filter.contains("afade=t=out:st=3.000000:d=1.000000"));
        assert!(c.filter.contains("loudnorm=I=-14:TP=-1:LRA=11:measured_I=-24"), "{}", c.filter);
        assert!(c.filter.contains("linear=true"));

        p.clips[0].audio.muted = true;
        let c = run(&p);
        assert!(c.filter.contains("anullsrc"), "silenciado = silencio");
        assert!(c.audio_out.is_some());

        p.clips[0].audio.removed = true;
        let c = run(&p);
        assert!(c.audio_out.is_none(), "sin audio en ningún clip ni música: sin pista de audio");
        assert!(!project_has_audio(&p));
    }

    #[test]
    fn music_is_mixed_with_fades_delay_and_ducking() {
        let mut p = base();
        p.media.push(MediaRef { kind: MediaKind::Audio, ..media("m3", "C:\\m\\tema.mp3", 200.0, 0, 0, 0, true) });
        p.music.push(MusicClip {
            id: "mu".into(),
            media_id: "m3".into(),
            start: 1.0,
            in_point: 30.0,
            out_point: 60.0,
            volume: 0.5,
            fade_in: 1.0,
            fade_out: 2.0,
            ducking: true,
        });
        let c = run(&p);
        let last = c.inputs.last().unwrap().join(" ");
        // La secuencia dura 4 s y la música entra en el segundo 1: solo 3 s útiles.
        assert!(last.starts_with("-ss 30.000000 -t 3.000000 -i C:\\m\\tema.mp3"), "{last}");
        assert!(c.filter.contains("adelay=delays=1000:all=1"));
        assert!(c.filter.contains("volume=0.5"));
        assert!(c.filter.contains("afade=t=out:st=28.000000:d=2.000000"));
        assert!(c.filter.contains("asplit=2"));
        assert!(c.filter.contains("sidechaincompress"));
        assert!(c.filter.contains("amix=inputs=2:duration=first:normalize=0"));
    }

    #[test]
    fn global_fades_and_output_scaling() {
        let mut p = base();
        p.fades = Fades { fade_in: 0.5, fade_out: 1.0 };
        p.export.resolution = ResolutionChoice::P720;
        p.export.fps = FpsChoice::Fps24;
        let c = run(&p);
        assert!(c.filter.contains("fade=t=in:st=0:d=0.500000:color=black"));
        assert!(c.filter.contains("fade=t=out:st=3.000000:d=1.000000:color=black"));
        assert!(c.filter.contains("afade=t=in:st=0:d=0.500000"));
        assert!(c.filter.contains("fps=24,scale=1280:720:flags=lanczos,format=yuv420p"), "{}", c.filter);
        assert_eq!((c.width, c.height, c.fps), (1280, 720, 24.0));
    }

    #[test]
    fn confirmations_are_enforced() {
        let mut p = base();
        p.export.resolution = ResolutionChoice::P2160;
        let st = p.export.clone();
        let inter = HashMap::new();
        assert_eq!(compile(&p, &opts(&st, &inter)).unwrap_err().kind, ErrorKind::UpscaleNotConfirmed);
        p.export.resolution = ResolutionChoice::Original;
        p.export.fps = FpsChoice::Fps60;
        let st = p.export.clone();
        assert_eq!(compile(&p, &opts(&st, &inter)).unwrap_err().kind, ErrorKind::FpsIncreaseNotConfirmed);
    }

    #[test]
    fn window_exports_only_the_needed_clips() {
        let mut p = base(); // 0..4
        p.clips.push(clip("c2", 10.0, 14.0)); // 4..8
        p.clips.push(clip("c3", 14.0, 18.0)); // 8..12
        p.fades = Fades { fade_in: 1.0, fade_out: 1.0 };
        let st = p.export.clone();
        let inter = HashMap::new();
        let mut o = opts(&st, &inter);
        o.window = Some((5.0, 7.0));
        let c = compile(&p, &o).unwrap();
        assert_eq!(c.inputs.len(), 1, "solo el clip del medio");
        assert!(c.filter.contains("trim=start=1.000000:end=3.000000"), "{}", c.filter);
        assert!(!c.filter.contains("fade=t=in"), "el fundido inicial no aplica a un fragmento del medio");
        assert!((c.duration - 2.0).abs() < 1e-9);

        // Arranca dentro de una transición: entra también el clip anterior.
        p.clips[1].transition = Some(Transition { kind: TransitionKind::Fade, duration: 1.0 });
        let spans = timeline::layout(&p.clips);
        assert_eq!(window_clips(&spans, 3.2, 5.0), Some((0, 1)));
        assert_eq!(window_clips(&spans, 4.5, 5.0), Some((1, 1)));
        assert_eq!(window_clips(&spans, 0.0, 100.0), Some((0, 2)));
    }

    #[test]
    fn gif_and_mp3_outputs() {
        let mut p = base();
        p.export.format = OutputFormat::Gif;
        p.export.gif = GifSettings { fps: 12, width: 640 };
        let c = run(&p);
        assert!(c.filter.contains("fps=12,scale=640:-2:flags=lanczos"));
        assert!(c.filter.contains("palettegen=stats_mode=diff"));
        assert!(c.filter.contains("paletteuse=dither=sierra2_4a"));
        assert!(c.audio_out.is_none());
        assert_eq!((c.width, c.height), (640, 360));
        let a = output_args(&c, Encoder::Libx264, None, &Pass::Single, &PathBuf::from("o.gif")).join(" ");
        assert!(a.contains("-c:v gif -loop 0"));
        assert!(a.ends_with("-f gif o.gif"));

        p.export.format = OutputFormat::Mp3;
        let c = run(&p);
        assert!(c.video_out.is_none());
        assert!(!c.filter.contains("scale="), "MP3: no se procesa el video");
        let a = output_args(&c, Encoder::Libx264, None, &Pass::Single, &PathBuf::from("o.mp3")).join(" ");
        assert!(a.contains("-c:a libmp3lame -b:a 320k"));
        assert!(a.ends_with("-f mp3 o.mp3"));
    }

    #[test]
    fn output_args_per_format_and_encoder() {
        let mut p = base();
        let c = run(&p);
        let a = output_args(&c, Encoder::Nvenc, None, &Pass::Single, &PathBuf::from("o.mp4")).join(" ");
        assert!(a.contains("-c:v h264_nvenc -preset p7 -tune hq -rc vbr -cq 18 -b:v 0"));
        assert!(a.contains("-c:a aac -b:a 320k"));
        assert!(a.contains("-movflags +faststart"));
        assert!(a.ends_with("-f mp4 o.mp4"));

        p.export.format = OutputFormat::Mkv;
        let c = run(&p);
        let a = output_args(&c, Encoder::Libx264, None, &Pass::Single, &PathBuf::from("o.mkv")).join(" ");
        assert!(a.contains("-c:v libx264 -crf 17"));
        assert!(!a.contains("faststart"));
        assert!(a.ends_with("-f matroska o.mkv"));

        p.export.format = OutputFormat::Webm;
        let c = run(&p);
        let a = output_args(&c, Encoder::Nvenc, None, &Pass::Single, &PathBuf::from("o.webm")).join(" ");
        assert!(a.contains("-c:v libvpx-vp9"));
        assert!(a.contains("-c:a libopus"));
        assert!(c.filter.contains("format=yuv420p[vout"));

        p.export.format = OutputFormat::Mov;
        let st = p.export.clone();
        let inter = HashMap::new();
        let mut o = opts(&st, &inter);
        o.encoder = Encoder::Qsv;
        let c = compile(&p, &o).unwrap();
        let a = output_args(&c, Encoder::Qsv, None, &Pass::Single, &PathBuf::from("o.mov")).join(" ");
        assert!(a.contains("h264_qsv") && a.contains("-f mov o.mov"));
        assert!(c.filter.contains("format=nv12[vout"));
    }

    #[test]
    fn size_target_args_and_two_pass() {
        let p = base();
        let c = run(&p);
        let b = BitratePlan { video_kbps: 2000, audio_kbps: 128, low_quality: false, suggestion: None };
        let a = output_args(&c, Encoder::Nvenc, Some(&b), &Pass::Single, &PathBuf::from("o.mp4")).join(" ");
        assert!(a.contains("-rc vbr -multipass fullres -b:v 2000k -maxrate 3000k -bufsize 4000k"), "{a}");
        assert!(a.contains("-b:a 128k"));
        assert!(!uses_two_pass(OutputFormat::Mp4, Encoder::Nvenc, Some(&b)));
        assert!(uses_two_pass(OutputFormat::Mp4, Encoder::Libx264, Some(&b)));
        assert!(uses_two_pass(OutputFormat::Webm, Encoder::Nvenc, Some(&b)));
        let first = output_args(&c, Encoder::Libx264, Some(&b), &Pass::First { log: "L".into() }, &PathBuf::from("o.mp4")).join(" ");
        assert!(first.contains("-pass 1 -passlogfile L"));
        assert!(first.contains("-c:a pcm_s16le"));
        assert!(!first.contains("-c:a aac"));
        assert!(first.contains("-f null"));
        let second = output_args(&c, Encoder::Libx264, Some(&b), &Pass::Second { log: "L".into() }, &PathBuf::from("o.mp4")).join(" ");
        assert!(second.contains("-pass 2 -passlogfile L"));
        assert!(second.contains("-c:a aac -b:a 128k"));
    }

    #[test]
    fn empty_project_is_a_clear_error() {
        let mut p = base();
        p.clips.clear();
        let st = p.export.clone();
        let inter = HashMap::new();
        let e = compile(&p, &opts(&st, &inter)).unwrap_err();
        assert!(e.message.contains("vacío"));
    }

    #[test]
    fn shadowplay_media_mixes_tracks_and_tonemaps_before_any_encoder() {
        let mut p = base();
        p.media[0].audio_tracks = 2;
        p.media[0].transfer = Some("smpte2084".into());
        let st = p.export.clone();
        let none = HashMap::new();
        for enc in crate::encoder::PREFERENCE {
            let c = compile(&p, &CompileOptions { encoder: enc, ..opts(&st, &none) }).unwrap();
            assert!(c.filter.contains("[0:a:0][0:a:1]amix=inputs=2:duration=longest:normalize=0,atrim="), "{}", c.filter);
            assert!(c.filter.contains("zscale=tin=smpte2084"), "{}", c.filter);
            // Siempre 8 bits 4:2:0 antes del encoder.
            assert!(c.filter.contains(&format!("format={}", enc.pix_fmt())));
        }
        // Una pista elegida: solo esa, sin amix.
        p.clips[0].audio.track = Some(1);
        let c = compile(&p, &opts(&st, &none)).unwrap();
        assert!(c.filter.contains("[0:a:1]atrim=") && !c.filter.contains("amix=inputs=2:duration=longest"), "{}", c.filter);
    }
}