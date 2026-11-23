use tauri::{AppHandle, Emitter, State};

use crate::{
    error::CommandError,
    models::{
        command::{
            CategoryAppearanceInput, CategoryDeleteOptions, CategoryInput, CategoryPatch,
            CopyOutcome, DataChangedPayload, Tag,
        },
        prompt::{
            MovePromptsResult, Prompt, PromptCategoryDeleteReport, PromptCategoryNode, PromptInput,
            PromptPlacement, PromptQuery, SavePromptResult,
        },
    },
    services::prompts::PromptService,
    state::AppState,
};

pub const PROMPTS_CHANGED_EVENT: &str = "data://prompts-changed";

pub(crate) fn notify_prompts_changed(app: &AppHandle, state: &AppState) {
    let revision = state.bump_prompt_revision();
    let _ = app.emit(PROMPTS_CHANGED_EVENT, DataChangedPayload { revision });
}

#[tauri::command]
pub fn list_prompts(
    query: Option<PromptQuery>,
    state: State<'_, AppState>,
) -> Result<Vec<Prompt>, CommandError> {
    let query = query.unwrap_or_default();
    PromptService::new(state.database())
        .list_prompts(&query)
        .map_err(CommandError::prompts)
}

#[tauri::command]
pub fn get_prompt_library_summary(
    state: State<'_, AppState>,
) -> Result<crate::models::prompt::PromptLibrarySummary, CommandError> {
    PromptService::new(state.database())
        .library_summary()
        .map_err(CommandError::prompts)
}

#[tauri::command]
pub fn get_prompt(id: String, state: State<'_, AppState>) -> Result<Prompt, CommandError> {
    PromptService::new(state.database())
        .get_prompt(&id)
        .map_err(CommandError::prompts)
}

#[tauri::command]
pub fn create_prompt(
    input: PromptInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Prompt, CommandError> {
    let prompt = PromptService::new(state.database())
        .create_prompt(input)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(prompt)
}

#[tauri::command]
pub fn update_prompt(
    id: String,
    input: PromptInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Prompt, CommandError> {
    let prompt = PromptService::new(state.database())
        .update_prompt(&id, input)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(prompt)
}

#[tauri::command]
pub fn delete_prompt(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    PromptService::new(state.database())
        .delete_prompt(&id)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn toggle_prompt_favorite(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Prompt, CommandError> {
    let prompt = PromptService::new(state.database())
        .toggle_favorite(&id)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(prompt)
}

#[tauri::command]
pub fn copy_prompts(
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CopyOutcome, CommandError> {
    // Same self-copy suppression as commands: the clipboard monitor must not
    // treat the app's own copy as new external clipboard content.
    state.suppress_clipboard_capture(std::time::Duration::from_millis(1500));
    let outcome = PromptService::new(state.database())
        .copy_prompts(&ids)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(outcome)
}

#[tauri::command]
pub fn reorder_prompts(
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    PromptService::new(state.database())
        .reorder_prompts(&ids)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn move_prompts_to_category(
    ids: Vec<String>,
    category_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<MovePromptsResult, CommandError> {
    let result = PromptService::new(state.database())
        .move_prompts_to_category(&ids, category_id.as_deref())
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(result)
}

#[tauri::command]
pub fn restore_prompt_placements(
    placements: Vec<PromptPlacement>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, CommandError> {
    let changed = PromptService::new(state.database())
        .restore_prompt_placements(&placements)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(changed)
}

#[tauri::command]
pub fn set_prompts_color(
    ids: Vec<String>,
    color: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, CommandError> {
    let changed = PromptService::new(state.database())
        .set_prompts_color(&ids, color.as_deref())
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(changed)
}

#[tauri::command]
pub fn list_prompt_categories(
    state: State<'_, AppState>,
) -> Result<Vec<PromptCategoryNode>, CommandError> {
    PromptService::new(state.database())
        .list_categories()
        .map_err(CommandError::prompts)
}

#[tauri::command]
pub fn create_prompt_category(
    input: CategoryInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    let id = PromptService::new(state.database())
        .create_category(input)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(id)
}

#[tauri::command]
pub fn update_prompt_category(
    id: String,
    patch: CategoryPatch,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    PromptService::new(state.database())
        .update_category(&id, patch)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn delete_prompt_category_with_options(
    id: String,
    options: CategoryDeleteOptions,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PromptCategoryDeleteReport, CommandError> {
    let report = PromptService::new(state.database())
        .delete_category_with_options(&id, &options)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(report)
}

#[tauri::command]
pub fn reorder_prompt_categories(
    parent_id: Option<String>,
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    PromptService::new(state.database())
        .reorder_categories(parent_id.as_deref(), &ids)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn set_prompt_category_appearance(
    id: String,
    appearance: CategoryAppearanceInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    PromptService::new(state.database())
        .set_category_appearance(&id, appearance)
        .map_err(CommandError::prompts)?;
    notify_prompts_changed(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn list_prompt_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, CommandError> {
    PromptService::new(state.database())
        .list_tags()
        .map_err(CommandError::prompts)
}

#[tauri::command]
pub fn save_clipboard_as_prompt(
    content: String,
    allow_sensitive: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SavePromptResult, CommandError> {
    let result = PromptService::new(state.database())
        .save_clipboard_text(&content, allow_sensitive)
        .map_err(CommandError::prompts)?;
    if result.created {
        notify_prompts_changed(&app, &state);
    }
    Ok(result)
}
