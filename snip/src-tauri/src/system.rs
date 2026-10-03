//! Integración con el sistema: material de la ventana (Mica/Acrylic), abrir la
//! carpeta con el archivo seleccionado y reproducir con la app predeterminada.

use snip_core::error::{AppError, ErrorKind};
use std::path::Path;

/// Aplica Mica (Windows 11) o Acrylic (Windows 10) como fondo de la ventana.
/// Devuelve "mica", "acrylic" o "none" para que el frontend elija sus capas.
#[cfg(windows)]
pub fn apply_material(window: &tauri::WebviewWindow) -> &'static str {
    use window_vibrancy::{apply_acrylic, apply_mica};

    let material = if apply_mica(window, None).is_ok() {
        "mica"
    } else if apply_acrylic(window, Some((32, 32, 32, 200))).is_ok() {
        "acrylic"
    } else {
        "none"
    };

    if material != "none" {
        // Ventana sin decoración: extendemos el marco de DWM a todo el área
        // cliente para que el material se vea detrás del contenido.
        if let Ok(hwnd) = window.hwnd() {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
            use windows::Win32::UI::Controls::MARGINS;
            let margins = MARGINS { cxLeftWidth: -1, cxRightWidth: -1, cyTopHeight: -1, cyBottomHeight: -1 };
            unsafe {
                let _ = DwmExtendFrameIntoClientArea(HWND(hwnd.0), &margins);
            }
        }
    }
    material
}

#[cfg(not(windows))]
pub fn apply_material(_window: &tauri::WebviewWindow) -> &'static str {
    "none"
}

/// Abre el Explorador en la carpeta del archivo, con el archivo seleccionado.
pub fn reveal_in_folder(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Err(AppError::new(ErrorKind::NotFound));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer necesita `/select,"ruta"` como un solo argumento sin re-escapar.
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map_err(|e| AppError::from_io(&e))?;
    }
    #[cfg(not(windows))]
    {
        let dir = path.parent().unwrap_or(path);
        std::process::Command::new("xdg-open").arg(dir).spawn().map_err(|e| AppError::from_io(&e))?;
    }
    Ok(())
}

/// Abre el archivo con la app predeterminada del sistema.
pub fn open_with_default_app(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Err(AppError::new(ErrorKind::NotFound));
    }
    #[cfg(windows)]
    {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let file = HSTRING::from(path.as_os_str());
        let verb = HSTRING::from("open");
        let result = unsafe { ShellExecuteW(None, &verb, &file, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        // ShellExecute devuelve un valor > 32 si salió bien.
        if result.0 as isize <= 32 {
            return Err(AppError::with_message(ErrorKind::Unknown, "No se pudo abrir el video con la app predeterminada."));
        }
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn().map_err(|e| AppError::from_io(&e))?;
    }
    Ok(())
}
