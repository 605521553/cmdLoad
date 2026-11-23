mod portability;
mod repository;

use std::sync::OnceLock;

use thiserror::Error;

use crate::{
    models::{
        appearance::{normalize_optional_color, normalize_optional_icon},
        clipboard::{ClipboardSource, SaveClipboardResult},
        command::{
            CategoryAppearanceInput, CategoryDeleteOptions, CategoryDeleteReport, CategoryInput,
            CategoryPatch, Command, CommandInput, CommandPlacement, CommandQuery, CopyOutcome,
            MoveCommandsResult, Tag, COMMAND_SOURCE_MANUAL,
        },
    },
    services::{
        clipboard::{
            is_sensitive_text, suggest_shell, suggest_title, ClipboardWriter, SystemClipboard,
        },
        database::{Database, DatabaseError},
    },
};

use self::repository::CommandRepository;

static SYSTEM_CLIPBOARD: OnceLock<SystemClipboard> = OnceLock::new();

#[derive(Debug, Error)]
pub enum LibraryError {
    #[error("{0}")]
    Validation(String),
    #[error("命令或目录不存在，可能已被删除。")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Clipboard(String),
    #[error("检测到可能的敏感信息。确认后才能保存到命令库。")]
    SensitiveContent,
    #[error("数据库不可用：{0}")]
    Database(#[from] DatabaseError),
    #[error("数据库操作失败：{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 格式错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Internal(String),
}

pub struct LibraryService<'a> {
    database: &'a Database,
    clipboard: &'a dyn ClipboardWriter,
}

impl<'a> LibraryService<'a> {
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

    pub fn list_commands(&self, query: &CommandQuery) -> Result<Vec<Command>, LibraryError> {
        self.database
            .with_connection(|connection| CommandRepository::new(connection).list_commands(query))
    }

    pub fn library_summary(&self) -> Result<crate::models::command::LibrarySummary, LibraryError> {
        self.database
            .with_connection(|connection| CommandRepository::new(connection).library_summary())
    }

    pub fn get_command(&self, id: &str) -> Result<Command, LibraryError> {
        self.database
            .with_connection(|connection| CommandRepository::new(connection).get_command(id))?
            .ok_or(LibraryError::NotFound)
    }

    pub fn create_command(&self, input: CommandInput) -> Result<Command, LibraryError> {
        self.create_command_with_source(input, COMMAND_SOURCE_MANUAL)
            .map(|(command, _)| command)
    }

    fn create_command_with_source(
        &self,
        input: CommandInput,
        source_type: &str,
    ) -> Result<(Command, bool), LibraryError> {
        let input = normalize_command_input(input);
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        self.database.with_connection(|connection| {
            let repository = CommandRepository::new(connection);
            if let Some(existing) = repository.find_active_by_content(&input.command)? {
                return Ok((existing, false));
            }
            repository
                .create_command(&id, &input, source_type, now)
                .map(|command| (command, true))
        })
    }

    /// Save a clipboard item through the same Command Service used by the
    /// manual editor. The clipboard table and command table stay independent.
    pub fn save_clipboard_text(
        &self,
        content: &str,
        source: ClipboardSource,
        allow_sensitive: bool,
    ) -> Result<SaveClipboardResult, LibraryError> {
        if content.trim().is_empty() {
            return Err(LibraryError::Validation(
                "剪贴板文本为空，无法保存。".to_owned(),
            ));
        }
        if content.chars().count() > 100_000 {
            return Err(LibraryError::Validation(
                "剪贴板文本超过 100,000 个字符，未保存。".to_owned(),
            ));
        }
        if is_sensitive_text(content) && !allow_sensitive {
            return Err(LibraryError::SensitiveContent);
        }

        let input = CommandInput {
            title: suggest_title(content),
            command: content.to_owned(),
            description: String::new(),
            shell: suggest_shell(content).to_owned(),
            category_id: None,
            tags: Vec::new(),
        };
        let (command, created) = self.create_command_with_source(input, source.command_source())?;
        let _ = self.database.with_connection(|connection| {
            connection.execute(
                "UPDATE clipboard_entries SET linked_command_id = ?1 WHERE content_hash = ?2",
                rusqlite::params![
                    command.id.as_str(),
                    crate::services::clipboard::content_hash(content)
                ],
            )?;
            Ok::<_, rusqlite::Error>(())
        });
        Ok(SaveClipboardResult { command, created })
    }

    pub fn update_command(&self, id: &str, input: CommandInput) -> Result<Command, LibraryError> {
        let input = normalize_command_input(input);
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).update_command(id, &input, now)
        })
    }

    pub fn copy_text_to_clipboard(&self, content: &str) -> Result<(), LibraryError> {
        if content.trim().is_empty() {
            return Err(LibraryError::Validation(
                "没有可复制的剪贴板文本。".to_owned(),
            ));
        }
        self.clipboard
            .write_text(content)
            .map_err(LibraryError::Clipboard)
    }

    pub fn delete_command(&self, id: &str) -> Result<(), LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).delete_command(id, now)
        })
    }

    pub fn toggle_favorite(&self, id: &str) -> Result<Command, LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).toggle_favorite(id, now)
        })
    }

    pub fn reorder_commands(&self, ids: &[String]) -> Result<(), LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).reorder_commands(ids, now)
        })
    }

    pub fn move_commands_to_category(
        &self,
        ids: &[String],
        category_id: Option<&str>,
    ) -> Result<MoveCommandsResult, LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).move_commands_to_category(ids, category_id, now)
        })
    }

    pub fn restore_command_placements(
        &self,
        placements: &[CommandPlacement],
    ) -> Result<usize, LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).restore_command_placements(placements, now)
        })
    }

    pub fn reorder_categories(
        &self,
        parent_id: Option<&str>,
        ids: &[String],
    ) -> Result<(), LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).reorder_categories(parent_id, ids, now)
        })
    }

    pub fn list_categories(
        &self,
    ) -> Result<Vec<crate::models::command::CategoryNode>, LibraryError> {
        self.database
            .with_connection(|connection| CommandRepository::new(connection).list_categories())
    }

    pub fn create_category(&self, input: CategoryInput) -> Result<String, LibraryError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).create_category(
                &id,
                &input.name,
                input.parent_id.as_deref(),
                now,
            )
        })
    }

    pub fn update_category(&self, id: &str, patch: CategoryPatch) -> Result<(), LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).update_category(
                id,
                patch.name.as_deref(),
                patch.parent_id.as_ref().map(|value| value.as_deref()),
                now,
            )
        })
    }

    pub fn delete_category(&self, id: &str) -> Result<(), LibraryError> {
        self.database
            .with_connection(|connection| CommandRepository::new(connection).delete_category(id))
    }

    pub fn delete_category_with_options(
        &self,
        id: &str,
        options: &CategoryDeleteOptions,
    ) -> Result<CategoryDeleteReport, LibraryError> {
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).delete_category_with_options(id, options, now)
        })
    }

    pub fn set_commands_color(
        &self,
        ids: &[String],
        color: Option<&str>,
    ) -> Result<usize, LibraryError> {
        let color = normalize_optional_color(color).map_err(LibraryError::Validation)?;
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).set_commands_color(ids, color.as_deref())
        })
    }

    pub fn set_commands_follow_category_color(
        &self,
        ids: &[String],
        enabled: bool,
    ) -> Result<usize, LibraryError> {
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).set_commands_follow_category_color(ids, enabled)
        })
    }

    pub fn set_category_appearance(
        &self,
        id: &str,
        appearance: CategoryAppearanceInput,
    ) -> Result<(), LibraryError> {
        let color = normalize_optional_color(appearance.color.as_deref())
            .map_err(LibraryError::Validation)?;
        let icon_name = normalize_optional_icon(appearance.icon_name.as_deref())
            .map_err(LibraryError::Validation)?;
        let now = now_millis();
        self.database.with_connection(|connection| {
            CommandRepository::new(connection).set_category_appearance(
                id,
                color.as_deref(),
                icon_name.as_deref(),
                now,
            )
        })
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>, LibraryError> {
        self.database
            .with_connection(|connection| CommandRepository::new(connection).list_tags())
    }

    /// Writes the actual command text to the system clipboard first. Usage is
    /// recorded only after the OS confirms the clipboard write.
    pub fn copy_commands(&self, ids: &[String]) -> Result<CopyOutcome, LibraryError> {
        let mut unique = Vec::new();
        for id in ids {
            if !unique.contains(id) {
                unique.push(id.clone());
            }
        }
        if unique.is_empty() {
            return Err(LibraryError::Validation(
                "没有选择要复制的命令。".to_owned(),
            ));
        }

        let commands = self.database.with_connection(|connection| {
            let repository = CommandRepository::new(connection);
            let mut commands = Vec::new();
            for id in &unique {
                if let Some(command) = repository.get_command(id)? {
                    commands.push(command);
                }
            }
            Ok::<_, LibraryError>(commands)
        })?;
        if commands.len() != unique.len() {
            return Err(LibraryError::NotFound);
        }

        let text = commands
            .iter()
            .map(|command| command.command.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        self.clipboard
            .write_text(&text)
            .map_err(LibraryError::Clipboard)?;

        let now = now_millis();
        let usage = self.database.with_connection(|connection| {
            CommandRepository::new(connection).record_usage(&unique, now)
        });
        let (usage_recorded, warning) = match usage {
            Ok(count) if count == unique.len() => (true, None),
            Ok(_) => (
                false,
                Some("剪贴板已写入，但部分命令的使用记录未能保存。".to_owned()),
            ),
            Err(error) => (
                false,
                Some(format!("剪贴板已写入，但使用记录保存失败：{error}")),
            ),
        };

        Ok(CopyOutcome {
            copied_count: commands.len(),
            usage_recorded,
            warning,
        })
    }
}

fn normalize_command_input(mut input: CommandInput) -> CommandInput {
    let title = input.title.trim();
    input.title = if title.is_empty() {
        suggest_title(&input.command)
    } else {
        title.to_owned()
    };
    let shell = input.shell.trim().to_lowercase();
    input.shell = if shell.is_empty() {
        "unknown".to_owned()
    } else {
        shell
    };
    input
}

pub(crate) fn now_millis() -> i64 {
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
    use crate::models::command::{
        CategoryChildAction, CategoryCommandAction, CommandFilter, CommandSort,
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

    fn service_with_clipboard(fail: bool) -> (tempfile::TempDir, Database, FakeClipboard) {
        let temp = tempdir().expect("temp dir");
        let database = Database::open_or_recover(temp.path().join("commands.db"))
            .expect("database")
            .database;
        let clipboard = FakeClipboard {
            writes: Mutex::new(Vec::new()),
            fail,
        };
        (temp, database, clipboard)
    }

    fn input(title: &str) -> CommandInput {
        CommandInput {
            title: title.to_owned(),
            command: format!("Write-Output '{title}'"),
            description: "测试说明".to_owned(),
            shell: "powershell".to_owned(),
            category_id: None,
            tags: vec!["测试".to_owned(), "中文".to_owned()],
        }
    }

    #[test]
    fn create_search_favorite_and_soft_delete() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let first = service.create_command(input("部署服务")).expect("create");
        let second = service.create_command(input("Git Status")).expect("create");
        assert!(!first.id.is_empty());
        assert!(first.id != second.id);

        let by_chinese = service
            .list_commands(&CommandQuery {
                search: "部署".to_owned(),
                ..CommandQuery::default()
            })
            .expect("search");
        assert_eq!(by_chinese.len(), 1);
        assert_eq!(by_chinese[0].id, first.id);

        let by_tag = service
            .list_commands(&CommandQuery {
                search: "中文".to_owned(),
                ..CommandQuery::default()
            })
            .expect("tag search");
        assert_eq!(by_tag.len(), 2);

        let by_english = service
            .list_commands(&CommandQuery {
                search: "git".to_owned(),
                sort: CommandSort::Title,
                ..CommandQuery::default()
            })
            .expect("english search");
        assert_eq!(by_english.len(), 1);

        let favorite = service.toggle_favorite(&second.id).expect("favorite");
        assert!(favorite.is_favorite);
        let favorites = service
            .list_commands(&CommandQuery {
                filter: CommandFilter::Favorites,
                ..CommandQuery::default()
            })
            .expect("favorites");
        assert_eq!(favorites.len(), 1);

        service.delete_command(&first.id).expect("delete");
        assert!(service.get_command(&first.id).is_err());
        let deleted_at: Option<i64> = database
            .lock()
            .query_row(
                "SELECT deleted_at FROM commands WHERE id = ?1",
                [&first.id],
                |row| row.get(0),
            )
            .expect("deleted row");
        assert!(deleted_at.is_some(), "delete must preserve the row");
        let all = service
            .list_commands(&CommandQuery::default())
            .expect("list");
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn reorder_commands_persists_across_reload_and_category_filter() {
        let (temp, database, clipboard) = service_with_clipboard(false);
        let (category, a_id, b_id, c_id) = {
            let service = LibraryService::with_clipboard(&database, &clipboard);
            let category = service
                .create_category(CategoryInput {
                    name: "排序测试".to_owned(),
                    parent_id: None,
                })
                .expect("category");
            let mut a = input("排序 A");
            a.category_id = Some(category.clone());
            let mut b = input("排序 B");
            b.category_id = Some(category.clone());
            let mut c = input("排序 C");
            c.category_id = Some(category.clone());
            let a = service.create_command(a).expect("a");
            let b = service.create_command(b).expect("b");
            let c = service.create_command(c).expect("c");

            service
                .reorder_commands(&[c.id.clone(), a.id.clone(), b.id.clone()])
                .expect("reorder");
            let ordered = service
                .list_commands(&CommandQuery {
                    category_id: Some(category.clone()),
                    sort: CommandSort::Manual,
                    ..CommandQuery::default()
                })
                .expect("list");
            assert_eq!(
                ordered
                    .iter()
                    .map(|command| command.id.as_str())
                    .collect::<Vec<_>>(),
                vec![c.id.as_str(), a.id.as_str(), b.id.as_str()]
            );
            (category, a.id, b.id, c.id)
        };
        drop(database);

        let reopened = Database::open_or_recover(temp.path().join("commands.db"))
            .expect("reopen")
            .database;
        let clipboard = FakeClipboard {
            writes: Mutex::new(Vec::new()),
            fail: false,
        };
        let service = LibraryService::with_clipboard(&reopened, &clipboard);
        let ordered = service
            .list_commands(&CommandQuery {
                category_id: Some(category),
                sort: CommandSort::Manual,
                ..CommandQuery::default()
            })
            .expect("persisted list");
        assert_eq!(
            ordered
                .iter()
                .map(|command| command.id.as_str())
                .collect::<Vec<_>>(),
            vec![c_id.as_str(), a_id.as_str(), b_id.as_str()]
        );
    }

    #[test]
    fn move_commands_to_category_is_transactional_and_undoable() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let first_category = service
            .create_category(CategoryInput {
                name: "来源目录".to_owned(),
                parent_id: None,
            })
            .expect("from");
        let second_category = service
            .create_category(CategoryInput {
                name: "目标目录".to_owned(),
                parent_id: None,
            })
            .expect("to");
        let first_category_id = first_category.clone();
        let mut first = input("移动一");
        first.category_id = Some(first_category.clone());
        let mut second = input("移动二");
        second.category_id = Some(first_category);
        let first = service.create_command(first).expect("first");
        let second = service.create_command(second).expect("second");

        let result = service
            .move_commands_to_category(
                &[first.id.clone(), second.id.clone()],
                Some(&second_category),
            )
            .expect("move");
        assert_eq!(result.moved, 2);
        assert_eq!(result.previous.len(), 2);
        let target = service
            .list_commands(&CommandQuery {
                category_id: Some(second_category.clone()),
                sort: CommandSort::Manual,
                ..CommandQuery::default()
            })
            .expect("target");
        assert_eq!(target.len(), 2);
        assert_eq!(target[0].id, first.id);
        assert_eq!(target[1].id, second.id);

        service
            .restore_command_placements(&result.previous)
            .expect("undo");
        let restored = service
            .list_commands(&CommandQuery {
                filter: CommandFilter::All,
                sort: CommandSort::Manual,
                ..CommandQuery::default()
            })
            .expect("restored");
        assert_eq!(
            restored
                .iter()
                .find(|command| command.id == first.id)
                .and_then(|command| command.category_id.clone()),
            Some(first_category_id)
        );
    }

    #[test]
    fn reorder_categories_supports_independent_order_and_persists() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let first = service
            .create_category(CategoryInput {
                name: "甲".to_owned(),
                parent_id: None,
            })
            .expect("a");
        let second = service
            .create_category(CategoryInput {
                name: "乙".to_owned(),
                parent_id: None,
            })
            .expect("b");
        let third = service
            .create_category(CategoryInput {
                name: "丙".to_owned(),
                parent_id: None,
            })
            .expect("c");
        service
            .reorder_categories(None, &[third.clone(), first.clone(), second.clone()])
            .expect("reorder categories");
        let categories = service.list_categories().expect("categories");
        assert_eq!(
            categories
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec![third.as_str(), first.as_str(), second.as_str()]
        );
    }

    #[test]
    fn command_color_and_follow_category_mode_persist() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "Docker".to_owned(),
                parent_id: None,
            })
            .expect("category");
        service
            .set_category_appearance(
                &category,
                CategoryAppearanceInput {
                    color: Some("#edf8f2".to_owned()),
                    icon_name: Some("container".to_owned()),
                },
            )
            .expect("category appearance");
        let mut command_input = input("查看容器");
        command_input.category_id = Some(category.clone());
        let command = service.create_command(command_input).expect("command");

        assert_eq!(
            service
                .set_commands_color(std::slice::from_ref(&command.id), Some("#fceef0"))
                .expect("set color"),
            1
        );
        let tinted = service.get_command(&command.id).expect("tinted");
        assert_eq!(tinted.background_color.as_deref(), Some("#FCEEF0"));
        assert!(!tinted.use_category_color);
        assert_eq!(tinted.category_color.as_deref(), Some("#EDF8F2"));
        assert_eq!(tinted.category_icon_name.as_deref(), Some("container"));

        service
            .set_commands_follow_category_color(std::slice::from_ref(&command.id), true)
            .expect("follow");
        let following = service.get_command(&command.id).expect("following");
        assert!(following.use_category_color);
        // The own color stays stored so leaving follow mode restores it.
        assert_eq!(following.background_color.as_deref(), Some("#FCEEF0"));

        service
            .set_category_appearance(
                &category,
                CategoryAppearanceInput {
                    color: Some("#EDF3FC".to_owned()),
                    icon_name: Some("server".to_owned()),
                },
            )
            .expect("change category appearance");
        let following = service.get_command(&command.id).expect("following");
        assert_eq!(following.category_color.as_deref(), Some("#EDF3FC"));
        assert_eq!(following.category_icon_name.as_deref(), Some("server"));

        assert!(service
            .set_commands_color(std::slice::from_ref(&command.id), Some("not-a-color"))
            .is_err());
        assert!(service
            .set_commands_follow_category_color(&["missing".to_owned()], false)
            .is_err());
        let unchanged = service.get_command(&command.id).expect("unchanged");
        assert!(unchanged.use_category_color);
        assert_eq!(unchanged.background_color.as_deref(), Some("#FCEEF0"));
    }

    #[test]
    fn single_command_color_update_only_touches_that_command() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let first = service.create_command(input("单条颜色")).expect("first");
        let second = service.create_command(input("不应变化")).expect("second");

        service
            .set_commands_color(std::slice::from_ref(&first.id), Some("#EDF8F2"))
            .expect("single color");

        let first_after = service.get_command(&first.id).expect("first after");
        assert_eq!(first_after.background_color.as_deref(), Some("#EDF8F2"));
        let second_after = service.get_command(&second.id).expect("second after");
        assert!(second_after.background_color.is_none());
        assert!(!second_after.use_category_color);
    }

    #[test]
    fn batch_color_update_is_transactional_and_can_reset() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let first = service.create_command(input("颜色一")).expect("first");
        let second = service.create_command(input("颜色二")).expect("second");
        let both = vec![first.id.clone(), second.id.clone()];

        assert_eq!(
            service
                .set_commands_color(&both, Some("#fff8e8"))
                .expect("batch"),
            2
        );
        for id in &both {
            let command = service.get_command(id).expect("colored");
            assert_eq!(command.background_color.as_deref(), Some("#FFF8E8"));
            assert!(!command.use_category_color);
        }

        let invalid = vec![first.id.clone(), "missing".to_owned()];
        assert!(service
            .set_commands_color(&invalid, Some("#F4EFFB"))
            .is_err());
        let first_after = service.get_command(&first.id).expect("first");
        assert_eq!(
            first_after.background_color.as_deref(),
            Some("#FFF8E8"),
            "a failed batch must not partially write"
        );

        assert_eq!(service.set_commands_color(&both, None).expect("reset"), 2);
        for id in &both {
            let command = service.get_command(id).expect("reset");
            assert!(command.background_color.is_none());
            assert!(!command.use_category_color);
        }
    }

    #[test]
    fn nested_categories_keep_independent_appearance() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let parent = service
            .create_category(CategoryInput {
                name: "Linux".to_owned(),
                parent_id: None,
            })
            .expect("parent");
        let child = service
            .create_category(CategoryInput {
                name: "SSH".to_owned(),
                parent_id: Some(parent.clone()),
            })
            .expect("child");

        service
            .set_category_appearance(
                &parent,
                CategoryAppearanceInput {
                    color: Some("#edf3fc".to_owned()),
                    icon_name: Some("server".to_owned()),
                },
            )
            .expect("parent appearance");
        let tree = service.list_categories().expect("tree");
        assert_eq!(tree[0].color.as_deref(), Some("#EDF3FC"));
        assert_eq!(tree[0].icon_name.as_deref(), Some("server"));
        assert!(tree[0].children[0].color.is_none());
        assert!(tree[0].children[0].icon_name.is_none());

        assert!(service
            .set_category_appearance(
                &child,
                CategoryAppearanceInput {
                    color: Some("#EDF8F2".to_owned()),
                    icon_name: Some("coffee".to_owned()),
                },
            )
            .is_err());
        let tree = service.list_categories().expect("unchanged");
        assert!(tree[0].children[0].icon_name.is_none());

        service
            .set_category_appearance(&parent, CategoryAppearanceInput::default())
            .expect("reset parent");
        let tree = service.list_categories().expect("reset");
        assert!(tree[0].color.is_none());
        assert!(tree[0].icon_name.is_none());
    }

    #[test]
    fn delete_category_can_promote_children_and_preserve_commands() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let parent = service
            .create_category(CategoryInput {
                name: "父目录".to_owned(),
                parent_id: None,
            })
            .expect("parent");
        let child = service
            .create_category(CategoryInput {
                name: "子目录".to_owned(),
                parent_id: Some(parent.clone()),
            })
            .expect("child");
        let mut parent_command = input("父命令");
        parent_command.category_id = Some(parent.clone());
        let mut child_command = input("子命令");
        child_command.category_id = Some(child.clone());
        let parent_command = service.create_command(parent_command).expect("p");
        let child_command = service.create_command(child_command).expect("c");

        let report = service
            .delete_category_with_options(
                &parent,
                &CategoryDeleteOptions {
                    command_action: CategoryCommandAction::Unclassified,
                    child_action: CategoryChildAction::Promote,
                },
            )
            .expect("delete promote");
        assert_eq!(report.deleted_categories, 1);
        assert_eq!(report.moved_commands, 1);
        let parent_after = service.get_command(&parent_command.id).expect("p");
        assert!(parent_after.category_id.is_none());
        let child_after = service.get_command(&child_command.id).expect("c");
        assert_eq!(child_after.category_id.as_deref(), Some(child.as_str()));
        let tree = service.list_categories().expect("tree");
        assert!(tree.iter().any(|node| node.id == child));
        assert!(!tree.iter().any(|node| node.id == parent));
    }

    #[test]
    fn delete_category_subtree_removes_categories_but_moves_all_commands() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let parent = service
            .create_category(CategoryInput {
                name: "树根".to_owned(),
                parent_id: None,
            })
            .expect("parent");
        let child = service
            .create_category(CategoryInput {
                name: "树枝".to_owned(),
                parent_id: Some(parent.clone()),
            })
            .expect("child");
        let mut parent_command = input("树命令");
        parent_command.category_id = Some(parent.clone());
        let mut child_command = input("枝命令");
        child_command.category_id = Some(child.clone());
        let parent_command = service.create_command(parent_command).expect("p");
        let child_command = service.create_command(child_command).expect("c");

        let report = service
            .delete_category_with_options(
                &parent,
                &CategoryDeleteOptions {
                    command_action: CategoryCommandAction::Unclassified,
                    child_action: CategoryChildAction::DeleteSubtree,
                },
            )
            .expect("delete subtree");
        assert_eq!(report.deleted_categories, 2);
        assert_eq!(report.moved_commands, 2);
        assert!(service.list_categories().expect("tree").is_empty());
        assert!(service
            .get_command(&parent_command.id)
            .expect("p")
            .category_id
            .is_none());
        assert!(service
            .get_command(&child_command.id)
            .expect("c")
            .category_id
            .is_none());
    }

    #[test]
    fn clipboard_save_derives_fields_dedupes_and_preserves_original_text() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let content = "  docker ps -a\r\n\tdocker compose ps  ";
        let saved = service
            .save_clipboard_text(
                content,
                crate::models::clipboard::ClipboardSource::Current,
                false,
            )
            .expect("save current");
        assert!(saved.created);
        assert_eq!(saved.command.command, content);
        assert_eq!(saved.command.title, "docker ps -a");
        assert_eq!(saved.command.shell, "unknown");
        assert_eq!(saved.command.source_type, "clipboard_current");
        assert!(saved.command.description.is_empty());
        assert!(saved.command.category_id.is_none());
        assert!(saved.command.tags.is_empty());
        assert_eq!(saved.command.ai_annotation_status, "none");

        let duplicate = service
            .save_clipboard_text(
                content,
                crate::models::clipboard::ClipboardSource::LocalMonitor,
                false,
            )
            .expect("duplicate");
        assert!(!duplicate.created);
        assert_eq!(duplicate.command.id, saved.command.id);
        assert_eq!(duplicate.command.source_type, "clipboard_current");

        let history = service
            .save_clipboard_text(
                "Get-Process | Select-Object -First 5",
                crate::models::clipboard::ClipboardSource::SystemHistory,
                false,
            )
            .expect("history save");
        assert_eq!(history.command.shell, "powershell");
        assert_eq!(history.command.source_type, "clipboard_history");
    }

    #[test]
    fn manual_add_allows_empty_title_and_shell_unknown() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let command = service
            .create_command(CommandInput {
                title: String::new(),
                command: "Get-ChildItem".to_owned(),
                description: String::new(),
                shell: "unknown".to_owned(),
                category_id: None,
                tags: Vec::new(),
            })
            .expect("manual save");
        assert_eq!(command.title, "Get-ChildItem");
        assert_eq!(command.shell, "unknown");
        assert_eq!(command.source_type, "manual");
    }

    #[test]
    fn sensitive_clipboard_save_requires_explicit_confirmation() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let content = "password=hunter2";
        assert!(matches!(
            service.save_clipboard_text(
                content,
                crate::models::clipboard::ClipboardSource::Current,
                false
            ),
            Err(LibraryError::SensitiveContent)
        ));
        assert!(service
            .list_commands(&CommandQuery::default())
            .expect("list")
            .is_empty());
        let saved = service
            .save_clipboard_text(
                content,
                crate::models::clipboard::ClipboardSource::Current,
                true,
            )
            .expect("confirmed save");
        assert!(saved.created);
        assert_eq!(saved.command.command, content);
    }

    #[test]
    fn usage_is_recorded_only_after_successful_clipboard_write() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let command = service.create_command(input("复制测试")).expect("create");
        let outcome = service
            .copy_commands(std::slice::from_ref(&command.id))
            .expect("copy");
        assert!(outcome.usage_recorded);
        let updated = service.get_command(&command.id).expect("updated");
        assert_eq!(updated.use_count, 1);
        assert!(updated.last_used_at.is_some());
        assert_eq!(clipboard.writes.lock().expect("writes").len(), 1);

        let (temp, database, failing) = service_with_clipboard(true);
        let service = LibraryService::with_clipboard(&database, &failing);
        let command = service.create_command(input("失败测试")).expect("create");
        assert!(service
            .copy_commands(std::slice::from_ref(&command.id))
            .is_err());
        let unchanged = service.get_command(&command.id).expect("unchanged");
        assert_eq!(unchanged.use_count, 0);
        assert!(unchanged.last_used_at.is_none());
        let _ = temp;
    }

    #[test]
    fn multi_copy_joins_commands_and_records_each_once() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let a = service.create_command(input("A")).expect("a");
        let b = service.create_command(input("B")).expect("b");
        let outcome = service
            .copy_commands(&[a.id.clone(), b.id.clone(), a.id.clone()])
            .expect("copy");
        assert_eq!(outcome.copied_count, 2);
        assert_eq!(
            clipboard.writes.lock().expect("writes")[0],
            "Write-Output 'A'\nWrite-Output 'B'"
        );
        let a_after = service.get_command(&a.id).expect("a");
        let b_after = service.get_command(&b.id).expect("b");
        assert_eq!(a_after.use_count, 1);
        assert_eq!(b_after.use_count, 1);
    }

    #[test]
    fn search_handles_fts_special_characters_without_error() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        service.create_command(input("引用测试")).expect("create");
        for search in ["\"", "*", "-", "%", "_", "\\", "docker OR", "C++"] {
            let result = service.list_commands(&CommandQuery {
                search: search.to_owned(),
                ..CommandQuery::default()
            });
            assert!(result.is_ok(), "search {search:?} failed: {result:?}");
        }
    }

    #[test]
    fn library_summary_reflects_real_commands_and_usage() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "概览".to_owned(),
                parent_id: None,
            })
            .expect("category");
        let mut first = input("第一");
        first.category_id = Some(category);
        let first = service.create_command(first).expect("first");
        service.create_command(input("第二")).expect("second");
        service.toggle_favorite(&first.id).expect("favorite");
        service
            .copy_commands(std::slice::from_ref(&first.id))
            .expect("copy");
        let summary = service.library_summary().expect("summary");
        assert_eq!(summary.command_count, 2);
        assert_eq!(summary.favorite_count, 1);
        assert_eq!(summary.category_count, 1);
        assert!(summary.tag_count >= 2);
        assert_eq!(summary.recent_commands.len(), 1);
        assert_eq!(summary.recent_commands[0].id, first.id);
    }

    #[test]
    fn duplicate_sibling_categories_are_rejected() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        service
            .create_category(CategoryInput {
                name: "重复".to_owned(),
                parent_id: None,
            })
            .expect("first");
        assert!(service
            .create_category(CategoryInput {
                name: "重复".to_owned(),
                parent_id: None,
            })
            .is_err());
    }

    #[test]
    fn empty_category_can_be_deleted() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let id = service
            .create_category(CategoryInput {
                name: "空目录".to_owned(),
                parent_id: None,
            })
            .expect("create");
        service.delete_category(&id).expect("delete empty category");
        assert!(service.list_categories().expect("categories").is_empty());
    }

    #[test]
    fn category_tree_and_delete_protection() {
        let (_temp, database, clipboard) = service_with_clipboard(false);
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let parent = service
            .create_category(CategoryInput {
                name: "运维".to_owned(),
                parent_id: None,
            })
            .expect("parent");
        let child = service
            .create_category(CategoryInput {
                name: "数据库".to_owned(),
                parent_id: Some(parent.clone()),
            })
            .expect("child");
        let mut command = input("备份数据库");
        command.category_id = Some(child.clone());
        service.create_command(command).expect("create");
        let tree = service.list_categories().expect("tree");
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].command_count, 1);

        assert!(service.delete_category(&child).is_err());
        assert!(service.delete_category(&parent).is_err());
    }
}
