use tauri::{AppHandle, Emitter, State};

use crate::{
    commands::{ai::maybe_start_auto_annotation, library::notify_data_changed},
    error::CommandError,
    models::clipboard::{
        ClearClipboardHistoryResult, ClipboardChangedPayload, ClipboardState, ClipboardStatus,
        SaveClipboardInput, SaveClipboardResult, SystemClipboardHistory,
    },
    services::{
        clipboard::{
            read_system_history, ClipboardHistoryService, SystemHistoryRead, SystemHistoryText,
        },
        library::LibraryService,
    },
    state::AppState,
};

pub const CLIPBOARD_CHANGED_EVENT: &str = "clipboard://changed";

fn notify_clipboard_changed(app: &AppHandle, state: &AppState) {
    let revision = state.bump_clipboard_revision();
    let _ = app.emit(
        CLIPBOARD_CHANGED_EVENT,
        ClipboardChangedPayload { revision },
    );
}

#[tauri::command]
pub fn get_clipboard_state(state: State<'_, AppState>) -> Result<ClipboardState, CommandError> {
    let settings = state.settings();
    let service = ClipboardHistoryService::new(state.database());
    let _ = service.prune(
        settings.clipboard_history_limit,
        settings.clipboard_history_retention_days,
    );
    service
        .snapshot(
            settings.clipboard_monitoring_enabled,
            state.clipboard_monitor_warning(),
        )
        .map_err(CommandError::library)
}

#[tauri::command]
pub async fn get_system_clipboard_history(
    state: State<'_, AppState>,
) -> Result<SystemClipboardHistory, CommandError> {
    let read = tauri::async_runtime::spawn_blocking(read_system_history)
        .await
        .map_err(|error| {
            CommandError::new(
                "CLIPBOARD_HISTORY_ERROR",
                format!("Windows 剪贴板历史线程异常：{error}"),
            )
        })?;
    decorate_system_history(state.inner(), read).map_err(CommandError::library)
}

#[tauri::command]
pub async fn get_clipboard_status(
    state: State<'_, AppState>,
) -> Result<ClipboardStatus, CommandError> {
    let settings = state.settings();
    let read = tauri::async_runtime::spawn_blocking(read_system_history)
        .await
        .map_err(|error| {
            CommandError::new(
                "CLIPBOARD_HISTORY_ERROR",
                format!("Windows 剪贴板历史线程异常：{error}"),
            )
        })?;
    let count = ClipboardHistoryService::new(state.database())
        .count()
        .map_err(CommandError::library)?;
    Ok(ClipboardStatus {
        system_history_enabled: read.enabled,
        system_history_status: read.status,
        system_history_message: read.message,
        local_history_count: count,
        local_history_enabled: settings.clipboard_monitoring_enabled,
        monitor_warning: state.clipboard_monitor_warning(),
    })
}

fn decorate_system_history(
    state: &AppState,
    read: SystemHistoryRead,
) -> Result<SystemClipboardHistory, crate::services::library::LibraryError> {
    let texts = read
        .items
        .into_iter()
        .map(
            |SystemHistoryText {
                 content,
                 copied_at,
                 is_sensitive,
             }| (content, copied_at, is_sensitive),
        )
        .collect::<Vec<_>>();
    let items = ClipboardHistoryService::new(state.database()).decorate_system_texts(texts)?;
    Ok(SystemClipboardHistory {
        status: read.status,
        enabled: read.enabled,
        items,
        message: read.message,
    })
}

#[tauri::command]
pub fn save_clipboard_text(
    input: SaveClipboardInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SaveClipboardResult, CommandError> {
    let result = LibraryService::new(state.database())
        .save_clipboard_text(&input.content, input.source, input.allow_sensitive)
        .map_err(CommandError::library)?;
    if result.created {
        // Local status updates only; the network call is detached so saving and
        // copying are never delayed by the AI provider.
        maybe_start_auto_annotation(&app, &result.command.id);
    }
    notify_data_changed(&app, &state);
    notify_clipboard_changed(&app, &state);
    Ok(result)
}

#[tauri::command]
pub fn copy_clipboard_text(
    content: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    state.suppress_clipboard_capture(std::time::Duration::from_millis(1500));
    LibraryService::new(state.database())
        .copy_text_to_clipboard(&content)
        .map_err(CommandError::library)?;
    notify_clipboard_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn clear_clipboard_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ClearClipboardHistoryResult, CommandError> {
    let removed = ClipboardHistoryService::new(state.database())
        .clear()
        .map_err(CommandError::library)?;
    notify_clipboard_changed(&app, &state);
    Ok(ClearClipboardHistoryResult { removed })
}
