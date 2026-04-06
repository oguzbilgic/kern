#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::webview::WebviewWindowBuilder;
use tauri::{Emitter, Manager, Url};

#[tauri::command]
fn navigate_to(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    window
        .navigate(parsed)
        .map_err(|e| format!("Navigation failed: {}", e))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![navigate_to])
        .setup(|app| {
            // Create window programmatically so we can set on_navigation
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("kern")
            .inner_size(1000.0, 700.0)
            .min_inner_size(600.0, 400.0)
            .on_navigation(|_url| {
                // Allow all URLs — local and external
                true
            })
            .build()?;

            #[cfg(debug_assertions)]
            window.open_devtools();

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
                    if let Some(w) = window {
                        let _ = w.navigate(
                            Url::parse("tauri://localhost/index.html").unwrap(),
                        );
                    }
                }
                "reconnect" => {
                    if let Some(w) = window {
                        let _ = w.navigate(
                            Url::parse("tauri://localhost/index.html").unwrap(),
                        );
                    }
                }
                "reload" => {
                    if let Some(w) = window {
                        let _ = w.eval("window.location.reload();");
                    }
                }
                "open_browser" => {
                    if let Some(w) = window {
                        let _ = w.eval(
                            "window.__TAURI_INTERNALS__?.invoke('plugin:opener|open_url', { url: window.location.href });",
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
