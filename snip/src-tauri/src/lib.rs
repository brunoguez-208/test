mod commands;
mod state;
mod system;
mod theme;

use state::AppState;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_decorum::WebviewWindowExt;

/// Lleva al frente la ventana principal (por ejemplo, cuando se abre otro archivo).
fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // Tiene que ser el primer plugin: si Snip ya está abierto, el archivo se
        // manda a la ventana existente y esta segunda instancia se cierra.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(file) = state::file_arg(argv) {
                let p = PathBuf::from(&file);
                let abs = if p.is_absolute() { p } else { PathBuf::from(cwd).join(p) };
                let _ = app.emit("open-file", abs.to_string_lossy().into_owned());
            }
            focus_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            let cache_dir = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("Snip"));
            let launch = state::file_arg(std::env::args()).map(|f| {
                std::fs::canonicalize(&f)
                    .map(|p| {
                        // Sacamos el prefijo \\?\ que agrega canonicalize en Windows.
                        let s = p.to_string_lossy().into_owned();
                        s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
                    })
                    .unwrap_or(f)
            });
            let st = AppState::new(state::resolve_tools(), cache_dir, launch);

            let window = app.get_webview_window("main").expect("ventana principal");
            window.create_overlay_titlebar()?;
            let material = system::apply_material(&window);
            if let Ok(mut m) = st.material.lock() {
                *m = material.to_string();
            }
            app.manage(st);

            theme::watch(app.handle().clone());

            // Red de seguridad: si por algo el frontend no mostró la ventana, la
            // mostramos igual a los 3 segundos.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            });

            // En segundo plano: limpiar proxies viejos y detectar el encoder,
            // así el panel de exportación ya sabe cuál se va a usar.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let st = handle.state::<AppState>();
                st.cleanup_proxies();
                let _ = st.encoder();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::take_launch_file,
            commands::show_main_window,
            commands::get_appearance,
            commands::open_media,
            commands::get_keyframes,
            commands::start_thumbnails,
            commands::create_preview_proxy,
            commands::cancel_proxy,
            commands::get_encoder,
            commands::default_output_path,
            commands::export_video,
            commands::cancel_export,
            commands::reveal_in_folder,
            commands::open_in_default_app,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Snip");
}
