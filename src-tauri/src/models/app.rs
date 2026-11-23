use serde::Serialize;

use crate::models::settings::{SettingsView, UiMode};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub version: String,
    pub settings: SettingsView,
    pub ui_mode: UiMode,
    pub shortcut: ShortcutStatus,
    pub autostart_enabled: bool,
    pub ai_api_key_configured: bool,
    pub settings_path: String,
    pub settings_warning: Option<String>,
    pub database_path: String,
    pub database_warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub registered: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeChangedPayload {
    pub mode: UiMode,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelShownPayload {
    pub mode: UiMode,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigatePayload {
    pub view: ManagerView,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagerView {
    /// Default route in the manager. It is not currently emitted from Rust,
    /// but keeps the native event contract aligned with the frontend router.
    #[allow(dead_code)]
    Overview,
    Settings,
}
