mod commands;
mod error;
mod models;
mod services;
mod state;

use std::fs;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use commands::settings::initialize_shortcut;
use services::{database::Database, settings::SettingsRepository, tray, window as window_service};
use state::AppState;

pub fn run() {
    let builder = tauri::Builder::default()
        // The single-instance plugin must be registered before every other plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if app.try_state::<AppState>().is_none() {
                return;
            }
            if let Err(error) = window_service::show_current_mode(app) {
                window_service::emit_runtime_error(app, error.to_string());
            }
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--autostart")
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if app.try_state::<AppState>().is_none() {
                        return;
                    }
                    if let Err(error) = window_service::toggle_quick_panel(app) {
                        window_service::emit_runtime_error(app, error.to_string());
                    }
                })
                .build(),
        )
        // Release updates are verified with the minisign public key in
        // tauri.conf.json and installed by the NSIS updater package. The
        // process plugin only provides the final relaunch on non-Windows
        // fallbacks; on Windows the installer restarts the app itself.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            initialize_app(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let Some(main_window) = window.app_handle().get_webview_window("main") else {
                return;
            };
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window_service::handle_close_requested(&main_window) {
                        api.prevent_close();
                    }
                }
                WindowEvent::Focused(true) => {
                    window_service::handle_focus_gained(&main_window);
                }
                WindowEvent::Focused(false) => {
                    window_service::handle_focus_lost(&main_window);
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    window_service::schedule_bounds_save(&main_window);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_snapshot,
            commands::app::quit_app,
            commands::settings::update_settings,
            commands::ai::save_ai_api_key,
            commands::ai::clear_ai_api_key,
            commands::ai::test_ai_connection,
            commands::ai::check_ai_command_sensitivity,
            commands::ai::generate_ai_annotation,
            commands::ai::cancel_ai_request,
            commands::ai::save_ai_annotation,
            commands::window::set_ui_mode,
            commands::window::hide_main_window,
            commands::window::start_window_drag,
            commands::library::list_commands,
            commands::library::get_library_summary,
            commands::library::get_command,
            commands::library::create_command,
            commands::library::update_command,
            commands::library::delete_command,
            commands::library::toggle_command_favorite,
            commands::library::copy_commands,
            commands::library::reorder_commands,
            commands::library::move_commands_to_category,
            commands::library::restore_command_placements,
            commands::library::reorder_categories,
            commands::library::list_categories,
            commands::library::create_category,
            commands::library::update_category,
            commands::library::delete_category,
            commands::library::delete_category_with_options,
            commands::library::set_commands_color,
            commands::library::set_commands_follow_category_color,
            commands::library::set_category_appearance,
            commands::library::list_tags,
            commands::library::export_library_json,
            commands::library::export_library_file,
            commands::library::import_library_json,
            commands::library::create_database_backup,
            commands::library::list_database_backups,
            commands::library::restore_database_backup,
            commands::prompts::list_prompts,
            commands::prompts::get_prompt_library_summary,
            commands::prompts::get_prompt,
            commands::prompts::create_prompt,
            commands::prompts::update_prompt,
            commands::prompts::delete_prompt,
            commands::prompts::toggle_prompt_favorite,
            commands::prompts::copy_prompts,
            commands::prompts::reorder_prompts,
            commands::prompts::move_prompts_to_category,
            commands::prompts::restore_prompt_placements,
            commands::prompts::set_prompts_color,
            commands::prompts::list_prompt_categories,
            commands::prompts::create_prompt_category,
            commands::prompts::update_prompt_category,
            commands::prompts::delete_prompt_category_with_options,
            commands::prompts::reorder_prompt_categories,
            commands::prompts::set_prompt_category_appearance,
            commands::prompts::list_prompt_tags,
            commands::prompts::save_clipboard_as_prompt,
            commands::updater::get_update_configuration,
            commands::clipboard::get_clipboard_state,
            commands::clipboard::get_system_clipboard_history,
            commands::clipboard::get_clipboard_status,
            commands::clipboard::save_clipboard_text,
            commands::clipboard::copy_clipboard_text,
            commands::clipboard::clear_clipboard_history,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build Pata Commands");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            // Best-effort final geometry capture when the process is asked to
            // exit by the OS rather than through an application command.
            if let Ok(window) = window_service::main_window(app_handle) {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let settings = state.settings();
                    if window.is_visible().unwrap_or(false) {
                        if let (Ok(position), Ok(size)) =
                            (window.outer_position(), window.inner_size())
                        {
                            let mut updated = settings;
                            updated.set_bounds_for(
                                state.mode(),
                                Some(models::settings::WindowBounds {
                                    x: position.x,
                                    y: position.y,
                                    width: size.width,
                                    height: size.height,
                                }),
                            );
                            let _ = state.persist_settings(updated);
                        }
                    }
                }
            }
        }
    });
}

fn initialize_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = app.path().app_config_dir()?;
    fs::create_dir_all(&config_dir)?;
    let repository = SettingsRepository::new(config_dir.join("settings.json"));
    let loaded = repository.load();
    let mut warning = loaded.warning;

    if loaded.is_first_run || loaded.migrated {
        if let Err(error) = repository.save(&loaded.settings) {
            warning = Some(format!(
                "无法写入设置文件，应用将继续使用内存中的设置。（{error}）"
            ));
        }
    }

    let data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&data_dir)?;
    let database_path = data_dir.join("commands.db");
    let database = match Database::open_or_recover(database_path.clone()) {
        Ok(database) => database,
        Err(error) => {
            show_fatal_database_error(&format!(
                "命令数据库无法打开。\n\n{error}\n\n路径：{}\n\n原始数据库和迁移前备份均未被删除，请先复制保存后再处理。",
                database_path.display()
            ));
            return Err(error.into());
        }
    };
    let database_warning = database.warning;
    let state = AppState::new(
        repository,
        loaded.settings,
        warning,
        database.database,
        database_warning,
    );
    app.manage(state);

    // A previous process may have exited while an automatic annotation request
    // was in flight. Such rows stay `pending` on disk; convert them to a
    // retryable failed state before the UI loads.
    {
        let state = app.state::<AppState>();
        let _ = services::ai::AiService::new(state.database()).recover_interrupted();
    }

    let app_handle = app.handle().clone();
    {
        let state = app.state::<AppState>();
        initialize_shortcut(&app_handle, &state);
    }

    {
        let state = app.state::<AppState>();
        let settings = state.settings();
        let _ = services::clipboard::ClipboardHistoryService::new(state.database()).prune(
            settings.clipboard_history_limit,
            settings.clipboard_history_retention_days,
        );
    }

    if let Err(error) = services::clipboard::start_clipboard_monitor(app_handle.clone()) {
        app.state::<AppState>()
            .set_clipboard_monitor_warning(Some(error));
    }

    tray::create_tray(&app_handle)?;

    let start_hidden = std::env::args().any(|argument| argument == "--autostart");
    window_service::prepare_main_window(&app_handle, start_hidden)?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn show_fatal_database_error(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    let message = message
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let caption = "Pata Commands · 数据库错误"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn show_fatal_database_error(message: &str) {
    eprintln!("{message}");
}
