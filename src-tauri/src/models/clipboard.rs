use serde::{Deserialize, Serialize};

use crate::models::command::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardSource {
    Current,
    SystemHistory,
    LocalMonitor,
}

impl ClipboardSource {
    pub fn command_source(self) -> &'static str {
        match self {
            Self::Current => "clipboard_current",
            Self::SystemHistory | Self::LocalMonitor => "clipboard_history",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub key: String,
    pub content: String,
    pub source: ClipboardSource,
    pub copied_at: i64,
    pub is_current: bool,
    pub is_sensitive: bool,
    pub saved_command_id: Option<String>,
    pub saved_command_is_favorite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardState {
    pub current: Option<ClipboardItem>,
    pub local_items: Vec<ClipboardItem>,
    pub local_history_enabled: bool,
    pub local_history_count: i64,
    pub current_error: Option<String>,
    pub monitor_warning: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemHistoryStatus {
    Available,
    Disabled,
    AccessDenied,
    Unsupported,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemClipboardHistory {
    pub status: SystemHistoryStatus,
    pub enabled: bool,
    pub items: Vec<ClipboardItem>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardStatus {
    pub system_history_enabled: bool,
    pub system_history_status: SystemHistoryStatus,
    pub system_history_message: Option<String>,
    pub local_history_count: i64,
    pub local_history_enabled: bool,
    pub monitor_warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveClipboardInput {
    pub content: String,
    pub source: ClipboardSource,
    #[serde(default)]
    pub allow_sensitive: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveClipboardResult {
    pub command: Command,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardChangedPayload {
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearClipboardHistoryResult {
    pub removed: usize,
}
