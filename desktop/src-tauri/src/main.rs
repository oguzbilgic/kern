#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::WebviewWindowBuilder;
use tauri::tray::TrayIconEvent;
use tauri::{Emitter, Manager, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

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
        w.eval("window.location.replace('tauri://localhost/index.html')")
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
            .on_navigation(|_| true)
            .disable_drag_drop_handler() // Let browser handle HTML5 drag-and-drop
            .build()?;

            // Intercept external link clicks → open in system browser
            window.eval(r#"
                document.addEventListener('click', function(e) {
                    var a = e.target.closest('a');
                    if (a && a.href && a.href.startsWith('https://')) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.__TAURI_INTERNALS__?.invoke('plugin:opener|open_url', { url: a.href });
                    }
                }, true);
            "#).ok();

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
                    &MenuItem::with_id(app, "about", "About kern", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "logout", "Logout", true, None::<&str>)?,
                    &MenuItem::with_id(app, "reconnect", "Reconnect…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
                    &MenuItem::with_id(app, "open_browser", "Open in Browser", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            let menu = Menu::with_items(app, &[&app_menu, &edit_menu])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| {
            let window = app.get_webview_window("main");
            match event.id().as_ref() {
                "about" => {
                    if let Some(w) = &window {
                        let _ = w.eval(r#"
                            (function() {
                                if (document.getElementById('kern-about-overlay')) return;
                                var o = document.createElement('div');
                                o.id = 'kern-about-overlay';
                                o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(4px)';
                                o.onclick = function(e) { if(e.target===o) o.remove(); };
                                o.innerHTML = '<div style="background:#1c1c1e;border:1px solid #2a2a2c;border-radius:16px;padding:32px 40px;text-align:center;min-width:280px">'
                                    + '<div style="font-size:28px;font-weight:700;color:#e6edf3;margin-bottom:4px">kern<span style="color:#fcd53a">.</span></div>'
                                    + '<div style="color:#8b949e;font-size:13px;margin-bottom:16px">Version 0.1.0</div>'
                                    + '<div style="color:#8b949e;font-size:12px;margin-bottom:16px">AI agent runtime</div>'
                                    + '<a href="https://kern-ai.com" style="color:#fcd53a;font-size:12px;text-decoration:none">kern-ai.com</a>'
                                    + '<div style="margin-top:20px"><button onclick="this.closest(\'#kern-about-overlay\').remove()" style="background:#2a2a2c;color:#e6edf3;border:none;padding:6px 20px;border-radius:6px;font-size:13px;cursor:pointer">OK</button></div>'
                                    + '</div>';
                                document.body.appendChild(o);
                            })();
                        "#);
                    }
                }
                "logout" => {
                    // Set flag to skip auto-reconnect, keep saved servers
                    if let Some(w) = &window {
                        let _ = w.eval("sessionStorage.setItem('kern_auto_failed', '1');");
                    }
                    let _ = go_home(app.clone());
                }
                "reconnect" => {
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
