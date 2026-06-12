use tauri::{
    Emitter,
    Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

// ─────────────────────────────────────────────────────────────
// Tauri commands exposed to the frontend
// ─────────────────────────────────────────────────────────────

/// Open (or focus) the Settings/UI window.
/// Called from the avatar window's gear button.
#[tauri::command]
fn open_ui_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("ui") {
        win.show().ok();
        win.set_focus().ok();
        return;
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "ui",
        tauri::WebviewUrl::App("ui.html".into()),
    )
    .title("Frieren Desktop — Settings")
    .inner_size(460.0, 580.0)
    .min_inner_size(360.0, 480.0)
    .resizable(true)
    .decorations(true)
    .always_on_top(false)
    .center()
    .build()
    .ok();
}

// ─────────────────────────────────────────────────────────────
// App bootstrap
// ─────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![open_ui_window])
        .setup(|app| {
            build_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Frieren Desktop");
}

// ─────────────────────────────────────────────────────────────
// System tray
// ─────────────────────────────────────────────────────────────

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item    = MenuItemBuilder::with_id("show",    "Show Avatar").build(app)?;
    let settings_item = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
    let passive_item = MenuItemBuilder::with_id("toggle_passive", "Toggle Passive Mode").build(app)?;
    let quit_item    = MenuItemBuilder::with_id("quit",    "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &settings_item, &passive_item, &quit_item])
        .build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Frieren Desktop")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    win.show().ok();
                    win.set_focus().ok();
                }
            }
            "settings" => {
                open_ui_window(app.clone());
            }
            "toggle_passive" => {
                if let Some(win) = app.get_webview_window("main") {
                    win.emit("frieren:toggle-passive", ()).ok();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click on tray icon = show/hide avatar
            if let TrayIconEvent::Click {
                button:       MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        win.hide().ok();
                    } else {
                        win.show().ok();
                        win.set_focus().ok();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
