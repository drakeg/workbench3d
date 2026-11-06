//! Desktop shell for Workbench3D. The modeler itself is the web app in `../src`;
//! this hosts it in a native window and adds what only a desktop app can do:
//! file dialogs, remembering the window, and opening .wb3d files from Finder/Explorer.

use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

/// Files the OS asked us to open before the page was ready to receive them.
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Called by the page once any unsaved changes have been dealt with.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn queue_or_emit(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<OpenedFiles>() {
        state.0.lock().unwrap().extend(paths.iter().cloned());
    }
    // a page that's already running opens them straight away
    let _ = app.emit("open-files", paths);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows and Linux pass files to open as arguments ("Open with", double-click)
    let from_args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".wb3d"))
        .collect();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(OpenedFiles(Mutex::new(from_args)))
        .invoke_handler(tauri::generate_handler![take_opened_files, exit_app])
        .build(tauri::generate_context!())
        .expect("error while building Workbench3D");

    app.run(|handle, event| match event {
        // Quit from the Dock or the system: let the page ask about unsaved changes first
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() && handle.get_webview_window("main").is_some() {
                api.prevent_exit();
                let _ = handle.emit("quit-requested", ());
            }
        }
        // macOS: files opened from Finder while starting or running
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            queue_or_emit(handle, paths);
        }
        _ => {}
    });
}
