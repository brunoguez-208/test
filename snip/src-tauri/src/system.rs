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

/// Estilo de ventana sin el menú de sistema: sin `WS_SYSMENU`, DWM no dibuja
/// sus botones de minimizar/maximizar/cerrar en el marco extendido.
pub const fn without_sysmenu(style: u32) -> u32 {
    const WS_SYSMENU: u32 = 0x0008_0000;
    style & !WS_SYSMENU
}

/// Saca los botones nativos que DWM dibuja detrás del contenido.
///
/// Con el marco de DWM extendido a toda la ventana (para Mica) y la ventana
/// con `WS_CAPTION | WS_SYSMENU` (tao los deja siempre), DWM pinta sus propios
/// botones de ventana arriba a la derecha. Con el webview transparente se veían
/// detrás de los de Snip, y al maximizar quedaban corridos: dos juegos
/// superpuestos. Se quita `WS_SYSMENU` y una subclase lo vuelve a quitar cada
/// vez que tao reescribe el estilo (al maximizar, restaurar o pantalla completa).
/// Snap (Win+flechas, arrastrar a los bordes) depende de `WS_THICKFRAME`, que
/// se mantiene; el panel de Snap Layouts lo abre el botón de maximizar propio.
#[cfg(windows)]
pub fn hide_native_caption_buttons(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_STYLE, STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, WM_STYLECHANGING,
    };

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if msg == WM_STYLECHANGING && wparam.0 as i32 == GWL_STYLE.0 {
            let st = lparam.0 as *mut STYLESTRUCT;
            if !st.is_null() {
                unsafe { (*st).styleNew = without_sysmenu((*st).styleNew) };
            }
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    let Ok(h) = window.hwnd() else { return };
    let hwnd = HWND(h.0);
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(proc), 0x5317, 0);
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        SetWindowLongW(hwnd, GWL_STYLE, without_sysmenu(style) as i32);
        let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
}

#[cfg(not(windows))]
pub fn hide_native_caption_buttons(_window: &tauri::WebviewWindow) {}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sysmenu_is_removed_and_the_rest_kept() {
        // WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_MAXIMIZE
        let style = 0x00CF_0000 | 0x1000_0000 | 0x0100_0000;
        let s = without_sysmenu(style);
        assert_eq!(s & 0x0008_0000, 0, "sin WS_SYSMENU");
        assert_eq!(s & 0x0004_0000, 0x0004_0000, "WS_THICKFRAME (Snap y bordes) sigue");
        assert_eq!(s & 0x0003_0000, 0x0003_0000, "WS_MINIMIZEBOX | WS_MAXIMIZEBOX siguen");
        assert_eq!(s & 0x00C0_0000, 0x00C0_0000, "WS_CAPTION sigue (animaciones y sombra)");
        assert_eq!(s & 0x0100_0000, 0x0100_0000);
    }
}
