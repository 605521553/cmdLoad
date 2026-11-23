use serde::{Deserialize, Serialize};

pub const AI_PROMPT_VERSION: &str = "annotation-v1";
pub const AI_DEFAULT_PROVIDER: &str = "deepseek";
pub const AI_DEFAULT_BASE_URL: &str = "https://api.deepseek.com/v1";
pub const AI_DEFAULT_MODEL: &str = "deepseek-chat";
pub const AI_DEFAULT_TIMEOUT_SECONDS: u32 = 30;
pub const AI_MAX_TIMEOUT_SECONDS: u32 = 120;
pub const AI_MIN_TIMEOUT_SECONDS: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAnnotationParameter {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiAnnotationDraft {
    // The prompt asks for camelCase, but the documented response example uses
    // snake_case. Accept both so a compatible provider cannot break generation
    // merely by choosing the other spelling.
    #[serde(alias = "short_description")]
    pub short_description: String,
    #[serde(default, alias = "detailed_description")]
    pub detailed_description: String,
    #[serde(default)]
    pub parameters: Vec<AiAnnotationParameter>,
    #[serde(default)]
    pub requirements: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default = "default_suggested_shell", alias = "suggested_shell")]
    pub suggested_shell: String,
    #[serde(default = "default_risk_level", alias = "risk_level")]
    pub risk_level: String,
}

fn default_suggested_shell() -> String {
    "unknown".to_owned()
}

fn default_risk_level() -> String {
    "unknown".to_owned()
}

/// A validated generation result returned by Rust. Field validation and
/// normalization happen in the AI service; the frontend only edits display
/// content and cannot alter command text through this payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedAiAnnotation {
    pub command_id: String,
    pub command_content_hash: String,
    pub provider: String,
    pub model: String,
    pub prompt_version: String,
    pub generated_at: i64,
    #[serde(flatten)]
    pub annotation: AiAnnotationDraft,
}

/// Persisted AI annotation. Manual `title`/`description` live on the command and
/// remain separate from this row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAnnotation {
    pub id: String,
    pub command_id: String,
    pub short_description: String,
    pub detailed_description: String,
    pub parameters: Vec<AiAnnotationParameter>,
    pub requirements: Vec<String>,
    pub warnings: Vec<String>,
    pub suggested_shell: String,
    pub risk_level: String,
    pub provider: String,
    pub model: String,
    pub prompt_version: String,
    pub command_content_hash: String,
    pub generated_at: i64,
    pub updated_at: i64,
    pub is_stale: bool,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ManualAnnotationMode {
    /// Keep handwritten annotations and store the AI result separately.
    #[default]
    Keep,
    /// Keep the handwritten text and append a clearly labelled AI explanation.
    Append,
    /// Replace handwritten annotations with the confirmed AI text.
    Replace,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAiAnnotationInput {
    pub generated: GeneratedAiAnnotation,
    #[serde(default)]
    pub manual_mode: ManualAnnotationMode,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestConfig {
    pub base_url: String,
    pub model: String,
    pub timeout_seconds: u32,
    /// Present only when the user explicitly tests a new, unsaved key. It is
    /// never logged or returned to the frontend.
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResult {
    pub model: String,
    pub latency_ms: u64,
}

#[derive(Clone, PartialEq)]
pub struct AiConnectionConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub timeout_seconds: u32,
    pub temperature: Option<f32>,
    pub api_key: String,
}

impl std::fmt::Debug for AiConnectionConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AiConnectionConfig")
            .field("provider", &self.provider)
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("timeout_seconds", &self.timeout_seconds)
            .field("temperature", &self.temperature)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

pub fn normalize_suggested_shell(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    match lower.as_str() {
        "powershell" | "pwsh" => "powershell".to_owned(),
        "cmd" | "cmd.exe" | "command prompt" => "cmd".to_owned(),
        "bash" | "git bash" => "bash".to_owned(),
        "sh" | "shell" => "sh".to_owned(),
        "zsh" => "zsh".to_owned(),
        "other" => "other".to_owned(),
        _ => "unknown".to_owned(),
    }
}

pub fn normalize_risk_level(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "low" | "medium" | "high" => value.trim().to_lowercase(),
        _ => "unknown".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_and_risk_values_are_normalized_to_safe_enums() {
        assert_eq!(normalize_suggested_shell("PowerShell"), "powershell");
        assert_eq!(normalize_suggested_shell("pwsh"), "powershell");
        assert_eq!(normalize_suggested_shell("fish"), "unknown");
        assert_eq!(normalize_risk_level("HIGH"), "high");
        assert_eq!(normalize_risk_level("critical"), "unknown");
    }

    #[test]
    fn draft_accepts_both_camel_case_and_snake_case_payloads() {
        let camel: AiAnnotationDraft = serde_json::from_str(
            r#"{
                "shortDescription": "查看所有 Docker 容器",
                "detailedDescription": "列出全部容器。",
                "parameters": [{"name": "-a", "description": "显示全部"}],
                "requirements": ["已安装 Docker"],
                "warnings": [],
                "suggestedShell": "bash",
                "riskLevel": "low"
            }"#,
        )
        .expect("camelCase payload");
        let snake: AiAnnotationDraft = serde_json::from_str(
            r#"{
                "short_description": "查看所有 Docker 容器",
                "detailed_description": "列出全部容器。",
                "parameters": [{"name": "-a", "description": "显示全部"}],
                "requirements": ["已安装 Docker"],
                "warnings": [],
                "suggested_shell": "bash",
                "risk_level": "low"
            }"#,
        )
        .expect("snake_case payload");
        assert_eq!(camel, snake);
        assert_eq!(snake.short_description, "查看所有 Docker 容器");
        assert_eq!(snake.suggested_shell, "bash");
        assert_eq!(snake.risk_level, "low");
    }
}
