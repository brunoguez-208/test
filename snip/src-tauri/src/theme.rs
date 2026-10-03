//! Tema del sistema: claro/oscuro y color de acento de Windows (UISettings),
//! con aviso en vivo al frontend cuando cambian.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Palette {
    pub dark: bool,
    pub accent: String,
    pub light1: String,
    pub light2: String,
    pub light3: String,
    pub dark1: String,
    pub dark2: String,
    pub dark3: String,
}

impl Default for Palette {
    /// Acento azul por defecto de Windows 11.
    fn default() -> Self {
        Self {
            dark: true,
            accent: "#0078D4".into(),
            light1: "#0093F9".into(),
            light2: "#60CDFF".into(),
            light3: "#99EBFF".into(),
            dark1: "#005FB8".into(),
            dark2: "#004A83".into(),
            dark3: "#003A6A".into(),
        }
    }
}

pub const THEME_EVENT: &str = "theme-changed";

#[cfg(windows)]
mod imp {
    use super::Palette;
    use windows::UI::ViewManagement::{UIColorType, UISettings};

    fn hex(c: windows::UI::Color) -> String {
        format!("#{:02X}{:02X}{:02X}", c.R, c.G, c.B)
    }

    pub fn read(settings: &UISettings) -> windows::core::Result<Palette> {
        let get = |t: UIColorType| settings.GetColorValue(t).map(hex);
        let fg = settings.GetColorValue(UIColorType::Foreground)?;
        // Texto claro ⇒ tema oscuro.
        let luminance = (5 * fg.G as u32 + 2 * fg.R as u32 + fg.B as u32) > 8 * 128;
        Ok(Palette {
            dark: luminance,
            accent: get(UIColorType::Accent)?,
            light1: get(UIColorType::AccentLight1)?,
            light2: get(UIColorType::AccentLight2)?,
            light3: get(UIColorType::AccentLight3)?,
            dark1: get(UIColorType::AccentDark1)?,
            dark2: get(UIColorType::AccentDark2)?,
            dark3: get(UIColorType::AccentDark3)?,
        })
    }

    pub fn current() -> Palette {
        UISettings::new().and_then(|s| read(&s)).unwrap_or_default()
    }

    pub fn watch(on_change: impl Fn(Palette) + Send + Sync + 'static) {
        use windows::Foundation::TypedEventHandler;
        let Ok(settings) = UISettings::new() else { return };
        let handler = TypedEventHandler::new(move |_sender, _args| {
            // ColorValuesChanged llega en un hilo de fondo; leemos de nuevo todo.
            on_change(current());
            Ok(())
        });
        if settings.ColorValuesChanged(&handler).is_ok() {
            // El objeto tiene que seguir vivo para que el evento siga llegando.
            std::mem::forget(settings);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Palette;
    pub fn current() -> Palette {
        Palette::default()
    }
    pub fn watch(_on_change: impl Fn(Palette) + Send + Sync + 'static) {}
}

pub fn current() -> Palette {
    imp::current()
}

/// Escucha cambios de tema/acento y los manda al frontend.
pub fn watch(app: AppHandle) {
    imp::watch(move |palette| {
        let _ = app.emit(THEME_EVENT, palette);
    });
}
