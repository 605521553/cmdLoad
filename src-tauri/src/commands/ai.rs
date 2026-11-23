use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::future::{select, Either};
use tauri::{AppHandle, Manager, State};

use crate::{
    commands::app::build_snapshot,
    commands::library::notify_data_changed,
    error::CommandError,
    models::{
        ai::{
            AiConnectionTestConfig, AiConnectionTestResult, GeneratedAiAnnotation,
            SaveAiAnnotationInput, AI_PROMPT_VERSION,
        },
        app::AppSnapshot,
        command::Command,
    },
    services::{
        ai::{
            delete_api_key, generate_annotation, generated_annotation, has_api_key,
            normalize_draft, save_api_key, test_connection, AiError, AiService,
        },
        clipboard::is_sensitive_text,
        library::LibraryService,
    },
    state::AppState,
};

#[tauri::command]
pub fn save_ai_api_key(
    api_key: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSnapshot, CommandError> {
    save_api_key(&api_key).map_err(|error| CommandError::ai(AiError::Credential(error)))?;
    Ok(build_snapshot(&app, state.inner()))
}

#[tauri::command]
pub fn clear_ai_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSnapshot, CommandError> {
    delete_api_key().map_err(|error| CommandError::ai(AiError::Credential(error)))?;
    Ok(build_snapshot(&app, state.inner()))
}

#[tauri::command]
pub async fn test_ai_connection(
    input: AiConnectionTestConfig,
    state: State<'_, AppState>,
) -> Result<AiConnectionTestResult, CommandError> {
    let settings = state.settings();
    let config = AiService::new(state.database())
        .test_config(&settings, &input)
        .map_err(CommandError::ai)?;
    let (model, latency_ms) = test_connection(&config).await.map_err(CommandError::ai)?;
    Ok(AiConnectionTestResult { model, latency_ms })
}

#[tauri::command]
pub fn check_ai_command_sensitivity(
    command_id: String,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    let command = AiService::new(state.database())
        .command_state(&command_id)
        .map_err(CommandError::ai)?;
    Ok(is_sensitive_text(&command.command))
}

#[tauri::command]
pub async fn generate_ai_annotation(
    command_id: String,
    request_id: String,
    allow_sensitive: bool,
    state: State<'_, AppState>,
) -> Result<GeneratedAiAnnotation, CommandError> {
    validate_request_id(&request_id)?;
    let service = AiService::new(state.database());
    let command = service
        .command_state(&command_id)
        .map_err(CommandError::ai)?;
    if command.status == "pending" {
        return Err(CommandError::new(
            "AI_BUSY",
            "该命令正在生成 AI 注释，请等待完成后再试。",
        ));
    }
    run_generation(state.inner(), &command_id, &request_id, allow_sensitive)
        .await
        .map_err(CommandError::ai)
}

#[tauri::command]
pub fn cancel_ai_request(request_id: String, state: State<'_, AppState>) -> bool {
    state.ai_requests.cancel(&request_id)
}

#[tauri::command]
pub fn save_ai_annotation(
    input: SaveAiAnnotationInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Command, CommandError> {
    let annotation = AiService::new(state.database())
        .save_generated(input)
        .map_err(CommandError::ai)?;
    let command = LibraryService::new(state.database())
        .get_command(&annotation.command_id)
        .map_err(CommandError::library)?;
    notify_data_changed(&app, &state);
    Ok(command)
}

pub(crate) async fn run_generation(
    state: &AppState,
    command_id: &str,
    request_id: &str,
    allow_sensitive: bool,
) -> Result<GeneratedAiAnnotation, AiError> {
    let service = AiService::new(state.database());
    let command = service.command_state(command_id)?;
    if is_sensitive_text(&command.command) && !allow_sensitive {
        return Err(AiError::SensitiveBlocked);
    }
    // The front-end guards repeated clicks within one mounted view. This lock
    // also covers mode switches, batch, and auto-annotation racing on the same
    // command, and is released on every return/cancel path.
    let _command_lock = state
        .ai_command_locks
        .try_begin(command_id)
        .ok_or(AiError::Busy)?;
    let config = service.connection_config(&state.settings())?;
    let cancellation = state.ai_requests.register(request_id);
    let generation =
        generate_annotation(&config, &command.command, &command.shell, AI_PROMPT_VERSION);
    let result = match select(Box::pin(generation), cancellation).await {
        Either::Left((result, _)) => result,
        Either::Right((_, _)) => Err(AiError::Cancelled),
    };
    state.ai_requests.finish(request_id);
    let draft = normalize_draft(result?)?;
    Ok(generated_annotation(&command, &config, draft, now_millis()))
}

fn validate_request_id(request_id: &str) -> Result<(), CommandError> {
    if request_id.trim().is_empty() || request_id.chars().count() > 120 {
        return Err(CommandError::new("AI_INVALID_REQUEST", "AI 请求标识无效。"));
    }
    Ok(())
}

/// Start background annotation after a clipboard save. The caller has already
/// committed the command, so no AI failure can lose it. This function performs
/// only local checks and a status write; the network request is spawned.
pub(crate) fn maybe_start_auto_annotation(app: &AppHandle, command_id: &str) {
    let state = app.state::<AppState>();
    let settings = state.settings();
    if !settings.ai_auto_annotation {
        return;
    }
    let key_configured = has_api_key().unwrap_or(false);
    if !key_configured {
        return;
    }
    let service = AiService::new(state.database());
    let Ok(command) = service.command_state(command_id) else {
        return;
    };
    if !crate::services::ai::should_auto_annotate(&settings, &command, key_configured) {
        return;
    }
    // Validate configuration locally before showing a pending state.
    if service.connection_config(&settings).is_err() {
        return;
    }
    // A user-triggered quick generation may be in flight. Do not start an
    // automatic one on the same command and contend for the same status.
    if state.ai_command_locks.is_busy(command_id) {
        return;
    }
    if service.mark_status(command_id, "pending").is_err() {
        return;
    }

    let app = app.clone();
    let command_id = command_id.to_owned();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let request_id = format!("auto-{}", uuid::Uuid::new_v4());
        let result = run_generation(&state, &command_id, &request_id, false).await;
        let status = match result {
            Ok(generated) => {
                let input = SaveAiAnnotationInput {
                    generated,
                    manual_mode: crate::models::ai::ManualAnnotationMode::Keep,
                };
                match AiService::new(state.database()).save_generated(input) {
                    Ok(_) => "ready",
                    Err(_) => "failed",
                }
            }
            Err(_) => "failed",
        };
        let _ = AiService::new(state.database()).mark_status(&command_id, status);
        notify_data_changed(&app, &state);
    });
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
