mod client;
mod credentials;
mod prompt;
mod repository;

#[cfg(test)]
mod repository_tests;

use parking_lot::Mutex;

use crate::{
    models::{
        ai::{
            AiAnnotationDraft, AiAnnotationParameter, AiConnectionConfig, AiConnectionTestConfig,
            GeneratedAiAnnotation, AI_DEFAULT_PROVIDER, AI_MAX_TIMEOUT_SECONDS,
            AI_MIN_TIMEOUT_SECONDS, AI_PROMPT_VERSION,
        },
        settings::AppSettings,
    },
    services::{
        clipboard::{content_hash, is_sensitive_text},
        database::Database,
    },
};

pub use client::{generate_annotation, test_connection, validate_base_url, AiError};
pub use credentials::{delete_api_key, has_api_key, save_api_key};

pub struct AiService<'a> {
    database: &'a Database,
}

#[derive(Debug, Clone)]
pub struct AiCommandState {
    pub id: String,
    pub command: String,
    pub title: String,
    pub description: String,
    pub shell: String,
    pub status: String,
    pub has_annotation: bool,
}

impl<'a> AiService<'a> {
    pub fn new(database: &'a Database) -> Self {
        Self { database }
    }

    pub fn connection_config(&self, settings: &AppSettings) -> Result<AiConnectionConfig, AiError> {
        let api_key = credentials::read_api_key()?.ok_or_else(|| {
            AiError::NotConfigured("尚未在 Windows 凭据管理器中保存 API Key。".to_owned())
        })?;
        connection_config_with_key(settings, api_key)
    }

    pub fn test_config(
        &self,
        settings: &AppSettings,
        input: &AiConnectionTestConfig,
    ) -> Result<AiConnectionConfig, AiError> {
        let base_url = validate_base_url(&input.base_url).map_err(AiError::InvalidConfig)?;
        let model = input.model.trim();
        if model.is_empty() || model.chars().count() > 120 {
            return Err(AiError::InvalidConfig("模型名称无效。".to_owned()));
        }
        let api_key = match input.api_key.as_deref().map(str::trim) {
            Some(key) if !key.is_empty() => {
                if !credentials::is_valid_api_key(key) {
                    return Err(AiError::InvalidConfig("API Key 格式无效。".to_owned()));
                }
                key.to_owned()
            }
            _ => credentials::read_api_key()?
                .ok_or_else(|| AiError::NotConfigured("尚未保存 API Key。".to_owned()))?,
        };
        Ok(AiConnectionConfig {
            provider: settings.ai_provider.clone(),
            base_url,
            model: model.to_owned(),
            timeout_seconds: input
                .timeout_seconds
                .clamp(AI_MIN_TIMEOUT_SECONDS, AI_MAX_TIMEOUT_SECONDS),
            temperature: settings.ai_temperature,
            api_key,
        })
    }
}

fn connection_config_with_key(
    settings: &AppSettings,
    api_key: String,
) -> Result<AiConnectionConfig, AiError> {
    let base_url = validate_base_url(&settings.ai_base_url).map_err(AiError::InvalidConfig)?;
    if settings.ai_model.trim().is_empty() {
        return Err(AiError::NotConfigured("尚未填写模型名称。".to_owned()));
    }
    if api_key.trim().is_empty() {
        return Err(AiError::NotConfigured(
            "尚未在 Windows 凭据管理器中保存 API Key。".to_owned(),
        ));
    }
    if !credentials::is_valid_api_key(&api_key) {
        return Err(AiError::InvalidConfig("API Key 格式无效。".to_owned()));
    }
    Ok(AiConnectionConfig {
        provider: if settings.ai_provider.trim().is_empty() {
            AI_DEFAULT_PROVIDER.to_owned()
        } else {
            settings.ai_provider.clone()
        },
        base_url,
        model: settings.ai_model.trim().to_owned(),
        timeout_seconds: settings
            .ai_timeout_seconds
            .clamp(AI_MIN_TIMEOUT_SECONDS, AI_MAX_TIMEOUT_SECONDS),
        temperature: settings.ai_temperature,
        api_key,
    })
}

pub fn command_has_manual_annotation(title: &str, command: &str, description: &str) -> bool {
    if !description.trim().is_empty() {
        return true;
    }
    let title_key = normalize_annotation_text(title);
    if title_key.is_empty() {
        return false;
    }
    let command_lines = command
        .lines()
        .map(normalize_annotation_text)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if command_lines.contains(&title_key) {
        return false;
    }
    if let Some(stem) = title_key.strip_suffix('…') {
        if stem.chars().count() >= 20 && command_lines.iter().any(|line| line.starts_with(stem)) {
            return false;
        }
    }
    true
}

fn normalize_annotation_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Validate and normalize model output. Length limits are deliberately generous
/// for display but still prevent an unusable, unbounded response from reaching
/// the database.
pub fn normalize_draft(mut draft: AiAnnotationDraft) -> Result<AiAnnotationDraft, AiError> {
    draft.short_description = draft
        .short_description
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if draft.short_description.chars().count() > 160 {
        draft.short_description = truncate(&draft.short_description, 160);
    }
    if draft.short_description.is_empty() {
        return Err(AiError::EmptyAnnotation);
    }
    draft.detailed_description = draft.detailed_description.trim().to_owned();
    if draft.detailed_description.chars().count() > 4_000 {
        draft.detailed_description = truncate(&draft.detailed_description, 4_000);
    }
    if draft.detailed_description.is_empty() {
        return Err(AiError::EmptyAnnotation);
    }

    draft.parameters = draft
        .parameters
        .into_iter()
        .filter_map(|parameter| {
            let name = parameter.name.trim();
            if name.is_empty() {
                return None;
            }
            Some(AiAnnotationParameter {
                name: truncate(name, 80),
                description: truncate(parameter.description.trim(), 300),
            })
        })
        .take(24)
        .collect();

    draft.requirements = normalize_string_list(draft.requirements, 12, 300);
    draft.warnings = normalize_string_list(draft.warnings, 12, 300);
    draft.suggested_shell = crate::models::ai::normalize_suggested_shell(&draft.suggested_shell);
    draft.risk_level = crate::models::ai::normalize_risk_level(&draft.risk_level);
    Ok(draft)
}

fn normalize_string_list(values: Vec<String>, limit: usize, max_chars: usize) -> Vec<String> {
    let mut output = Vec::new();
    for value in values {
        let trimmed = value.split_whitespace().collect::<Vec<_>>().join(" ");
        if trimmed.is_empty() {
            continue;
        }
        let item = truncate(&trimmed, max_chars);
        if !output.contains(&item) {
            output.push(item);
        }
        if output.len() >= limit {
            break;
        }
    }
    output
}

fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let mut result = value
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    result.push('…');
    result
}

pub fn generated_annotation(
    state: &AiCommandState,
    config: &AiConnectionConfig,
    draft: AiAnnotationDraft,
    generated_at: i64,
) -> GeneratedAiAnnotation {
    GeneratedAiAnnotation {
        command_id: state.id.clone(),
        command_content_hash: content_hash(&state.command),
        provider: config.provider.clone(),
        model: config.model.clone(),
        prompt_version: AI_PROMPT_VERSION.to_owned(),
        generated_at,
        annotation: draft,
    }
}

pub fn should_auto_annotate(
    settings: &AppSettings,
    state: &AiCommandState,
    key_configured: bool,
) -> bool {
    settings.ai_auto_annotation
        && key_configured
        && state.status != "ready"
        && state.status != "pending"
        && !state.has_annotation
        && !command_has_manual_annotation(&state.title, &state.command, &state.description)
        && !is_sensitive_text(&state.command)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Tracks one-shot cancellation channels for in-flight AI requests. Entries are
/// keyed by the frontend-generated request id, so a stale cancel cannot affect a
/// newer request.
#[derive(Default)]
pub struct AiRequestCancellation {
    pending: Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}
impl AiRequestCancellation {
    pub fn register(&self, request_id: &str) -> tokio::sync::oneshot::Receiver<()> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.pending.lock().insert(request_id.to_owned(), sender);
        receiver
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let sender = self.pending.lock().remove(request_id);
        match sender {
            Some(sender) => {
                let _ = sender.send(());
                true
            }
            None => false,
        }
    }

    pub fn finish(&self, request_id: &str) {
        self.pending.lock().remove(request_id);
    }
}

/// Prevents two generations for the same command from running at once. The
/// guard is released on drop, including cancellation and error paths.
#[derive(Default)]
pub struct AiCommandLocks {
    in_flight: Mutex<std::collections::HashSet<String>>,
}

pub struct AiCommandLock<'a> {
    locks: &'a AiCommandLocks,
    command_id: String,
}

impl AiCommandLocks {
    pub fn try_begin(&self, command_id: &str) -> Option<AiCommandLock<'_>> {
        let mut in_flight = self.in_flight.lock();
        if !in_flight.insert(command_id.to_owned()) {
            return None;
        }
        Some(AiCommandLock {
            locks: self,
            command_id: command_id.to_owned(),
        })
    }

    pub fn is_busy(&self, command_id: &str) -> bool {
        self.in_flight.lock().contains(command_id)
    }
}

impl Drop for AiCommandLock<'_> {
    fn drop(&mut self) {
        self.locks.in_flight.lock().remove(&self.command_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_annotation_detection_matches_command_first_ui() {
        assert!(!command_has_manual_annotation(
            "docker ps -a",
            "docker ps -a",
            ""
        ));
        let long_line = "Get-Process | Select-Object -First 5";
        let truncated = format!("{}…", &long_line[..25]);
        assert!(!command_has_manual_annotation(&truncated, long_line, ""));
        assert!(command_has_manual_annotation(
            "查看所有容器",
            "docker ps -a",
            ""
        ));
        assert!(command_has_manual_annotation(
            "docker ps -a",
            "docker ps -a",
            "手写说明"
        ));
        assert!(!command_has_manual_annotation("", "docker ps -a", ""));
    }

    #[test]
    fn generated_output_is_normalized_and_capped() {
        let draft = AiAnnotationDraft {
            short_description: "  查看   所有 Docker 容器  ".to_owned(),
            detailed_description: "  列出 Docker 环境中的全部容器。  ".to_owned(),
            parameters: vec![
                AiAnnotationParameter {
                    name: " -a ".to_owned(),
                    description: " 显示所有容器 ".to_owned(),
                },
                AiAnnotationParameter {
                    name: "".to_owned(),
                    description: "ignored".to_owned(),
                },
            ],
            requirements: vec![" 已安装 Docker ".to_owned(), "".to_owned()],
            warnings: vec![],
            suggested_shell: "PowerShell".to_owned(),
            risk_level: "LOW".to_owned(),
        };
        let normalized = normalize_draft(draft).expect("normalize");
        assert_eq!(normalized.short_description, "查看 所有 Docker 容器");
        assert_eq!(normalized.parameters.len(), 1);
        assert_eq!(normalized.parameters[0].name, "-a");
        assert_eq!(normalized.requirements, vec!["已安装 Docker"]);
        assert_eq!(normalized.suggested_shell, "powershell");
        assert_eq!(normalized.risk_level, "low");
    }

    #[test]
    fn empty_generated_output_is_rejected() {
        let draft = AiAnnotationDraft {
            short_description: " ".to_owned(),
            detailed_description: "说明".to_owned(),
            ..AiAnnotationDraft::default()
        };
        assert!(matches!(
            normalize_draft(draft),
            Err(AiError::EmptyAnnotation)
        ));
    }

    #[test]
    fn auto_annotation_skips_manual_ai_and_sensitive_commands() {
        let mut settings = AppSettings {
            ai_auto_annotation: true,
            ..AppSettings::default()
        };
        let mut state = AiCommandState {
            id: "c1".to_owned(),
            command: "docker ps -a".to_owned(),
            title: "查看所有容器".to_owned(),
            description: String::new(),
            shell: "bash".to_owned(),
            status: "none".to_owned(),
            has_annotation: false,
        };
        assert!(!should_auto_annotate(&settings, &state, true));
        state.title = "docker ps -a".to_owned();
        state.description.clear();
        state.command = "password=hunter2".to_owned();
        assert!(!should_auto_annotate(&settings, &state, true));
        state.command = "docker ps -a".to_owned();
        assert!(should_auto_annotate(&settings, &state, true));
        state.has_annotation = true;
        assert!(!should_auto_annotate(&settings, &state, true));
        settings.ai_auto_annotation = false;
        state.has_annotation = false;
        assert!(!should_auto_annotate(&settings, &state, true));
    }

    #[test]
    fn cancellation_only_affects_the_matching_request() {
        let cancellation = AiRequestCancellation::default();
        let mut first = cancellation.register("first");
        assert!(cancellation.cancel("first"));
        assert!(first.try_recv().is_ok());
        assert!(!cancellation.cancel("first"));
        let _second = cancellation.register("second");
        cancellation.finish("second");
        assert!(!cancellation.cancel("second"));
    }

    #[test]
    fn command_lock_prevents_duplicate_generation_and_releases_on_drop() {
        let locks = AiCommandLocks::default();
        let first = locks.try_begin("command-1").expect("first lock");
        assert!(locks.is_busy("command-1"));
        assert!(locks.try_begin("command-1").is_none());
        let other = locks.try_begin("command-2").expect("different command");
        drop(other);
        drop(first);
        assert!(!locks.is_busy("command-1"));
        assert!(locks.try_begin("command-1").is_some());
    }
}
