mod repository;

use std::sync::OnceLock;

use thiserror::Error;

use crate::{
    models::{
        appearance::{normalize_optional_color, normalize_optional_icon},
        command::{
            CategoryAppearanceInput, CategoryDeleteOptions, CategoryInput, CategoryPatch,
            CopyOutcome, Tag,
        },
        prompt::{
            MovePromptsResult, Prompt, PromptCategoryDeleteReport, PromptCategoryNode, PromptInput,
            PromptPlacement, PromptQuery, SavePromptResult,
        },
    },
    services::{
        clipboard::{is_sensitive_text, suggest_title, ClipboardWriter, SystemClipboard},
        database::{Database, DatabaseError},
    },
};

use self::repository::PromptRepository;

static SYSTEM_CLIPBOARD: OnceLock<SystemClipboard> = OnceLock::new();

#[derive(Debug, Error)]
pub enum PromptError {
    #[error("{0}")]
    Validation(String),
    #[error("提示词或目录不存在，可能已被删除。")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Clipboard(String),
    #[error("检测到可能的敏感信息。确认后才能保存到提示词库。")]
    SensitiveContent,
    #[error("数据库不可用：{0}")]
    Database(#[from] DatabaseError),
    #[error("数据库操作失败：{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Internal(String),
}

pub struct PromptService<'a> {
    database: &'a Database,
    clipboard: &'a dyn ClipboardWriter,
}

impl<'a> PromptService<'a> {
    pub fn new(database: &'a Database) -> Self {
        let clipboard = SYSTEM_CLIPBOARD.get_or_init(SystemClipboard::default);
        Self {
            database,
            clipboard,
        }
    }

    #[cfg(test)]
    pub fn with_clipboard(database: &'a Database, clipboard: &'a dyn ClipboardWriter) -> Self {
        Self {
            database,
            clipboard,
        }
    }

    pub fn list_prompts(&self, query: &PromptQuery) -> Result<Vec<Prompt>, PromptError> {
        self.database
            .with_connection(|connection| PromptRepository::new(connection).list_prompts(query))
    }

    pub fn library_summary(
        &self,
    ) -> Result<crate::models::prompt::PromptLibrarySummary, PromptError> {
        self.database
            .with_connection(|connection| PromptRepository::new(connection).library_summary())
    }

    pub fn get_prompt(&self, id: &str) -> Result<Prompt, PromptError> {
        self.database
            .with_connection(|connection| PromptRepository::new(connection).get_prompt(id))?
            .ok_or(PromptError::NotFound)
    }

    pub fn create_prompt(&self, input: PromptInput) -> Result<Prompt, PromptError> {
        let input = normalize_prompt_input(input);
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        self.database.with_connection(|connection| {
            let repository = PromptRepository::new(connection);
            if let Some(existing) = repository.find_active_by_content(&input.content)? {
                return Ok(existing);
            }
            repository.create_prompt(&id, &input, now)
        })
    }

    pub fn update_prompt(&self, id: &str, input: PromptInput) -> Result<Prompt, PromptError> {
        let input = normalize_prompt_input(input);
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).update_prompt(id, &input, now)
        })
    }

    pub fn delete_prompt(&self, id: &str) -> Result<(), PromptError> {
        let now = now_millis();
        self.database
            .with_connection(|connection| PromptRepository::new(connection).delete_prompt(id, now))
    }

    pub fn toggle_favorite(&self, id: &str) -> Result<Prompt, PromptError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).toggle_favorite(id, now)
        })
    }

    pub fn reorder_prompts(&self, ids: &[String]) -> Result<(), PromptError> {
        self.database
            .with_connection(|connection| PromptRepository::new(connection).reorder_prompts(ids))
    }

    pub fn move_prompts_to_category(
        &self,
        ids: &[String],
        category_id: Option<&str>,
    ) -> Result<MovePromptsResult, PromptError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).move_prompts_to_category(ids, category_id, now)
        })
    }

    pub fn restore_prompt_placements(
        &self,
        placements: &[PromptPlacement],
    ) -> Result<usize, PromptError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).restore_prompt_placements(placements, now)
        })
    }

    pub fn set_prompts_color(
        &self,
        ids: &[String],
        color: Option<&str>,
    ) -> Result<usize, PromptError> {
        let color = normalize_optional_color(color).map_err(PromptError::Validation)?;
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).set_prompts_color(ids, color.as_deref())
        })
    }

    pub fn list_categories(&self) -> Result<Vec<PromptCategoryNode>, PromptError> {
        self.database
            .with_connection(|connection| PromptRepository::new(connection).list_categories())
    }

    pub fn create_category(&self, input: CategoryInput) -> Result<String, PromptError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).create_category(
                &id,
                &input.name,
                input.parent_id.as_deref(),
                now,
            )
        })
    }

    pub fn update_category(&self, id: &str, patch: CategoryPatch) -> Result<(), PromptError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).update_category(
                id,
                patch.name.as_deref(),
                patch.parent_id.as_ref().map(|value| value.as_deref()),
                now,
            )
        })
    }

    pub fn delete_category_with_options(
        &self,
        id: &str,
        options: &CategoryDeleteOptions,
    ) -> Result<PromptCategoryDeleteReport, PromptError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).delete_category_with_options(id, options, now)
        })
    }

    pub fn set_category_appearance(
        &self,
        id: &str,
        appearance: CategoryAppearanceInput,
    ) -> Result<(), PromptError> {
        let color = normalize_optional_color(appearance.color.as_deref())
            .map_err(PromptError::Validation)?;
        let icon_name = normalize_optional_icon(appearance.icon_name.as_deref())
            .map_err(PromptError::Validation)?;
        let now = now_millis();
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).set_category_appearance(
                id,
                color.as_deref(),
                icon_name.as_deref(),
                now,
            )
        })
    }

    pub fn reorder_categories(
        &self,
        parent_id: Option<&str>,
        ids: &[String],
    ) -> Result<(), PromptError> {
        self.database.with_connection(|connection| {
            PromptRepository::new(connection).reorder_categories(parent_id, ids)
        })
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>, PromptError> {
        self.database
            .with_connection(|connection| PromptRepository::new(connection).list_tags())
    }

    /// Save clipboard text as a prompt without a form. The original text is
    /// preserved byte-for-byte; only the optional display title is derived from
    /// its first meaningful line. Strict duplicates return the existing row.
    pub fn save_clipboard_text(
        &self,
        content: &str,
        allow_sensitive: bool,
    ) -> Result<SavePromptResult, PromptError> {
        if content.trim().is_empty() {
            return Err(PromptError::Validation(
                "剪贴板文本为空，无法保存。".to_owned(),
            ));
        }
        if content.chars().count() > crate::models::prompt::MAX_PROMPT_CONTENT_CHARS {
            return Err(PromptError::Validation(
                "剪贴板文本超过 200,000 个字符，未保存。".to_owned(),
            ));
        }
        if is_sensitive_text(content) && !allow_sensitive {
            return Err(PromptError::SensitiveContent);
        }
        let input = PromptInput {
            title: suggest_title(content),
            content: content.to_owned(),
            category_id: None,
            tags: Vec::new(),
            background_color: None,
            favorite: false,
        };
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        self.database.with_connection(|connection| {
            let repository = PromptRepository::new(connection);
            if let Some(existing) = repository.find_active_by_content(content)? {
                return Ok(SavePromptResult {
                    prompt: existing,
                    created: false,
                });
            }
            repository
                .create_prompt(&id, &input, now)
                .map(|prompt| SavePromptResult {
                    prompt,
                    created: true,
                })
        })
    }

    /// Write the exact prompt text to the system clipboard, then record usage.
    /// Multi-selection joins with a blank line between prompts.
    pub fn copy_prompts(&self, ids: &[String]) -> Result<CopyOutcome, PromptError> {
        let mut unique = Vec::new();
        for id in ids {
            if !unique.contains(id) {
                unique.push(id.clone());
            }
        }
        if unique.is_empty() {
            return Err(PromptError::Validation(
                "没有选择要复制的提示词。".to_owned(),
            ));
        }

        let prompts = self.database.with_connection(|connection| {
            let repository = PromptRepository::new(connection);
            let mut prompts = Vec::new();
            for id in &unique {
                if let Some(prompt) = repository.get_prompt(id)? {
                    prompts.push(prompt);
                }
            }
            Ok::<_, PromptError>(prompts)
        })?;
        if prompts.len() != unique.len() {
            return Err(PromptError::NotFound);
        }

        let text = prompts
            .iter()
            .map(|prompt| prompt.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        self.clipboard
            .write_text(&text)
            .map_err(PromptError::Clipboard)?;

        let now = now_millis();
        let usage = self.database.with_connection(|connection| {
            PromptRepository::new(connection).record_usage(&unique, now)
        });
        let (usage_recorded, warning) = match usage {
            Ok(count) if count == unique.len() => (true, None),
            Ok(_) => (
                false,
                Some("剪贴板已写入，但部分提示词的使用记录未能保存。".to_owned()),
            ),
            Err(error) => (
                false,
                Some(format!("剪贴板已写入，但使用记录保存失败：{error}")),
            ),
        };

        Ok(CopyOutcome {
            copied_count: prompts.len(),
            usage_recorded,
            warning,
        })
    }
}

fn normalize_prompt_input(mut input: PromptInput) -> PromptInput {
    input.title = input.title.trim().to_owned();
    // Content is intentionally untouched: newlines, trailing spaces, indentation
    // and Markdown fences must survive exactly as the user wrote them.
    input
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use tempfile::tempdir;

    use super::*;
    use crate::models::{
        command::{
            CategoryAppearanceInput, CategoryChildAction, CategoryCommandAction,
            CategoryDeleteOptions, CategoryInput, CategoryPatch,
        },
        prompt::{PromptFilter, PromptInput, PromptQuery, PromptSort},
    };

    struct FakeClipboard {
        writes: Mutex<Vec<String>>,
        fail: bool,
    }

    impl ClipboardWriter for FakeClipboard {
        fn write_text(&self, text: &str) -> Result<(), String> {
            if self.fail {
                return Err("simulated clipboard failure".to_owned());
            }
            self.writes.lock().expect("writes").push(text.to_owned());
            Ok(())
        }
    }

    fn setup() -> (tempfile::TempDir, Database, FakeClipboard) {
        let temp = tempdir().expect("temp dir");
        let database = Database::open_or_recover(temp.path().join("commands.db"))
            .expect("database")
            .database;
        let clipboard = FakeClipboard {
            writes: Mutex::new(Vec::new()),
            fail: false,
        };
        (temp, database, clipboard)
    }

    fn input(title: &str, content: &str) -> PromptInput {
        PromptInput {
            title: title.to_owned(),
            content: content.to_owned(),
            category_id: None,
            tags: vec!["写作".to_owned(), "Review".to_owned()],
            background_color: None,
            favorite: false,
        }
    }

    #[test]
    fn multiline_prompt_round_trips_exactly_after_reopen() {
        let (temp, database, clipboard) = setup();
        let content = "请你作为资深工程师审查以下代码：\n\n```rust\nfn main() {\n    println!(\"你好\");\n}\n```\n\n要求：\n1. 逻辑\n2. 性能\n\n  - 保留缩进与空行  ";
        let prompt = {
            let service = PromptService::with_clipboard(&database, &clipboard);
            let prompt = service
                .create_prompt(input("代码审查提示词", content))
                .expect("create");
            assert_eq!(prompt.content, content);
            assert_eq!(prompt.title, "代码审查提示词");
            assert_eq!(prompt.tags.len(), 2);
            prompt
        };
        drop(database);

        let reopened = Database::open_or_recover(temp.path().join("commands.db"))
            .expect("reopen")
            .database;
        let clipboard = FakeClipboard {
            writes: Mutex::new(Vec::new()),
            fail: false,
        };
        let service = PromptService::with_clipboard(&reopened, &clipboard);
        let loaded = service.get_prompt(&prompt.id).expect("loaded");
        assert_eq!(loaded.content, content);
        assert!(loaded.created_at > 0);
    }

    #[test]
    fn search_supports_chinese_substrings_and_tags() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        service
            .create_prompt(input("审查", "请检查这段代码的逻辑问题和安全风险。"))
            .expect("first");
        service
            .create_prompt(input("润色", "请把下面的中文摘要改写得更加简洁。"))
            .expect("second");

        let by_content = service
            .list_prompts(&PromptQuery {
                search: "安全风险".to_owned(),
                ..PromptQuery::default()
            })
            .expect("search content");
        assert_eq!(by_content.len(), 1);
        assert_eq!(by_content[0].title, "审查");

        let by_title = service
            .list_prompts(&PromptQuery {
                search: "润色".to_owned(),
                ..PromptQuery::default()
            })
            .expect("search title");
        assert_eq!(by_title.len(), 1);

        let by_tag = service
            .list_prompts(&PromptQuery {
                search: "Review".to_owned(),
                ..PromptQuery::default()
            })
            .expect("search tag");
        assert_eq!(by_tag.len(), 2);
    }

    #[test]
    fn favorite_recent_and_soft_delete_are_independent_per_prompt() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let first = service
            .create_prompt(input("一", "第一段提示词"))
            .expect("first");
        let second = service
            .create_prompt(input("二", "第二段提示词"))
            .expect("second");

        service
            .copy_prompts(std::slice::from_ref(&first.id))
            .expect("copy first");
        let favorite = service.toggle_favorite(&second.id).expect("favorite");
        assert!(favorite.is_favorite);

        let favorites = service
            .list_prompts(&PromptQuery {
                filter: PromptFilter::Favorites,
                ..PromptQuery::default()
            })
            .expect("favorites");
        assert_eq!(favorites.len(), 1);
        assert_eq!(favorites[0].id, second.id);

        let recent = service
            .list_prompts(&PromptQuery {
                filter: PromptFilter::Recent,
                sort: PromptSort::Recent,
                ..PromptQuery::default()
            })
            .expect("recent");
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, first.id);
        assert_eq!(recent[0].use_count, 1);

        service.delete_prompt(&first.id).expect("delete");
        assert!(service.get_prompt(&first.id).is_err());
        assert_eq!(
            service
                .list_prompts(&PromptQuery::default())
                .expect("list")
                .len(),
            1
        );
        let deleted_at: Option<i64> = database
            .lock()
            .query_row(
                "SELECT deleted_at FROM prompts WHERE id = ?1",
                [&first.id],
                |row| row.get(0),
            )
            .expect("deleted row");
        assert!(deleted_at.is_some());
    }

    #[test]
    fn copy_preserves_exact_text_and_records_usage_after_success() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let content = "  第一行\n\n\t缩进的第二行  \n```md\n# 标题\n```";
        let prompt = service.create_prompt(input("", content)).expect("create");
        let outcome = service
            .copy_prompts(std::slice::from_ref(&prompt.id))
            .expect("copy");
        assert!(outcome.usage_recorded);
        assert_eq!(clipboard.writes.lock().expect("writes")[0], content);
        let updated = service.get_prompt(&prompt.id).expect("updated");
        assert_eq!(updated.use_count, 1);
        assert!(updated.last_used_at.is_some());
    }

    #[test]
    fn copy_failure_does_not_record_usage() {
        let (_temp, database, _clipboard) = setup();
        let failing = FakeClipboard {
            writes: Mutex::new(Vec::new()),
            fail: true,
        };
        let service = PromptService::with_clipboard(&database, &failing);
        let prompt = service
            .create_prompt(input("失败", "不会写入剪贴板"))
            .expect("create");
        assert!(service
            .copy_prompts(std::slice::from_ref(&prompt.id))
            .is_err());
        let unchanged = service.get_prompt(&prompt.id).expect("unchanged");
        assert_eq!(unchanged.use_count, 0);
        assert!(unchanged.last_used_at.is_none());
    }

    #[test]
    fn clipboard_save_dedupes_strict_content_and_requires_sensitive_confirmation() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let content = "请总结以下论文的主要贡献：\n\n- 方法\n- 结果  ";
        let first = service.save_clipboard_text(content, false).expect("save");
        assert!(first.created);
        assert_eq!(first.prompt.content, content);
        assert_eq!(first.prompt.title, "请总结以下论文的主要贡献：");
        assert!(first.prompt.category_id.is_none());

        let duplicate = service
            .save_clipboard_text(content, false)
            .expect("duplicate");
        assert!(!duplicate.created);
        assert_eq!(duplicate.prompt.id, first.prompt.id);

        assert!(matches!(
            service.save_clipboard_text("password=hunter2", false),
            Err(PromptError::SensitiveContent)
        ));
        let confirmed = service
            .save_clipboard_text("password=hunter2", true)
            .expect("confirmed");
        assert!(confirmed.created);
        assert_eq!(confirmed.prompt.content, "password=hunter2");
    }

    #[test]
    fn prompt_categories_are_independent_from_command_categories() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "编程开发".to_owned(),
                parent_id: None,
            })
            .expect("category");
        let child = service
            .create_category(CategoryInput {
                name: "代码审查".to_owned(),
                parent_id: Some(category.clone()),
            })
            .expect("child");
        let mut prompt = input("审查", "检查代码");
        prompt.category_id = Some(child.clone());
        let prompt = service.create_prompt(prompt).expect("prompt");

        let tree = service.list_categories().expect("tree");
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].prompt_count, 0);
        assert_eq!(tree[0].children[0].prompt_count, 1);
        assert_eq!(tree[0].children[0].id, child);
        assert_eq!(prompt.category_name.as_deref(), Some("代码审查"));

        // Command categories live in the other table and stay empty.
        let command_categories: i64 = database
            .lock()
            .query_row("SELECT count(*) FROM categories", [], |row| row.get(0))
            .expect("command categories");
        assert_eq!(command_categories, 0);
    }

    #[test]
    fn category_delete_options_move_prompts_and_preserve_tree() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let parent = service
            .create_category(CategoryInput {
                name: "科研工作".to_owned(),
                parent_id: None,
            })
            .expect("parent");
        let child = service
            .create_category(CategoryInput {
                name: "论文分析".to_owned(),
                parent_id: Some(parent.clone()),
            })
            .expect("child");
        let mut prompt = input("分析", "总结论文");
        prompt.category_id = Some(child.clone());
        let prompt = service.create_prompt(prompt).expect("prompt");

        let report = service
            .delete_category_with_options(
                &parent,
                &CategoryDeleteOptions {
                    command_action: CategoryCommandAction::Unclassified,
                    child_action: CategoryChildAction::Promote,
                },
            )
            .expect("delete parent");
        assert_eq!(report.deleted_categories, 1);
        assert_eq!(report.moved_prompts, 0);
        let after = service.get_prompt(&prompt.id).expect("after");
        assert_eq!(after.category_id.as_deref(), Some(child.as_str()));
        let tree = service.list_categories().expect("tree");
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].id, child);
    }

    #[test]
    fn move_prompts_is_undoable_and_reorder_persists() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "内容创作".to_owned(),
                parent_id: None,
            })
            .expect("category");
        let first = service.create_prompt(input("A", "第一条")).expect("a");
        let second = service.create_prompt(input("B", "第二条")).expect("b");

        service
            .reorder_prompts(&[second.id.clone(), first.id.clone()])
            .expect("reorder");
        let ordered = service
            .list_prompts(&PromptQuery::default())
            .expect("ordered");
        assert_eq!(ordered[0].id, second.id);

        let moved = service
            .move_prompts_to_category(&[first.id.clone(), second.id.clone()], Some(&category))
            .expect("move");
        assert_eq!(moved.moved, 2);
        let target = service
            .list_prompts(&PromptQuery {
                category_id: Some(category.clone()),
                ..PromptQuery::default()
            })
            .expect("target");
        assert_eq!(target.len(), 2);

        service
            .restore_prompt_placements(&moved.previous)
            .expect("undo");
        let restored = service.get_prompt(&first.id).expect("restored");
        assert!(restored.category_id.is_none());
    }

    #[test]
    fn prompt_color_and_category_appearance_are_saved() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "Claude".to_owned(),
                parent_id: None,
            })
            .expect("category");
        service
            .set_category_appearance(
                &category,
                CategoryAppearanceInput {
                    color: Some("#f4effb".to_owned()),
                    icon_name: Some("book-open".to_owned()),
                },
            )
            .expect("appearance");
        let mut prompt = input("设计", "设计一个提示词");
        prompt.category_id = Some(category.clone());
        let prompt = service.create_prompt(prompt).expect("prompt");
        service
            .set_prompts_color(std::slice::from_ref(&prompt.id), Some("#fff8e8"))
            .expect("color");
        let colored = service.get_prompt(&prompt.id).expect("colored");
        assert_eq!(colored.background_color.as_deref(), Some("#FFF8E8"));
        assert_eq!(colored.category_color.as_deref(), Some("#F4EFFB"));
        assert_eq!(colored.category_icon_name.as_deref(), Some("book-open"));

        service
            .set_prompts_color(std::slice::from_ref(&prompt.id), None)
            .expect("clear");
        assert!(service
            .get_prompt(&prompt.id)
            .expect("cleared")
            .background_color
            .is_none());

        service
            .update_category(
                &category,
                CategoryPatch {
                    name: Some("Gemini".to_owned()),
                    parent_id: None,
                },
            )
            .expect("rename");
        let tree = service.list_categories().expect("tree");
        assert_eq!(tree[0].name, "Gemini");
    }

    #[test]
    fn library_summary_counts_only_prompts() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "工作".to_owned(),
                parent_id: None,
            })
            .expect("category");
        let mut first = input("A", "第一条");
        first.category_id = Some(category);
        let first = service.create_prompt(first).expect("first");
        service.create_prompt(input("B", "第二条")).expect("second");
        service.toggle_favorite(&first.id).expect("favorite");
        service
            .copy_prompts(std::slice::from_ref(&first.id))
            .expect("copy");
        let summary = service.library_summary().expect("summary");
        assert_eq!(summary.prompt_count, 2);
        assert_eq!(summary.favorite_count, 1);
        assert_eq!(summary.category_count, 1);
        assert!(summary.tag_count >= 2);
        assert_eq!(summary.recent_prompts.len(), 1);
    }

    #[test]
    fn search_handles_fts_special_characters() {
        let (_temp, database, clipboard) = setup();
        let service = PromptService::with_clipboard(&database, &clipboard);
        service
            .create_prompt(input("引用", "请解释 \"borrow checker\" 与 C++ 的区别"))
            .expect("create");
        for search in ["\"", "*", "-", "%", "_", "\\", "C++", "AND OR"] {
            let result = service.list_prompts(&PromptQuery {
                search: search.to_owned(),
                ..PromptQuery::default()
            });
            assert!(result.is_ok(), "search {search:?} failed: {result:?}");
        }
    }
}
