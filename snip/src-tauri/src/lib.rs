mod commands;
mod state;
mod system;
mod theme;

use serde::Serialize;
use snip_core::project_export::{export_project, ExportEnv};
use snip_core::queue::{ExportQueue, ItemStatus, QueueItem};
use state::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_plugin_notification::NotificationExt;

/// Lleva al frente la ventana principal (por ejemplo, cuando se abre otro archivo).
fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueEvent<'a> {
    items: &'a [QueueItem],
}

/// Notificación de Windows al terminar una exportación (salvo cancelaciones).
fn notify_finished(app: &tauri::AppHandle, item: &QueueItem) {
    let (title, body) = match &item.status {
        ItemStatus::Done { outcome } => {
            let name = std::path::Path::new(&outcome.output)
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default();
            ("Exportación lista".to_string(), name)
        }
        ItemStatus::Failed { error } => (format!("No se pudo exportar «{}»", item.title), error.message.clone()),
        _ => return,
    };
    let _ = app.notification().builder().title(title).body(body).show();
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
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir().join("Snip"));
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| cache_dir.join("data"));
            let launch = state::file_arg(std::env::args()).map(|f| {
                std::fs::canonicalize(&f)
                    .map(|p| {
                        // Sacamos el prefijo \\?\ que agrega canonicalize en Windows.
                        let s = p.to_string_lossy().into_owned();
                        s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
                    })
                    .unwrap_or(f)
            });
            let st = AppState::new(state::resolve_tools(), cache_dir, data_dir, launch);

            let window = app.get_webview_window("main").expect("ventana principal");
            window.create_overlay_titlebar()?;
            let material = system::apply_material(&window);
            if let Ok(mut m) = st.material.lock() {
                *m = material.to_string();
            }
            app.manage(st);

            // Cola de exportación: corre en segundo plano, de a un trabajo.
            let h_exec = app.handle().clone();
            let h_list = app.handle().clone();
            let h_fin = app.handle().clone();
            let queue = ExportQueue::start(
                Arc::new(move |job, ctl, progress| {
                    let st = h_exec.state::<AppState>();
                    let heavy = st.heavy_dir();
                    let temp = st.temp_dir();
                    let env = ExportEnv { tools: &st.tools, encoder: st.encoder(), heavy_dir: &heavy, temp_dir: &temp };
                    export_project(&env, job, ctl, |p| progress(p), |failed| st.mark_encoder_failed(failed))
                }),
                Arc::new(move |items| {
                    let _ = h_list.emit("queue-updated", QueueEvent { items });
                }),
                Arc::new(move |item| {
                    if let ItemStatus::Done { outcome } = &item.status {
                        let st = h_fin.state::<AppState>();
                        if item.job.window.is_none() {
                            let _ = st.store.mark_exported(&item.project_id, snip_core::project_export::now_ms());
                        }
                        commands::allow_asset(&h_fin, std::path::Path::new(&outcome.output));
                    }
                    notify_finished(&h_fin, item);
                }),
            );
            let _ = app.state::<AppState>().queue.set(queue);

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

            // En segundo plano: limpiar cachés viejas y detectar el encoder, así
            // el panel de exportación ya sabe cuál se va a usar.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let st = handle.state::<AppState>();
                st.cleanup_caches();
                let _ = st.encoder();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::take_launch_file,
            commands::show_main_window,
            commands::get_appearance,
            commands::open_media,
            commands::probe_media,
            commands::allow_project_media,
            commands::get_keyframes,
            commands::request_thumbnails,
            commands::get_waveform,
            commands::analyze_loudness,
            commands::create_preview_proxy,
            commands::cancel_proxy,
            commands::prepare_clip,
            commands::cancel_prepare,
            commands::get_encoder,
            commands::platform_limits,
            commands::default_output_path,
            commands::enqueue_export,
            commands::export_queue,
            commands::cancel_export_item,
            commands::reorder_export_item,
            commands::remove_export_item,
            commands::autosave_project,
            commands::save_project_thumbnail,
            commands::list_unfinished,
            commands::load_autosave,
            commands::discard_project,
            commands::mark_project_exported,
            commands::recent_files,
            commands::add_recent_file,
            commands::remove_recent_file,
            commands::open_snip,
            commands::save_snip,
            commands::save_png,
            commands::files_exist,
            commands::reveal_in_folder,
            commands::open_in_default_app,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Snip");
}
