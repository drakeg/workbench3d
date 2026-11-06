/// Desktop shell for Workbench3D. The whole modeler is the web app in `../src`;
/// this just hosts it in a native window and grants file dialog/read/write access.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Workbench3D");
}
