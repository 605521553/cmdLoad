use tauri::{AppHandle, State};

use crate::{
    models::app::{AppSnapshot, ShortcutStatus},
    services::autostart,
    state::AppState,
};

pub(crate) fn build_snapshot(app: &AppHandle, state: &AppState) -> AppSnapshot {
    let settings = state.settings();
    let runtime = state.shortcut();
    let autostart_enabled = autostart::is_enabled(app).unwrap_or(settings.launch_at_startup);

    AppSnapshot {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        settings: settings.view(),
        ui_mode: state.mode(),
        shortcut: ShortcutStatus {
            registered: runtime.registered,
            error: runtime.error,
        },
        autostart_enabled,
        ai_api_key_configured: crate::services::ai::has_api_key().unwrap_or(false),
        settings_path: state.settings_path(),
        settings_warning: state.settings_warning(),
        database_path: state.database_path(),
        database_warning: state.database_warning(),
    }
}

#[tauri::command]
pub fn get_app_snapshot(app: AppHandle, state: State<'_, AppState>) -> AppSnapshot {
    build_snapshot(&app, state.inner())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    crate::services::window::quit_application(&app);
}
