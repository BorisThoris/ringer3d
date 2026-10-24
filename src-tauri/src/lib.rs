/// Desktop shell for Ringer 3D. The whole game is the web build in ../dist; this just hosts it
/// in a native window using the system webview.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Ringer 3D");
}
