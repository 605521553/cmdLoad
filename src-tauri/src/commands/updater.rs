use serde::Serialize;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfiguration {
    pub current_version: String,
    /// First configured updater endpoint. Never contains credentials.
    pub endpoint: Option<String>,
    /// False while the repository still ships the `your-org` placeholder.
    pub configured: bool,
    pub pubkey_configured: bool,
}

/// Report the build-time updater configuration so the UI can avoid claiming
/// "up to date" when the release channel has not been configured yet.
#[tauri::command]
pub fn get_update_configuration<R: Runtime>(app: AppHandle<R>) -> UpdateConfiguration {
    let updater = app.config().plugins.0.get("updater");
    let endpoint = updater
        .and_then(|value| value.get("endpoints"))
        .and_then(|value| value.as_array())
        .and_then(|values| values.first())
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    let pubkey_configured = updater
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty());
    let configured = endpoint
        .as_deref()
        .is_some_and(|value| !value.contains("your-org") && !value.contains("example.com"))
        && pubkey_configured;

    UpdateConfiguration {
        current_version: env!("CARGO_PKG_VERSION").to_owned(),
        endpoint,
        configured,
        pubkey_configured,
    }
}
