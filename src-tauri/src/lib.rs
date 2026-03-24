mod logging;
mod opencode;
mod paths;

use opencode::SharedOpenCodeState;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    let opencode_state: SharedOpenCodeState =
        Arc::new(Mutex::new(opencode::OpenCodeState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(opencode_state)
        .invoke_handler(tauri::generate_handler![opencode::get_opencode_info])
        .setup(|app| {
            // ── Application menu ──────────────────────────────────
            let app_submenu = SubmenuBuilder::new(app, "BloxBot")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .close_window()
                .build()?;

            let debug_toggle = MenuItemBuilder::with_id("debug_opencode_ui", "OpenCode Web UI")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;

            let debug_submenu = SubmenuBuilder::new(app, "Debug")
                .item(&debug_toggle)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .item(&debug_submenu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                if event.id() == debug_toggle.id() {
                    let state = app_handle.state::<SharedOpenCodeState>().inner().clone();
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let port = {
                            let s = state.lock().await;
                            s.port
                        };
                        if port > 0 {
                            let url = format!("http://{}:{}", opencode::LOOPBACK, port);
                            let _ = handle.opener().open_url(&url, None::<&str>);
                        }
                    });
                }
            });

            // ── Updater plugin ────────────────────────────────────
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // ── Start OpenCode, then show window ─────────────────
            // The window stays hidden until OpenCode is alive.
            // If it can't start after retries, exit — there's nothing to show.
            let state = app.state::<SharedOpenCodeState>().inner().clone();
            let handle = app.handle().clone();
            log::info!("BloxBot starting up");
            tauri::async_runtime::spawn(async move {
                match opencode::start_opencode_server(state, handle.clone()).await {
                    Ok(port) => {
                        log::info!("OpenCode ready on port {port}, showing window");
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.show();
                        }
                    }
                    Err(e) => {
                        log::error!("OpenCode failed to start: {e} — exiting");
                        handle.exit(1);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window
                    .app_handle()
                    .state::<SharedOpenCodeState>()
                    .inner()
                    .clone();
                let handle = window.app_handle().clone();
                tauri::async_runtime::block_on(async {
                    opencode::stop_all(&state, &handle).await;
                });
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running BloxBot");
}
