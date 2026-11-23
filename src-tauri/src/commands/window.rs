use tauri::AppHandle;

use crate::{error::CommandError, models::settings::UiMode};

#[tauri::command]
pub fn set_ui_mode(app: AppHandle, mode: UiMode) -> Result<(), CommandError> {
    crate::services::window::present_mode(&app, mode).map_err(CommandError::window)
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), CommandError> {
    crate::services::window::hide_window(&app).map_err(CommandError::window)
}

#[tauri::command]
pub fn start_window_drag(app: AppHandle) -> Result<(), CommandError> {
    crate::services::window::start_window_drag(&app).map_err(CommandError::window)
}
