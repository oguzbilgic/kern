#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::WebviewWindowBuilder;
use tauri::tray::TrayIconEvent;
use tauri::{Emitter, Manager, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_URL: &str = "https://app.kern-ai.com";

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) {
    let _ = app.opener().open_url(&url, None::<&str>);
}

#[tauri::command]
fn set_custom_url(app: tauri::AppHandle, url: String) {
    let u = if url.is_empty() { None } else { Some(url.as_str()) };
    write_custom_url(&app, u);
}

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("no app config dir");
    fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

fn read_custom_url(app: &tauri::AppHandle) -> Option<String> {
    let path = config_path(app);
    let data = fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&data).ok()?;
    json.get("url").and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn write_custom_url(app: &tauri::AppHandle, url: Option<&str>) {
    let path = config_path(app);
    let json = match url {
        Some(u) => serde_json::json!({ "url": u }),
        None => serde_json::json!({}),
    };
    fs::write(path, serde_json::to_string_pretty(&json).unwrap()).ok();
}

fn get_start_url(app: &tauri::AppHandle) -> String {
    read_custom_url(app).unwrap_or_else(|| DEFAULT_URL.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_custom_url, open_external])
        .setup(|app| {
            let start_url = get_start_url(app.handle());
            let handle = app.handle().clone();

            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("kern")
            .inner_size(1000.0, 700.0)
            .min_inner_size(600.0, 400.0)
            .on_navigation(move |_url| {
                // Allow all navigations in WebView — external link interception
                // is handled by the click listener in on_page_load instead
                true
            })
            .on_page_load(move |w, _payload| {
                // Redirect local page to target server URL
                let url = if let Some(custom) = read_custom_url(w.app_handle()) {
                    custom
                } else {
                    DEFAULT_URL.to_string()
                };
                let current_url = w.url().map(|u| u.to_string()).unwrap_or_default();
                if current_url.starts_with("tauri://") {
                    let _ = w.eval(&format!("window.location.replace('{}');", url));
                }

                // Intercept external links — open in system browser (deduplicated)
                w.eval(r#"
                    if (!window.__kern_link_handler) {
                        window.__kern_link_handler = true;
                        document.addEventListener('click', function(e) {
                            var a = e.target.closest('a[href]');
                            if (!a) return;
                            var href = a.href;
                            if (!href || href.startsWith('javascript:')) return;
                            var url = new URL(href, window.location.href);
                            if (url.origin === window.location.origin) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (window.__TAURI_INTERNALS__) {
                                window.__TAURI_INTERNALS__.invoke('open_external', { url: href });
                            }
                        }, true);
                    }
                "#).ok();
            })
            .disable_drag_drop_handler()
            .build()?;

            #[cfg(debug_assertions)]
            window.open_devtools();

            // Edit menu
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
                    &MenuItem::with_id(app, "custom_server", "Custom Server…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "reset_server", &format!("Reset to {}", DEFAULT_URL), true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
                    &MenuItem::with_id(app, "open_browser", "Open in Browser", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            // Agent switching shortcuts
            let mut agent_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
            for i in 1..=9u32 {
                let item = MenuItem::with_id(
                    app,
                    &format!("switch_agent_{}", i),
                    &format!("Agent {}", i),
                    true,
                    Some(&format!("CmdOrCtrl+{}", i)),
                )?;
                agent_items.push(item);
            }
            let agent_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
                agent_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
            let agents_menu = Submenu::with_items(app, "Agents", true, &agent_refs)?;

            let menu = Menu::with_items(app, &[&app_menu, &edit_menu, &agents_menu])?;
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
                                    + '<div style="color:#8b949e;font-size:13px;margin-bottom:16px">Version 0.3.1</div>'
                                    + '<div style="color:#8b949e;font-size:12px;margin-bottom:16px">AI agent runtime</div>'
                                    + '<a href="https://kern-ai.com" style="color:#fcd53a;font-size:12px;text-decoration:none">kern-ai.com</a>'
                                    + '<div style="margin-top:20px"><button onclick="this.closest(\'#kern-about-overlay\').remove()" style="background:#2a2a2c;color:#e6edf3;border:none;padding:6px 20px;border-radius:6px;font-size:13px;cursor:pointer">OK</button></div>'
                                    + '</div>';
                                document.body.appendChild(o);
                            })();
                        "#);
                    }
                }
                "custom_server" => {
                    if let Some(w) = &window {
                        let current = read_custom_url(app).unwrap_or_default();
                        let _ = w.eval(&format!(r#"
                            (function() {{
                                if (document.getElementById('kern-server-overlay')) return;
                                var o = document.createElement('div');
                                o.id = 'kern-server-overlay';
                                o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(4px)';
                                o.onclick = function(e) {{ if(e.target===o) o.remove(); }};
                                o.innerHTML = '<div style="background:#1c1c1e;border:1px solid #2a2a2c;border-radius:16px;padding:32px 40px;text-align:center;min-width:340px">'
                                    + '<div style="font-size:18px;font-weight:600;color:#e6edf3;margin-bottom:4px">Custom Server</div>'
                                    + '<div style="color:#8b949e;font-size:12px;margin-bottom:16px">Enter a self-hosted kern web URL</div>'
                                    + '<input id="kern-custom-url" type="url" value="{}" placeholder="http://100.115.98.30:8080" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #2a2a2c;background:#161617;color:#e6edf3;font-size:14px;outline:none;margin-bottom:16px" />'
                                    + '<div style="display:flex;gap:8px;justify-content:center">'
                                    + '<button onclick="this.closest(\'#kern-server-overlay\').remove()" style="background:#2a2a2c;color:#e6edf3;border:none;padding:8px 20px;border-radius:8px;font-size:13px;cursor:pointer">Cancel</button>'
                                    + '<button id="kern-custom-save" style="background:#fcd53a;color:#161617;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Connect</button>'
                                    + '</div></div>';
                                document.body.appendChild(o);
                                var inp = document.getElementById('kern-custom-url');
                                inp.focus(); inp.select();
                                document.getElementById('kern-custom-save').onclick = function() {{
                                    var url = inp.value.trim().replace(/\/+$/, '');
                                    if (!url) return;
                                    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
                                    if(window.__TAURI_INTERNALS__) window.__TAURI_INTERNALS__.invoke('set_custom_url', {{ url: url }});
                                    window.location.replace(url);
                                }};
                                inp.addEventListener('keydown', function(e) {{ if(e.key==='Enter') document.getElementById('kern-custom-save').click(); }});
                            }})();
                        "#, current));
                    }
                }
                "reset_server" => {
                    write_custom_url(app, None);
                    if let Some(w) = &window {
                        let _ = w.eval(&format!("window.location.replace('{}');", DEFAULT_URL));
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
                            "window.__TAURI_INTERNALS__?.invoke('open_external', { url: window.location.href });",
                        );
                    }
                }
                id if id.starts_with("switch_agent_") => {
                    if let Ok(n) = id.strip_prefix("switch_agent_").unwrap_or("0").parse::<usize>() {
                        if let Some(w) = window {
                            let _ = w.eval(&format!(
                                "if(window.KernBridge)window.KernBridge.switchAgent({});",
                                n - 1
                            ));
                        }
                    }
                }
                _ => {}
            }
            let _ = app.emit("desktop-menu", event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
