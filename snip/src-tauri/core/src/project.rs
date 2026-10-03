//! Modelo de proyecto de Snip (edición no destructiva).
//!
//! Todo lo que el usuario hace se guarda acá: medios, clips de la pista principal,
//! superposiciones, música, marcadores, rangos, subtítulos y estado de la vista.
//! El video original nunca se modifica. El modelo se serializa a JSON con
//! `"version"` y se migra con [`crate::migrate`].
//!
//! El frontend tiene un espejo exacto en `src/project/model.ts`.

use crate::export::FpsChoice;
use crate::scale::ResolutionChoice;
use serde::{Deserialize, Serialize};

/// Versión actual del formato del proyecto.
pub const PROJECT_VERSION: u32 = 1;

/// Velocidad mínima y máxima por clip.
pub const MIN_SPEED: f64 = 0.25;
pub const MAX_SPEED: f64 = 4.0;
pub const MAX_LOOP_COUNT: u32 = 20;
pub const MAX_CLIP_VOLUME: f64 = 2.0;

fn one() -> f64 {
    1.0
}
fn one_u32() -> u32 {
    1
}
fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    /// Cuándo se exportó por última vez (los exportados no aparecen en "sin terminar").
    #[serde(default)]
    pub exported_at: Option<u64>,
    #[serde(default)]
    pub media: Vec<MediaRef>,
    /// Pista principal: clips contiguos (magnética).
    #[serde(default)]
    pub clips: Vec<Clip>,
    #[serde(default)]
    pub overlays: Vec<Overlay>,
    #[serde(default)]
    pub music: Vec<MusicClip>,
    #[serde(default)]
    pub markers: Vec<Marker>,
    /// Rangos marcados para exportar como archivos separados.
    #[serde(default)]
    pub ranges: Vec<TimeRange>,
    #[serde(default)]
    pub subtitles: Subtitles,
    #[serde(default)]
    pub fades: Fades,
    pub canvas: Canvas,
    #[serde(default)]
    pub view: ViewState,
    #[serde(default)]
    pub export: ExportSettings,
    /// Grupos (Ctrl+G): ids que se seleccionan, mueven, copian y borran juntos.
    #[serde(default)]
    pub groups: Vec<Vec<String>>,
    #[serde(default)]
    pub tracks: Tracks,
}

impl Project {
    pub fn media(&self, id: &str) -> Option<&MediaRef> {
        self.media.iter().find(|m| m.id == id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

/// Un archivo usado por el proyecto, con los metadatos que se leyeron al agregarlo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRef {
    pub id: String,
    pub path: String,
    pub kind: MediaKind,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default = "default_fps")]
    pub fps: f64,
    #[serde(default)]
    pub fps_num: u32,
    #[serde(default = "one_u32")]
    pub fps_den: u32,
    #[serde(default)]
    pub has_audio: bool,
    #[serde(default)]
    pub video_codec: Option<String>,
    #[serde(default)]
    pub audio_codec: Option<String>,
    #[serde(default)]
    pub rotation: u32,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    /// Pistas de audio del archivo (0 = desconocido; se trata como 1 si hay audio).
    #[serde(default)]
    pub audio_tracks: u32,
    /// Transferencia HDR ("smpte2084" = PQ, "arib-std-b67" = HLG): se lleva a SDR al exportar.
    #[serde(default)]
    pub transfer: Option<String>,
}

impl MediaRef {
    /// Pistas de audio que hay que mezclar (mínimo 1 si tiene audio).
    pub fn audio_track_count(&self) -> u32 {
        if !self.has_audio { 0 } else { self.audio_tracks.max(1) }
    }

    /// Un medio vacío (para tests y armar filtros sueltos).
    pub fn placeholder() -> Self {
        Self {
            id: String::new(),
            path: String::new(),
            kind: MediaKind::Video,
            duration: 0.0,
            width: 0,
            height: 0,
            fps: 30.0,
            fps_num: 30,
            fps_den: 1,
            has_audio: false,
            video_codec: None,
            audio_codec: None,
            rotation: 0,
            size_bytes: None,
            audio_tracks: 0,
            transfer: None,
        }
    }

    pub fn is_hdr(&self) -> bool {
        matches!(self.transfer.as_deref(), Some("smpte2084" | "arib-std-b67"))
    }
}

fn default_fps() -> f64 {
    30.0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ClipKind {
    #[default]
    Video,
    /// Un cuadro congelado (`in_point`) durante `freeze_duration` segundos.
    Freeze,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LoopMode {
    #[default]
    None,
    /// Repite el clip `loop_count` veces.
    Loop,
    /// Ida y vuelta, `loop_count` veces.
    Boomerang,
}

/// Clip de la pista principal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub media_id: String,
    #[serde(default)]
    pub kind: ClipKind,
    /// Segundo del original donde empieza (en un clip congelado: el cuadro).
    pub in_point: f64,
    /// Segundo del original donde termina (exclusivo).
    pub out_point: f64,
    #[serde(default = "one")]
    pub speed: f64,
    /// Cámara lenta con cuadros interpolados (minterpolate). Solo con speed < 1.
    #[serde(default)]
    pub smooth_slowmo: bool,
    #[serde(default)]
    pub reverse: bool,
    #[serde(default)]
    pub loop_mode: LoopMode,
    #[serde(default = "one_u32")]
    pub loop_count: u32,
    #[serde(default)]
    pub freeze_duration: f64,
    #[serde(default)]
    pub audio: ClipAudio,
    #[serde(default)]
    pub video: ClipVideo,
    /// Transición que entra a este clip desde el anterior.
    #[serde(default)]
    pub transition: Option<Transition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipAudio {
    /// 0..=2 (1 = original).
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub muted: bool,
    /// Quitar el audio por completo.
    #[serde(default)]
    pub removed: bool,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    /// Normalizar (loudnorm) con las medidas del análisis previo.
    #[serde(default)]
    pub normalize: Option<Loudness>,
    /// Reducción de ruido (afftdn).
    #[serde(default)]
    pub denoise: bool,
    /// Pista de audio del archivo a usar (0 = la primera). None = mezclar
    /// todas (lo normal en grabaciones con juego + micrófono).
    #[serde(default)]
    pub track: Option<u32>,
    /// "Mejorar voz" (EQ, compresor, ruido y nivel de micrófono).
    #[serde(default)]
    pub enhance: Option<VoiceEnhance>,
    /// El audio se separó a una pista propia ("Separar audio"): acá no suena.
    #[serde(default)]
    pub detached: bool,
}

impl Default for ClipAudio {
    fn default() -> Self {
        Self {
            volume: 1.0,
            muted: false,
            removed: false,
            fade_in: 0.0,
            fade_out: 0.0,
            normalize: None,
            denoise: false,
            track: None,
            enhance: None,
            detached: false,
        }
    }
}

/// "Mejorar voz" con un clic: intensidad 0..1 y, si se midió, el nivel del
/// original para llevarlo a un nivel de voz parejo (−16 LUFS).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEnhance {
    #[serde(default = "voice_amount")]
    pub amount: f64,
    #[serde(default)]
    pub loudness: Option<Loudness>,
}

fn voice_amount() -> f64 {
    0.6
}

/// Punto de la curva de volumen de un clip de audio (t relativo al inicio del clip).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeKey {
    #[serde(default)]
    pub id: u64,
    pub t: f64,
    /// Ganancia (1 = original, 0..2).
    pub v: f64,
}

/// Estado de una pista del timeline (ojo, silenciar, solo, candado, volumen).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackState {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "one")]
    pub volume: f64,
}

impl Default for TrackState {
    fn default() -> Self {
        Self { name: None, hidden: false, muted: false, solo: false, locked: false, volume: 1.0 }
    }
}

/// Estados de todas las pistas (lo que no está, va con los valores por defecto).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tracks {
    #[serde(default)]
    pub video: TrackState,
    /// Audio de los clips de la pista principal.
    #[serde(default)]
    pub video_audio: TrackState,
    /// Una por fila de capas.
    #[serde(default)]
    pub overlays: Vec<TrackState>,
    #[serde(default)]
    pub subtitles: TrackState,
    /// Una por pista de audio (música, efectos, voz…).
    #[serde(default)]
    pub audio: Vec<TrackState>,
}

impl Tracks {
    pub fn overlay(&self, lane: u32) -> TrackState {
        self.overlays.get(lane as usize).cloned().unwrap_or_default()
    }
    pub fn audio_track(&self, i: u32) -> TrackState {
        self.audio.get(i as usize).cloned().unwrap_or_default()
    }
    /// ¿Alguna pista de audio (o el audio del video) está en solo?
    pub fn any_solo(&self) -> bool {
        self.video_audio.solo || self.audio.iter().any(|t| t.solo)
    }
    /// Ganancia de una pista de audio según silenciar/solo/volumen.
    pub fn gain_of(&self, t: &TrackState) -> f64 {
        if t.muted || (self.any_solo() && !t.solo) { 0.0 } else { t.volume.max(0.0) }
    }
}

/// Medidas de la primera pasada de loudnorm (para la normalización lineal).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    pub input_i: f64,
    pub input_tp: f64,
    pub input_lra: f64,
    pub input_thresh: f64,
    pub target_offset: f64,
}

/// Objetivo de la normalización (EBU R128 para redes / streaming).
pub const LOUDNORM_I: f64 = -14.0;
pub const LOUDNORM_TP: f64 = -1.0;
pub const LOUDNORM_LRA: f64 = 11.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipVideo {
    /// Recorte del encuadre en coordenadas normalizadas del original (ya rotado por metadatos).
    #[serde(default)]
    pub crop: Option<CropRect>,
    /// Rotación extra en grados: 0, 90, 180 o 270.
    #[serde(default)]
    pub rotate: u32,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
    #[serde(default)]
    pub color: ColorAdjust,
    #[serde(default)]
    pub look: Option<Look>,
    #[serde(default)]
    pub stabilize: Option<Stabilize>,
    /// Nitidez 0..=1.
    #[serde(default)]
    pub sharpen: f64,
    /// Reducción de ruido de imagen 0..=1.
    #[serde(default)]
    pub denoise: f64,
    /// Zoom y paneo animado (tiempo relativo al inicio del clip en el timeline).
    #[serde(default)]
    pub zoom: Vec<ZoomKey>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Proporción elegida (solo informativa para la UI): "16:9", "9:16", "1:1", "4:5", "free".
    #[serde(default)]
    pub aspect: Option<String>,
}

/// Ajustes de color. Todos en -1..=1, 0 = sin cambio.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ColorAdjust {
    #[serde(default)]
    pub brightness: f64,
    #[serde(default)]
    pub contrast: f64,
    #[serde(default)]
    pub saturation: f64,
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub exposure: f64,
}

impl ColorAdjust {
    pub fn is_identity(&self) -> bool {
        [self.brightness, self.contrast, self.saturation, self.temperature, self.exposure]
            .iter()
            .all(|v| v.abs() < 1e-6)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    pub id: String,
    /// 0..=1
    #[serde(default = "one")]
    pub intensity: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stabilize {
    /// 0..=1
    #[serde(default = "half")]
    pub strength: f64,
}

fn half() -> f64 {
    0.5
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Easing {
    Linear,
    #[default]
    EaseInOut,
    EaseIn,
    EaseOut,
}

/// Keyframe de zoom/paneo: `zoom` ≥ 1, centro (`cx`, `cy`) normalizado en el lienzo.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomKey {
    pub id: u64,
    pub t: f64,
    pub zoom: f64,
    pub cx: f64,
    pub cy: f64,
    /// Curva desde este keyframe hasta el siguiente.
    #[serde(default)]
    pub easing: Easing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransitionKind {
    Fade,
    FadeBlack,
    FadeWhite,
    SlideLeft,
    SlideRight,
    SlideUp,
    SlideDown,
    WipeLeft,
    WipeRight,
    CircleOpen,
    ZoomIn,
}

impl TransitionKind {
    /// Nombre de la transición en el filtro `xfade`.
    pub fn xfade_name(self) -> &'static str {
        match self {
            TransitionKind::Fade => "fade",
            TransitionKind::FadeBlack => "fadeblack",
            TransitionKind::FadeWhite => "fadewhite",
            TransitionKind::SlideLeft => "slideleft",
            TransitionKind::SlideRight => "slideright",
            TransitionKind::SlideUp => "slideup",
            TransitionKind::SlideDown => "slidedown",
            TransitionKind::WipeLeft => "wipeleft",
            TransitionKind::WipeRight => "wiperight",
            TransitionKind::CircleOpen => "circleopen",
            TransitionKind::ZoomIn => "zoomin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub kind: TransitionKind,
    pub duration: f64,
}

// ------------------------------- Superposiciones -------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub id: String,
    pub start: f64,
    pub duration: f64,
    /// Fila dentro de la pista de superposiciones (solo visual).
    #[serde(default)]
    pub lane: u32,
    #[serde(flatten)]
    pub content: OverlayContent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
// Pocas capas por proyecto: no vale la pena encajonar la variante de texto.
#[allow(clippy::large_enum_variant)]
pub enum OverlayContent {
    Text(TextLayer),
    /// Imagen fija: logo, marca de agua o PiP de imagen.
    Image(ImageLayer),
    /// Picture-in-picture de video.
    Video(PipLayer),
    /// Desenfocar o pixelar una zona.
    Blur(BlurLayer),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayer {
    pub text: String,
    #[serde(default)]
    pub template: Option<String>,
    pub style: TextStyle,
    /// Centro normalizado en el lienzo.
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub anim_in: Option<TextAnim>,
    #[serde(default)]
    pub anim_out: Option<TextAnim>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    pub font_family: String,
    /// Tamaño en fracción del alto del lienzo (0.06 = 6% del alto).
    pub size: f64,
    #[serde(default = "default_weight")]
    pub weight: u32,
    #[serde(default)]
    pub italic: bool,
    pub color: String,
    #[serde(default)]
    pub align: TextAlign,
    #[serde(default)]
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub shadow: Option<Shadow>,
    #[serde(default)]
    pub background: Option<TextBackground>,
}

fn default_weight() -> u32 {
    600
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    Left,
    #[default]
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    pub color: String,
    /// Fracción del tamaño de la letra.
    pub width: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shadow {
    pub color: String,
    pub blur: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBackground {
    pub color: String,
    pub opacity: f64,
    pub padding: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAnimKind {
    Fade,
    Slide,
    Pop,
    Typewriter,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAnim {
    pub kind: TextAnimKind,
    pub duration: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageLayer {
    pub media_id: String,
    /// Centro normalizado.
    pub x: f64,
    pub y: f64,
    /// Ancho como fracción del ancho del lienzo.
    pub width: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    /// Radio de las esquinas en fracción del lado corto de la imagen.
    #[serde(default)]
    pub radius: f64,
    #[serde(default)]
    pub shadow: bool,
    /// Rotación en grados (sentido horario).
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub anim_in: Option<TextAnim>,
    #[serde(default)]
    pub anim_out: Option<TextAnim>,
    /// Marca de agua: dura todo el video (se ajusta sola si cambia el largo).
    #[serde(default)]
    pub watermark: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipLayer {
    pub media_id: String,
    #[serde(default)]
    pub in_point: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    #[serde(default)]
    pub radius: f64,
    #[serde(default = "yes")]
    pub shadow: bool,
    #[serde(default)]
    pub volume: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum BlurMode {
    #[default]
    Blur,
    Pixelate,
}

/// Rectángulo normalizado (x, y = esquina superior izquierda).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectKey {
    pub id: u64,
    /// Tiempo relativo al inicio de la superposición.
    pub t: f64,
    pub rect: Rect,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlurLayer {
    #[serde(default)]
    pub mode: BlurMode,
    /// 0..=1
    pub strength: f64,
    pub rect: Rect,
    #[serde(default)]
    pub keys: Vec<RectKey>,
}

// ---------------------------------- Música ------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicClip {
    pub id: String,
    pub media_id: String,
    /// Dónde empieza en el timeline.
    pub start: f64,
    pub in_point: f64,
    pub out_point: f64,
    #[serde(default = "music_volume")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    /// Bajar la música cuando suena el audio del video (sidechain).
    #[serde(default)]
    pub ducking: bool,
    /// Pista de audio (fila) donde está; 0 = la primera.
    #[serde(default)]
    pub track: u32,
    /// Curva de volumen (suave entre puntos). Vacía = volumen fijo.
    #[serde(default)]
    pub volume_keys: Vec<VolumeKey>,
    #[serde(default)]
    pub enhance: Option<VoiceEnhance>,
    /// Si es el audio separado de un clip de la pista principal, su id.
    #[serde(default)]
    pub linked_clip: Option<String>,
    /// Pista del archivo (None = mezclar todas, como en los clips).
    #[serde(default)]
    pub source_track: Option<u32>,
    #[serde(default)]
    pub muted: bool,
}

fn music_volume() -> f64 {
    0.6
}

// ---------------------------- Marcadores y rangos -----------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    pub time: f64,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRange {
    pub id: String,
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub name: String,
}

// -------------------------------- Subtítulos ----------------------------------

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitles {
    #[serde(default)]
    pub cues: Vec<Cue>,
    #[serde(default)]
    pub style: SubtitleStyle,
    /// Estilo "palabra por palabra" (resalta la palabra que se dice).
    #[serde(default)]
    pub word_by_word: bool,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default)]
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    pub font_family: String,
    pub size: f64,
    pub weight: u32,
    pub color: String,
    pub highlight: String,
    #[serde(default)]
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub background: Option<TextBackground>,
    /// Posición vertical del centro (0 = arriba, 1 = abajo).
    pub y: f64,
    #[serde(default)]
    pub uppercase: bool,
}

impl Default for SubtitleStyle {
    fn default() -> Self {
        Self {
            font_family: "Segoe UI Variable Display".into(),
            size: 0.055,
            weight: 700,
            color: "#FFFFFF".into(),
            highlight: "#FFD60A".into(),
            stroke: Some(Stroke { color: "#000000".into(), width: 0.12 }),
            background: None,
            y: 0.86,
            uppercase: false,
        }
    }
}

// ------------------------------ Lienzo y fades --------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Fades {
    /// Fundido desde negro al inicio (segundos, 0 = sin fundido).
    #[serde(default)]
    pub fade_in: f64,
    /// Fundido a negro al final.
    #[serde(default)]
    pub fade_out: f64,
}

/// Lienzo de la secuencia: tamaño y fps de salida "Original".
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    /// Si es automático, el frontend lo ajusta al primer clip.
    #[serde(default = "yes")]
    pub auto: bool,
}

impl Canvas {
    /// fps normalizados (un proyecto viejo puede traer 90000/1 o 1300000/21667).
    pub fn rate(&self) -> (u32, u32) {
        crate::probe::standard_fps(self.fps_num, self.fps_den)
    }

    pub fn fps(&self) -> f64 {
        let (n, d) = self.rate();
        n as f64 / d as f64
    }
    /// fps como fracción para FFmpeg ("30000/1001").
    pub fn fps_expr(&self) -> String {
        let (n, d) = self.rate();
        if d <= 1 { format!("{n}") } else { format!("{n}/{d}") }
    }
}

impl Default for Canvas {
    fn default() -> Self {
        Self { width: 1920, height: 1080, fps_num: 30, fps_den: 1, auto: true }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    #[serde(default)]
    pub playhead: f64,
    /// Píxeles por segundo del timeline. 0 = ajustar a la ventana.
    #[serde(default)]
    pub zoom: f64,
    #[serde(default)]
    pub scroll: f64,
}

impl Default for ViewState {
    fn default() -> Self {
        Self { playhead: 0.0, zoom: 0.0, scroll: 0.0 }
    }
}

// ------------------------------- Exportación ----------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, Hash)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    #[default]
    Mp4,
    Mov,
    Mkv,
    Webm,
    Gif,
    Mp3,
}

impl OutputFormat {
    pub fn extension(self) -> &'static str {
        match self {
            OutputFormat::Mp4 => "mp4",
            OutputFormat::Mov => "mov",
            OutputFormat::Mkv => "mkv",
            OutputFormat::Webm => "webm",
            OutputFormat::Gif => "gif",
            OutputFormat::Mp3 => "mp3",
        }
    }
    pub fn muxer(self) -> &'static str {
        match self {
            OutputFormat::Mp4 => "mp4",
            OutputFormat::Mov => "mov",
            OutputFormat::Mkv => "matroska",
            OutputFormat::Webm => "webm",
            OutputFormat::Gif => "gif",
            OutputFormat::Mp3 => "mp3",
        }
    }
    pub fn has_video(self) -> bool {
        !matches!(self, OutputFormat::Mp3)
    }
    pub fn has_audio(self) -> bool {
        !matches!(self, OutputFormat::Gif)
    }
    /// ¿Admite copiar sin recodificar (modo rápido)?
    pub fn supports_copy(self) -> bool {
        matches!(self, OutputFormat::Mp4 | OutputFormat::Mov | OutputFormat::Mkv)
    }
    pub fn from_extension(ext: &str) -> Option<Self> {
        Some(match ext.to_ascii_lowercase().as_str() {
            "mp4" => OutputFormat::Mp4,
            "mov" => OutputFormat::Mov,
            "mkv" => OutputFormat::Mkv,
            "webm" => OutputFormat::Webm,
            "gif" => OutputFormat::Gif,
            "mp3" => OutputFormat::Mp3,
            _ => return None,
        })
    }
}

/// Preferencia de modo: rápido cuando se puede, o siempre recodificar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ModePreference {
    #[default]
    Auto,
    Precise,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    #[serde(default)]
    pub format: OutputFormat,
    #[serde(default)]
    pub mode: ModePreference,
    #[serde(default = "res_original")]
    pub resolution: ResolutionChoice,
    #[serde(default = "fps_original")]
    pub fps: FpsChoice,
    #[serde(default)]
    pub allow_upscale: bool,
    #[serde(default)]
    pub allow_fps_increase: bool,
    /// Peso máximo del archivo (presets de plataforma).
    #[serde(default)]
    pub size_target: Option<SizeTarget>,
    #[serde(default)]
    pub gif: GifSettings,
}

fn res_original() -> ResolutionChoice {
    ResolutionChoice::Original
}
fn fps_original() -> FpsChoice {
    FpsChoice::Original
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            format: OutputFormat::Mp4,
            mode: ModePreference::Auto,
            resolution: ResolutionChoice::Original,
            fps: FpsChoice::Original,
            allow_upscale: false,
            allow_fps_increase: false,
            size_target: None,
            gif: GifSettings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeTarget {
    /// Id del preset de `platform_limits.json` ("discord", "custom", …).
    pub preset: String,
    /// Límite en megabytes (MB = 1 000 000 bytes, para quedar siempre debajo).
    pub megabytes: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifSettings {
    pub fps: u32,
    pub width: u32,
}

impl Default for GifSettings {
    fn default() -> Self {
        Self { fps: 15, width: 480 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_project_json_gets_defaults() {
        let j = r#"{"version":1,"id":"p1","name":"Prueba","canvas":{"width":1280,"height":720,"fpsNum":30,"fpsDen":1},
            "media":[{"id":"m1","path":"C:\\a.mp4","kind":"video","duration":10,"width":1280,"height":720,"fps":30,"fpsNum":30}],
            "clips":[{"id":"c1","mediaId":"m1","inPoint":0,"outPoint":5}]}"#;
        let p: Project = serde_json::from_str(j).unwrap();
        let c = &p.clips[0];
        assert_eq!(c.speed, 1.0);
        assert_eq!(c.kind, ClipKind::Video);
        assert_eq!(c.loop_mode, LoopMode::None);
        assert_eq!(c.loop_count, 1);
        assert_eq!(c.audio.volume, 1.0);
        assert!(c.video.color.is_identity());
        assert!(p.canvas.auto);
        assert_eq!(p.export.format, OutputFormat::Mp4);
        assert_eq!(p.subtitles.style.color, "#FFFFFF");
        assert_eq!(p.media("m1").unwrap().fps_den, 1);
    }

    #[test]
    fn overlay_is_tagged_and_flattened() {
        let o = Overlay {
            id: "o1".into(),
            start: 1.0,
            duration: 2.0,
            lane: 0,
            content: OverlayContent::Blur(BlurLayer {
                mode: BlurMode::Pixelate,
                strength: 0.5,
                rect: Rect { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
                keys: vec![],
            }),
        };
        let v = serde_json::to_value(&o).unwrap();
        assert_eq!(v["type"], "blur");
        assert_eq!(v["mode"], "pixelate");
        let back: Overlay = serde_json::from_value(v).unwrap();
        assert_eq!(back, o);
    }

    #[test]
    fn roundtrip_full_project() {
        let p = crate::testutil::sample_project();
        let s = serde_json::to_string_pretty(&p).unwrap();
        let back: Project = serde_json::from_str(&s).unwrap();
        assert_eq!(back, p);
        assert!(s.contains("\"version\": 1"));
    }

    #[test]
    fn formats() {
        assert_eq!(OutputFormat::Mkv.muxer(), "matroska");
        assert!(!OutputFormat::Gif.has_audio());
        assert!(!OutputFormat::Mp3.has_video());
        assert!(OutputFormat::Mov.supports_copy());
        assert!(!OutputFormat::Webm.supports_copy());
        assert_eq!(OutputFormat::from_extension("WEBM"), Some(OutputFormat::Webm));
        assert_eq!(Canvas { width: 1, height: 1, fps_num: 30000, fps_den: 1001, auto: true }.fps_expr(), "30000/1001");
        // Base de tiempo en vez de fps: tope de 240; promedio raro → 60.
        assert_eq!(Canvas { width: 1, height: 1, fps_num: 90000, fps_den: 1, auto: true }.fps_expr(), "240");
        assert_eq!(Canvas { width: 1, height: 1, fps_num: 1300000, fps_den: 21667, auto: true }.fps_expr(), "60");
    }
}
