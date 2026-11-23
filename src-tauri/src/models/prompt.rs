use serde::{Deserialize, Serialize};

use super::command::TagSummary;

/// Prompt content is the only required field. The limit is intentionally large:
/// prompts routinely contain long natural-language instructions, Markdown and
/// fenced code blocks.
pub const MAX_PROMPT_CONTENT_CHARS: usize = 200_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PromptFilter {
    #[default]
    All,
    Recent,
    Favorites,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PromptSort {
    #[default]
    Manual,
    Recent,
    Updated,
    Title,
    MostUsed,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PromptQuery {
    pub search: String,
    pub filter: PromptFilter,
    pub sort: PromptSort,
    pub category_id: Option<String>,
    #[serde(default)]
    pub unclassified_only: bool,
    pub tag_id: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptInput {
    #[serde(default)]
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: String,
    /// Empty when the user did not name the prompt; the UI then shows content.
    pub title: String,
    pub content: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    pub category_icon_name: Option<String>,
    pub background_color: Option<String>,
    pub tags: Vec<TagSummary>,
    pub is_favorite: bool,
    pub sort_order: i64,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCategoryNode {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    /// Number of active prompts directly inside this category.
    pub prompt_count: i64,
    pub color: Option<String>,
    pub icon_name: Option<String>,
    pub children: Vec<PromptCategoryNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCategoryDeleteReport {
    pub moved_prompts: usize,
    pub deleted_categories: usize,
    pub target_category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptLibrarySummary {
    pub prompt_count: i64,
    pub favorite_count: i64,
    pub category_count: i64,
    pub tag_count: i64,
    pub recent_prompts: Vec<Prompt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPlacement {
    pub id: String,
    pub category_id: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePromptsResult {
    pub moved: usize,
    pub previous: Vec<PromptPlacement>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptResult {
    pub prompt: Prompt,
    /// False when strictly identical content (or the same prompt id) already
    /// exists, so the UI can explain the no-op instead of duplicating text.
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPromptCategory {
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
pub struct ExportPrompt {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub content: String,
    pub category_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub is_favorite: bool,
    #[serde(default)]
    pub background_color: Option<String>,
    pub sort_order: i64,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}
