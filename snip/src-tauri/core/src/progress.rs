//! Parser de la salida de `ffmpeg -progress pipe:1`.
//!
//! FFmpeg escribe bloques `clave=valor` y cierra cada uno con
//! `progress=continue` o `progress=end`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSample {
    /// Tiempo ya procesado de la salida, en segundos.
    pub out_time: f64,
    /// Cuadros de video ya escritos.
    pub frame: Option<u64>,
    /// Velocidad relativa a tiempo real (2.5 = 2.5x). None si FFmpeg dice N/A.
    pub speed: Option<f64>,
    pub fps: Option<f64>,
    pub total_size: Option<u64>,
    pub done: bool,
}

#[derive(Debug, Default)]
pub struct ProgressParser {
    cur: ProgressSample,
}

impl ProgressParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Procesa una línea. Devuelve una muestra completa al cerrar un bloque.
    pub fn feed(&mut self, line: &str) -> Option<ProgressSample> {
        let (key, value) = line.trim().split_once('=')?;
        let value = value.trim();
        match key.trim() {
            // out_time_ms está (por un viejo bug de FFmpeg) en microsegundos, igual que out_time_us.
            "out_time_us" | "out_time_ms" => {
                if let Ok(us) = value.parse::<i64>() {
                    self.cur.out_time = (us.max(0) as f64) / 1_000_000.0;
                }
            }
            "out_time" => {
                if let Some(t) = parse_clock(value) {
                    // Solo si no vino en microsegundos (más preciso).
                    if self.cur.out_time == 0.0 {
                        self.cur.out_time = t.max(0.0);
                    }
                }
            }
            "speed" => {
                self.cur.speed = value.trim_end_matches('x').trim().parse::<f64>().ok().filter(|s| s.is_finite() && *s > 0.0);
            }
            "frame" => self.cur.frame = value.parse::<u64>().ok(),
            "fps" => self.cur.fps = value.parse::<f64>().ok().filter(|f| f.is_finite()),
            "total_size" => self.cur.total_size = value.parse::<u64>().ok(),
            "progress" => {
                let mut sample = self.cur;
                sample.done = value == "end";
                self.cur = ProgressSample { out_time: 0.0, ..ProgressSample::default() };
                return Some(sample);
            }
            _ => {}
        }
        None
    }
}

/// "HH:MM:SS.micro" → segundos.
pub fn parse_clock(s: &str) -> Option<f64> {
    let neg = s.starts_with('-');
    let s = s.trim_start_matches('-');
    let mut parts = s.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    let t = h * 3600.0 + m * 60.0 + sec;
    Some(if neg { -t } else { t })
}

/// Progreso listo para mostrar.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressReport {
    /// 0..=100
    pub percent: f64,
    pub speed: Option<f64>,
    /// Segundos restantes estimados.
    pub eta_secs: Option<f64>,
    pub out_time: f64,
}

/// Calcula el progreso. Si FFmpeg informa cuadros de video, se usan esos: el
/// `out_time` puede adelantarse por el audio (que se copia mucho más rápido que
/// lo que tarda en codificarse el video) y daría saltos para atrás.
pub fn report(sample: &ProgressSample, total_duration: f64, video_fps: f64) -> ProgressReport {
    if sample.done {
        return ProgressReport { percent: 100.0, speed: sample.speed, eta_secs: Some(0.0), out_time: total_duration };
    }
    let total = total_duration.max(1e-6);
    let total_frames = (total * video_fps).max(1.0);
    // No mostramos 100% hasta que FFmpeg diga "end" (falta escribir el moov / faststart).
    let cap = |p: f64| p.clamp(0.0, 99.5);

    if let (Some(frame), true) = (sample.frame.filter(|f| *f > 0), video_fps > 0.0) {
        let frame = frame as f64;
        let done = (frame / video_fps).min(total);
        let enc_fps = sample.fps.filter(|f| *f > 0.0);
        let speed = enc_fps.map(|f| f / video_fps).or(sample.speed);
        let eta_secs = enc_fps
            .map(|f| ((total_frames - frame) / f).max(0.0))
            .or_else(|| speed.map(|sp| ((total - done) / sp).max(0.0)));
        return ProgressReport { percent: cap(frame / total_frames * 100.0), speed, eta_secs, out_time: done };
    }

    let done = sample.out_time.clamp(0.0, total);
    let eta_secs = sample.speed.map(|sp| ((total - done) / sp).max(0.0));
    ProgressReport { percent: cap(done / total * 100.0), speed: sample.speed, eta_secs, out_time: done }
}

/// Envuelve un callback de progreso para que el porcentaje nunca retroceda.
pub fn monotonic(mut f: impl FnMut(ProgressReport)) -> impl FnMut(ProgressReport) {
    let mut last = 0.0f64;
    move |mut r: ProgressReport| {
        if r.percent < last {
            r.percent = last;
        }
        last = r.percent;
        f(r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLOCK: &str = "frame=120\nfps=59.94\nstream_0_0_q=23.0\nbitrate=4000.0kbits/s\ntotal_size=1048576\nout_time_us=2002000\nout_time_ms=2002000\nout_time=00:00:02.002000\ndup_frames=0\ndrop_frames=0\nspeed=1.98x\nprogress=continue\n";

    #[test]
    fn parses_a_block() {
        let mut p = ProgressParser::new();
        let mut out = vec![];
        for l in BLOCK.lines() {
            if let Some(s) = p.feed(l) {
                out.push(s);
            }
        }
        assert_eq!(out.len(), 1);
        let s = out[0];
        assert!((s.out_time - 2.002).abs() < 1e-9);
        assert_eq!(s.speed, Some(1.98));
        assert_eq!(s.fps, Some(59.94));
        assert_eq!(s.total_size, Some(1_048_576));
        assert!(!s.done);
    }

    #[test]
    fn handles_na_and_end() {
        let mut p = ProgressParser::new();
        for l in ["out_time_us=N/A", "out_time=N/A", "speed=N/A"] {
            assert!(p.feed(l).is_none());
        }
        let s = p.feed("progress=continue").unwrap();
        assert_eq!(s.out_time, 0.0);
        assert_eq!(s.speed, None);
        p.feed("out_time_us=5000000");
        p.feed("speed= 512x");
        let s = p.feed("progress=end").unwrap();
        assert!(s.done);
        assert_eq!(s.speed, Some(512.0));
        assert_eq!(report(&s, 5.0, 30.0).percent, 100.0);
    }

    #[test]
    fn negative_times_clamp_to_zero() {
        let mut p = ProgressParser::new();
        p.feed("out_time_us=-23220");
        let s = p.feed("progress=continue").unwrap();
        assert_eq!(s.out_time, 0.0);
        assert_eq!(parse_clock("-00:00:00.023220"), Some(-0.02322));
    }

    #[test]
    fn falls_back_to_clock_when_no_microseconds() {
        let mut p = ProgressParser::new();
        p.feed("out_time=00:01:02.500000");
        let s = p.feed("progress=continue").unwrap();
        assert!((s.out_time - 62.5).abs() < 1e-9);
    }

    #[test]
    fn report_percent_and_eta() {
        let s = ProgressSample { out_time: 5.0, speed: Some(2.0), ..Default::default() };
        let r = report(&s, 20.0, 30.0);
        assert!((r.percent - 25.0).abs() < 1e-9);
        assert!((r.eta_secs.unwrap() - 7.5).abs() < 1e-9);
        // Nunca 100% antes del final, ni más que el total.
        let s = ProgressSample { out_time: 25.0, speed: None, ..Default::default() };
        let r = report(&s, 20.0, 30.0);
        assert_eq!(r.percent, 99.5);
        assert_eq!(r.eta_secs, None);
    }

    #[test]
    fn frames_win_over_out_time() {
        // El audio ya llegó al final pero el video va por la mitad.
        let s = ProgressSample { out_time: 9.9, frame: Some(150), fps: Some(60.0), speed: Some(9.0), ..Default::default() };
        let r = report(&s, 10.0, 30.0);
        assert!((r.percent - 50.0).abs() < 1e-9);
        assert!((r.speed.unwrap() - 2.0).abs() < 1e-9);
        assert!((r.eta_secs.unwrap() - 2.5).abs() < 1e-9);
        assert!((r.out_time - 5.0).abs() < 1e-9);
    }

    #[test]
    fn monotonic_never_goes_back() {
        let mut seen = vec![];
        {
            let mut f = monotonic(|r| seen.push(r.percent));
            for p in [10.0, 40.0, 30.0, 50.0] {
                f(ProgressReport { percent: p, speed: None, eta_secs: None, out_time: 0.0 });
            }
        }
        assert_eq!(seen, vec![10.0, 40.0, 40.0, 50.0]);
    }
}
