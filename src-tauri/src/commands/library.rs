use std::{fs, path::PathBuf};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    error::CommandError,
    models::command::{
        BackupInfo, CategoryAppearanceInput, CategoryDeleteOptions, CategoryDeleteReport,
        CategoryInput, CategoryNode, CategoryPatch, Command, CommandInput, CommandPlacement,
        CommandQuery, CopyOutcome, DataChangedPayload, ImportMode, ImportReport, LibrarySummary,
        MoveCommandsResult, RestoreReport, Tag,
    },
    services::library::LibraryService,
    state::AppState,
};

pub const DATA_CHANGED_EVENT: &str = "data://commands-changed";

pub(crate) fn notify_data_changed(app: &AppHandle, state: &AppState) {
    let revision = state.bump_data_revision();
    let _ = app.emit(DATA_CHANGED_EVENT, DataChangedPayload { revision });
}

#[tauri::command]
pub fn list_commands(
    query: Option<CommandQuery>,
    state: State<'_, AppState>,
) -> Result<Vec<Command>, CommandError> {
    let query = query.unwrap_or_default();
    LibraryService::new(state.database())
        .list_commands(&query)
        .map_err(CommandError::library)
}

#[tauri::command]
pub fn get_library_summary(state: State<'_, AppState>) -> Result<LibrarySummary, CommandError> {
    LibraryService::new(state.database())
        .library_summary()
        .map_err(CommandError::library)
}

#[tauri::command]
pub fn get_command(id: String, state: State<'_, AppState>) -> Result<Command, CommandError> {
    LibraryService::new(state.database())
        .get_command(&id)
        .map_err(CommandError::library)
}

#[tauri::command]
pub fn create_command(
    input: CommandInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Command, CommandError> {
    let command = LibraryService::new(state.database())
        .create_command(input)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(command)
}

#[tauri::command]
pub fn update_command(
    id: String,
    input: CommandInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Command, CommandError> {
    let command = LibraryService::new(state.database())
        .update_command(&id, input)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(command)
}

#[tauri::command]
pub fn delete_command(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    LibraryService::new(state.database())
        .delete_command(&id)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn toggle_command_favorite(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Command, CommandError> {
    let command = LibraryService::new(state.database())
        .toggle_favorite(&id)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(command)
}

#[tauri::command]
pub fn copy_commands(
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CopyOutcome, CommandError> {
    // Mark before writing so the local clipboard listener can distinguish an
    // app-initiated copy from an external copy and avoid a self-copy loop.
    state.suppress_clipboard_capture(std::time::Duration::from_millis(1500));
    let outcome = LibraryService::new(state.database())
        .copy_commands(&ids)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(outcome)
}

#[tauri::command]
pub fn reorder_commands(
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    LibraryService::new(state.database())
        .reorder_commands(&ids)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn move_commands_to_category(
    ids: Vec<String>,
    category_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<MoveCommandsResult, CommandError> {
    let result = LibraryService::new(state.database())
        .move_commands_to_category(&ids, category_id.as_deref())
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(result)
}

#[tauri::command]
pub fn restore_command_placements(
    placements: Vec<CommandPlacement>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, CommandError> {
    let changed = LibraryService::new(state.database())
        .restore_command_placements(&placements)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(changed)
}

#[tauri::command]
pub fn reorder_categories(
    parent_id: Option<String>,
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    LibraryService::new(state.database())
        .reorder_categories(parent_id.as_deref(), &ids)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn list_categories(state: State<'_, AppState>) -> Result<Vec<CategoryNode>, CommandError> {
    LibraryService::new(state.database())
        .list_categories()
        .map_err(CommandError::library)
}

#[tauri::command]
pub fn create_category(
    input: CategoryInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    let id = LibraryService::new(state.database())
        .create_category(input)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(id)
}

#[tauri::command]
pub fn update_category(
    id: String,
    patch: CategoryPatch,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    LibraryService::new(state.database())
        .update_category(&id, patch)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn delete_category(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    LibraryService::new(state.database())
        .delete_category(&id)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn delete_category_with_options(
    id: String,
    options: CategoryDeleteOptions,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CategoryDeleteReport, CommandError> {
    let report = LibraryService::new(state.database())
        .delete_category_with_options(&id, &options)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(report)
}

#[tauri::command]
pub fn set_commands_color(
    ids: Vec<String>,
    color: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, CommandError> {
    let changed = LibraryService::new(state.database())
        .set_commands_color(&ids, color.as_deref())
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(changed)
}

#[tauri::command]
pub fn set_commands_follow_category_color(
    ids: Vec<String>,
    enabled: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, CommandError> {
    let changed = LibraryService::new(state.database())
        .set_commands_follow_category_color(&ids, enabled)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(changed)
}

#[tauri::command]
pub fn set_category_appearance(
    id: String,
    appearance: CategoryAppearanceInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    LibraryService::new(state.database())
        .set_category_appearance(&id, appearance)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, CommandError> {
    LibraryService::new(state.database())
        .list_tags()
        .map_err(CommandError::library)
}

#[tauri::command]
pub fn export_library_json(state: State<'_, AppState>) -> Result<String, CommandError> {
    LibraryService::new(state.database())
        .export_json()
        .map_err(CommandError::library)
}

/// Save the versioned JSON export to a user-visible file. We use the OS
/// Downloads directory because the app does not yet bundle a native save
/// dialog plugin; the returned path is shown to the user.
#[tauri::command]
pub fn export_library_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    let json = LibraryService::new(state.database())
        .export_json()
        .map_err(CommandError::library)?;
    let directory = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir().map(|path| path.join("exports")))
        .map_err(|error| CommandError::new("FILE_ERROR", error.to_string()))?;
    fs::create_dir_all(&directory)
        .map_err(|error| CommandError::new("FILE_ERROR", error.to_string()))?;
    let path: PathBuf = directory.join(format!(
        "pata-commands-export-{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    ));
    fs::write(&path, json).map_err(|error| CommandError::new("FILE_ERROR", error.to_string()))?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn import_library_json(
    json: String,
    mode: ImportMode,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ImportReport, CommandError> {
    let report = LibraryService::new(state.database())
        .import_json(&json, mode)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(report)
}

#[tauri::command]
pub fn create_database_backup(state: State<'_, AppState>) -> Result<BackupInfo, CommandError> {
    LibraryService::new(state.database())
        .create_backup("manual")
        .map_err(CommandError::library)
}

#[tauri::command]
pub fn list_database_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>, CommandError> {
    LibraryService::new(state.database())
        .list_backups()
        .map_err(CommandError::library)
}

#[tauri::command]
pub fn restore_database_backup(
    file_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RestoreReport, CommandError> {
    let report = LibraryService::new(state.database())
        .restore_backup(&file_name)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(report)
}
