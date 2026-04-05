#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            
            let logout = MenuItem::with_id(app, "logout", "Logout", true, None::<&str>)?;
            let reconnect = MenuItem::with_id(app, "reconnect", "Reconnect…", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
            let open_browser = MenuItem::with_id(app, "open_browser", "Open in Browser", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&logout, &reconnect, &reload, &open_browser])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let window = app.get_webview_window("main");
            match event.id().as_ref() {
                "logout" => {
                    if let Some(window) = window {
                        let _ = window.eval(
                            r#"
                            localStorage.removeItem('kern_servers');
                            window.location.href = 'index.html';
                            "#,
                        );
                    }
                }
                "reconnect" => {
                    if let Some(window) = window {
                        let _ = window.eval("window.location.href = 'index.html';");
                    }
                }
                "reload" => {
                    if let Some(window) = window {
                        let _ = window.eval("window.location.reload();");
                    }
                }
                "open_browser" => {
                    if let Some(window) = window {
                        let _ = window.eval(
                            r#"
                            const saved = JSON.parse(localStorage.getItem('kern_servers') || '[]');
                            if (saved[0]?.url && saved[0]?.token) {
                              window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: saved[0].url + '?token=' + encodeURIComponent(saved[0].token) });
                            }
                            "#,
                        );
                    }
                }
                _ => {}
            }
            let _ = app.emit("desktop-menu", event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
