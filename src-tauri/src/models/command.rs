use serde::{Deserialize, Serialize};

use crate::models::ai::AiAnnotation;
use crate::models::prompt::{ExportPrompt, ExportPromptCategory};

pub const SUPPORTED_SHELLS: [&str; 7] =
    ["powershell", "cmd", "bash", "sh", "zsh", "other", "unknown"];
pub const COMMAND_EXPORT_SCHEMA_VERSION: u32 = 4;
pub const MIN_SUPPORTED_COMMAND_EXPORT_SCHEMA: u32 = 1;

pub const COMMAND_SOURCE_MANUAL: &str = "manual";
pub const COMMAND_SOURCE_CLIPBOARD_CURRENT: &str = "clipboard_current";
pub const COMMAND_SOURCE_CLIPBOARD_HISTORY: &str = "clipboard_history";
pub const COMMAND_SOURCE_IMPORT: &str = "import";

pub fn is_supported_command_source(value: &str) -> bool {
    matches!(
        value,
        COMMAND_SOURCE_MANUAL
            | COMMAND_SOURCE_CLIPBOARD_CURRENT
            | COMMAND_SOURCE_CLIPBOARD_HISTORY
            | COMMAND_SOURCE_IMPORT
    )
}

fn default_shell() -> String {
    "unknown".to_owned()
}

fn default_import_source() -> String {
    COMMAND_SOURCE_IMPORT.to_owned()
}

fn default_ai_status() -> String {
    "none".to_owned()
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandFilter {
    #[default]
    All,
    Recent,
    Favorites,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandSort {
    #[default]
    Manual,
    Recent,
    Updated,
    Title,
    MostUsed,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandQuery {
    pub search: String,
    pub filter: CommandFilter,
    pub sort: CommandSort,
    pub category_id: Option<String>,
    #[serde(default)]
    pub unclassified_only: bool,
    pub tag_id: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandInput {
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_shell")]
    pub shell: String,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSummary {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: String,
    pub shell: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    /// Resolved appearance of the owning category, so every command view can
    /// render the same category badge without a second query.
    pub category_color: Option<String>,
    pub category_icon_name: Option<String>,
    /// Custom background tint. `use_category_color` takes precedence when set.
    pub background_color: Option<String>,
    pub use_category_color: bool,
    pub tags: Vec<TagSummary>,
    pub source_type: String,
    pub ai_annotation_status: String,
    pub content_hash: String,
    pub ai_annotation: Option<AiAnnotation>,
    pub is_favorite: bool,
    pub sort_order: i64,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryNode {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub command_count: i64,
    pub color: Option<String>,
    pub icon_name: Option<String>,
    pub children: Vec<CategoryNode>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryInput {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryPatch {
    pub name: Option<String>,
    pub parent_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CategoryAppearanceInput {
    pub color: Option<String>,
    pub icon_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub command_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
    pub command_count: i64,
    pub favorite_count: i64,
    pub category_count: i64,
    pub tag_count: i64,
    pub recent_commands: Vec<Command>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOutcome {
    pub copied_count: usize,
    pub usage_recorded: bool,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCategory {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportTag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportCommand {
    pub id: String,
    pub title: String,
    pub command: String,
    pub description: String,
    pub shell: String,
    pub category_id: Option<String>,
    pub tags: Vec<String>,
    #[serde(default = "default_import_source")]
    pub source_type: String,
    #[serde(default = "default_ai_status")]
    pub ai_annotation_status: String,
    pub is_favorite: bool,
    pub sort_order: i64,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Older schema 1/2 files omit appearance fields; they import as defaults.
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub use_category_color: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportApplication {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportEnvelope {
    pub schema_version: u32,
    pub exported_at: i64,
    pub application: ExportApplication,
    pub categories: Vec<ExportCategory>,
    pub tags: Vec<ExportTag>,
    pub commands: Vec<ExportCommand>,
    /// Prompt data is versioned together with commands but stays a separate
    /// domain. Older schema 1–3 files omit these fields and import as `None`,
    /// which leaves the existing prompt library untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_categories: Option<Vec<ExportPromptCategory>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompts: Option<Vec<ExportPrompt>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Merge,
    Replace,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub mode: ImportMode,
    pub categories_added: usize,
    pub tags_added: usize,
    pub commands_added: usize,
    pub commands_skipped: usize,
    pub prompt_categories_added: usize,
    pub prompts_added: usize,
    pub prompts_skipped: usize,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPlacement {
    pub id: String,
    pub category_id: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveCommandsResult {
    pub moved: usize,
    pub previous: Vec<CommandPlacement>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CategoryCommandAction {
    MoveToParent,
    Unclassified,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CategoryChildAction {
    Promote,
    DeleteSubtree,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryDeleteOptions {
    pub command_action: CategoryCommandAction,
    pub child_action: CategoryChildAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDeleteReport {
    pub moved_commands: usize,
    pub deleted_categories: usize,
    pub target_category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub commands: usize,
    pub categories: usize,
    pub tags: usize,
    pub prompts: usize,
    pub prompt_categories: usize,
    pub pre_restore_backup: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataChangedPayload {
    pub revision: u64,
}
