#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::webview::WebviewWindowBuilder;
use tauri::{Emitter, Manager};

#[tauri::command]
fn navigate_to(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Create the new window FIRST (before closing old one, so app never has 0 windows)
    WebviewWindowBuilder::new(&app, "app", tauri::WebviewUrl::External(
        url.parse().map_err(|e| format!("Invalid URL: {}", e))?
    ))
    .title("kern")
    .inner_size(1000.0, 700.0)
    .min_inner_size(600.0, 400.0)
    .build()
    .map_err(|e| format!("Failed to open window: {}", e))?;

    // Now close the connect screen
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.close();
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![navigate_to])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

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
            // Menu events target the "app" window (remote UI) if it exists
            let app_window = app.get_webview_window("app");
            match event.id().as_ref() {
                "logout" => {
                    // Close the remote window, reopen the connect screen
                    if let Some(win) = app_window {
                        let _ = win.close();
                    }
                    let _ = WebviewWindowBuilder::new(
                        app,
                        "main",
                        tauri::WebviewUrl::App("index.html".into()),
                    )
                    .title("kern")
                    .inner_size(1000.0, 700.0)
                    .min_inner_size(600.0, 400.0)
                    .build();
                }
                "reconnect" => {
                    if let Some(win) = app_window {
                        let _ = win.close();
                    }
                    let _ = WebviewWindowBuilder::new(
                        app,
                        "main",
                        tauri::WebviewUrl::App("index.html".into()),
                    )
                    .title("kern")
                    .inner_size(1000.0, 700.0)
                    .min_inner_size(600.0, 400.0)
                    .build();
                }
                "reload" => {
                    if let Some(win) = app_window {
                        let _ = win.eval("window.location.reload();");
                    }
                }
                "open_browser" => {
                    if let Some(win) = app_window {
                        let _ = win.eval(
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
