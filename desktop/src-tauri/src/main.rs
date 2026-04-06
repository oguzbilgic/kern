#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::webview::WebviewWindowBuilder;
use tauri::{Emitter, Manager, Url, WebviewUrl};

#[tauri::command]
fn navigate_to(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    // Close existing main window
    if let Some(old) = app.get_webview_window("main") {
        let _ = old.close();
    }

    // Create a new window pointing to the external URL
    WebviewWindowBuilder::new(
        &app,
        "main",
        WebviewUrl::External(parsed),
    )
    .title("kern")
    .inner_size(1000.0, 700.0)
    .min_inner_size(600.0, 400.0)
    .build()
    .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(())
}

#[tauri::command]
fn go_home(app: tauri::AppHandle) -> Result<(), String> {
    // Close existing main window
    if let Some(old) = app.get_webview_window("main") {
        let _ = old.close();
    }

    // Recreate with bundled connect screen
    WebviewWindowBuilder::new(
        &app,
        "main",
        WebviewUrl::App("index.html".into()),
    )
    .title("kern")
    .inner_size(1000.0, 700.0)
    .min_inner_size(600.0, 400.0)
    .build()
    .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![navigate_to, go_home])
        .setup(|app| {
            let _window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("kern")
            .inner_size(1000.0, 700.0)
            .min_inner_size(600.0, 400.0)
            .build()?;

            #[cfg(debug_assertions)]
            _window.open_devtools();

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
            match event.id().as_ref() {
                "logout" | "reconnect" => {
                    let _ = go_home(app.clone());
                }
                "reload" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.eval("window.location.reload();");
                    }
                }
                "open_browser" => {
                    if let Some(w) = app.get_webview_window("main") {
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
