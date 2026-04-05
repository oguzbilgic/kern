#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::{Emitter, Manager};

#[tauri::command]
fn navigate_to(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    // Use eval to navigate in the same window — bypasses JS-level interception
    window
        .eval(&format!("window.location.replace('{}')", url.replace('\'', "\\'")))
        .map_err(|e| format!("Navigation failed: {}", e))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![navigate_to])
        .setup(|app| {
            let main_window = app.get_webview_window("main").unwrap();

            // Allow navigation to any URL (local and external)
            main_window.on_navigation(|url| {
                // Allow all URLs — we trust the connect screen to validate
                let _ = url;
                true
            });

            main_window.open_devtools();

            let logout = MenuItem::with_id(app, "logout", "Logout", true, None::<&str>)?;
            let reconnect =
                MenuItem::with_id(app, "reconnect", "Reconnect…", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
            let open_browser =
                MenuItem::with_id(app, "open_browser", "Open in Browser", true, None::<&str>)?;
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
                            window.__TAURI_INTERNALS__?.invoke('plugin:opener|open_url', { url: window.location.href });
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
