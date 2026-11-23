use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AutostartError {
    #[error("无法更新开机自启动设置：{0}")]
    Apply(String),
    #[error("无法读取开机自启动状态：{0}")]
    Read(String),
}

pub fn is_enabled(app: &AppHandle) -> Result<bool, AutostartError> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| AutostartError::Read(error.to_string()))
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), AutostartError> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| AutostartError::Apply(error.to_string()))
}
