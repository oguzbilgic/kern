#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::WebviewWindowBuilder;
use tauri::{Emitter, Manager, WebviewUrl};

#[tauri::command]
fn navigate_to(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.eval(&format!("window.location.replace('{}')", url))
            .map_err(|e| format!("eval failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn go_home(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        // Navigate back to the bundled connect screen
        w.eval("window.location.replace('index.html')")
            .map_err(|e| format!("eval failed: {}", e))?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![navigate_to, go_home])
        .setup(|app| {
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("kern")
            .inner_size(1000.0, 700.0)
            .min_inner_size(600.0, 400.0)
            .on_navigation(|_| true) // Allow navigation to external URLs
            .build()?;

            #[cfg(debug_assertions)]
            window.open_devtools();

            // Edit menu — required for Cmd+C/V/X/A to work on macOS
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            // App menu
            let app_menu = Submenu::with_items(
                app,
                "kern",
                true,
                &[
                    &MenuItem::with_id(app, "logout", "Logout", true, None::<&str>)?,
                    &MenuItem::with_id(app, "reconnect", "Reconnect…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?,
                    &MenuItem::with_id(app, "open_browser", "Open in Browser", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            let menu = Menu::with_items(app, &[&app_menu, &edit_menu])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let window = app.get_webview_window("main");
            match event.id().as_ref() {
                "logout" | "reconnect" => {
                    let _ = go_home(app.clone());
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
