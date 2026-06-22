use tauri::{
    Emitter,
    Manager,
    PhysicalPosition,
    PhysicalSize,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[cfg(windows)]
mod win32 {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        WM_NCHITTEST,
        HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT,
        HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT,
        HTCLIENT,
    };

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        let result = unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };

        if msg == WM_NCHITTEST {
            let hit = result.0 as u32;
            let is_resize_edge = matches!(
                hit,
                HTLEFT | HTRIGHT | HTTOP | HTBOTTOM
                    | HTTOPLEFT | HTTOPRIGHT | HTBOTTOMLEFT | HTBOTTOMRIGHT
            );
            if is_resize_edge {
                return LRESULT(HTCLIENT as isize);
            }
        }

        result
    }

    pub fn disable_resize_edges(window: &tauri::WebviewWindow) -> Result<(), String> {
        let handle = window.window_handle().map_err(|e| e.to_string())?;
        let RawWindowHandle::Win32(win32_handle) = handle.as_raw() else {
            return Err("not a Win32 window handle".to_string());
        };
        let hwnd = HWND(win32_handle.hwnd.get() as *mut _);

        let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), 1, 0) };
        if ok.as_bool() {
            Ok(())
        } else {
            Err("SetWindowSubclass failed".to_string())
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Tauri commands exposed to the frontend
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn get_cursor_position(window: tauri::Window) -> Result<(f64, f64), String> {
    window
        .cursor_position()
        .map(|pos| (pos.x, pos.y))
        .map_err(|e| e.to_string())
}

fn fit_main_window_to_monitor(app: &tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let monitor = win
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No primary monitor detected".to_string())?;

    let size: &PhysicalSize<u32> = monitor.size();
    let position: &PhysicalPosition<i32> = monitor.position();

    win.set_position(tauri::Position::Physical(*position))
        .map_err(|e| e.to_string())?;
    win.set_size(tauri::Size::Physical(*size))
        .map_err(|e| e.to_string())?;

    Ok(())
}

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
        .invoke_handler(tauri::generate_handler![
            open_ui_window,
            get_cursor_position,
        ])
        .setup(|app| {
            build_tray(app)?;

            let handle = app.handle().clone();
            if let Err(e) = fit_main_window_to_monitor(&handle) {
                eprintln!("[frieren] Failed to fit main window to monitor: {e}");
            }

            #[cfg(windows)]
            if let Some(main_win) = app.get_webview_window("main") {
                if let Err(e) = win32::disable_resize_edges(&main_win) {
                    eprintln!("[frieren] Failed to disable resize edges: {e}");
                }
            }

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