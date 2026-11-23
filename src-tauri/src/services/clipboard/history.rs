use rusqlite::{params, OptionalExtension};

use crate::{
    models::clipboard::{ClipboardItem, ClipboardSource, ClipboardState},
    services::{
        clipboard::{content_hash, is_sensitive_text, read_current_text},
        database::Database,
        library::{now_millis, LibraryError},
    },
};

pub struct ClipboardHistoryService<'a> {
    database: &'a Database,
}

impl<'a> ClipboardHistoryService<'a> {
    pub fn new(database: &'a Database) -> Self {
        Self { database }
    }

    pub fn snapshot(
        &self,
        local_history_enabled: bool,
        monitor_warning: Option<String>,
    ) -> Result<ClipboardState, LibraryError> {
        let current_text = read_current_text();
        let (current, current_error) = match current_text {
            Ok(Some(content)) => {
                let item = self.item_for_content(
                    "current",
                    &content,
                    ClipboardSource::Current,
                    now_millis(),
                    true,
                )?;
                (Some(item), None)
            }
            Ok(None) => (None, None),
            Err(error) => (None, Some(error)),
        };

        let local_items = self.list_local()?;
        let local_history_count = self.count()?;
        Ok(ClipboardState {
            current,
            local_items,
            local_history_enabled,
            local_history_count,
            current_error,
            monitor_warning,
        })
    }

    pub fn list_local(&self) -> Result<Vec<ClipboardItem>, LibraryError> {
        let rows = self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, content, copied_at, is_sensitive
                 FROM clipboard_entries
                 WHERE is_sensitive = 0
                 ORDER BY copied_at DESC, rowid DESC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)? != 0,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok::<_, LibraryError>(rows)
        })?;

        let mut items = Vec::with_capacity(rows.len());
        for (id, content, copied_at, is_sensitive) in rows {
            let mut item = self.item_for_content(
                &id,
                &content,
                ClipboardSource::LocalMonitor,
                copied_at,
                false,
            )?;
            item.is_sensitive = is_sensitive;
            items.push(item);
        }
        Ok(items)
    }

    pub fn record_local(&self, content: &str) -> Result<bool, LibraryError> {
        if content.trim().is_empty() || content.chars().count() > 100_000 {
            return Ok(false);
        }
        if is_sensitive_text(content) {
            return Ok(false);
        }
        let copied_at = now_millis();
        let hash = content_hash(content);
        self.database.with_connection(|connection| {
            let linked_command_id: Option<String> = connection
                .query_row(
                    "SELECT id FROM commands
                     WHERE deleted_at IS NULL AND command = ?1
                     ORDER BY updated_at DESC LIMIT 1",
                    [content],
                    |row| row.get(0),
                )
                .optional()?;
            let existing_id: Option<String> = connection
                .query_row(
                    "SELECT id FROM clipboard_entries WHERE content_hash = ?1",
                    [&hash],
                    |row| row.get(0),
                )
                .optional()?;
            let inserted = existing_id.is_none();
            if let Some(id) = existing_id {
                connection.execute(
                    "UPDATE clipboard_entries
                     SET content = ?2, copied_at = ?3, is_sensitive = 0,
                         source = 'local_monitor', linked_command_id = ?4
                     WHERE id = ?1",
                    params![id, content, copied_at, linked_command_id],
                )?;
            } else {
                connection.execute(
                    "INSERT INTO clipboard_entries (
                        id, content, content_hash, source, content_type,
                        copied_at, is_sensitive, linked_command_id
                     ) VALUES (?1, ?2, ?3, 'local_monitor', 'text', ?4, 0, ?5)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        content,
                        hash,
                        copied_at,
                        linked_command_id
                    ],
                )?;
            }
            Ok::<_, LibraryError>(inserted)
        })
    }

    pub fn prune(&self, limit: u32, retention_days: u32) -> Result<usize, LibraryError> {
        let limit = limit.clamp(10, 500) as i64;
        let retention_days = retention_days.clamp(1, 365);
        let cutoff = now_millis() - (i64::from(retention_days) * 86_400_000);
        self.database.with_connection(|connection| {
            let mut removed = connection.execute(
                "DELETE FROM clipboard_entries WHERE copied_at < ?1",
                [cutoff],
            )?;
            removed += connection.execute(
                "DELETE FROM clipboard_entries
                 WHERE id NOT IN (
                    SELECT id FROM clipboard_entries
                    ORDER BY copied_at DESC LIMIT ?1
                 )",
                [limit],
            )?;
            Ok::<_, LibraryError>(removed)
        })
    }

    pub fn clear(&self) -> Result<usize, LibraryError> {
        self.database.with_connection(|connection| {
            let removed = connection.execute("DELETE FROM clipboard_entries", [])?;
            Ok::<_, LibraryError>(removed)
        })
    }

    pub fn count(&self) -> Result<i64, LibraryError> {
        self.database.with_connection(|connection| {
            let count = connection.query_row(
                "SELECT count(*) FROM clipboard_entries WHERE is_sensitive = 0",
                [],
                |row| row.get(0),
            )?;
            Ok::<_, LibraryError>(count)
        })
    }

    pub fn decorate_system_texts(
        &self,
        texts: Vec<(String, i64, bool)>,
    ) -> Result<Vec<ClipboardItem>, LibraryError> {
        let mut items = Vec::with_capacity(texts.len());
        for (index, (content, copied_at, is_sensitive)) in texts.into_iter().enumerate() {
            let mut item = self.item_for_content(
                &format!("system-{index}-{}", content_hash(&content)),
                &content,
                ClipboardSource::SystemHistory,
                copied_at,
                false,
            )?;
            item.is_sensitive = is_sensitive;
            items.push(item);
        }
        Ok(items)
    }

    fn item_for_content(
        &self,
        key: &str,
        content: &str,
        source: ClipboardSource,
        copied_at: i64,
        is_current: bool,
    ) -> Result<ClipboardItem, LibraryError> {
        let saved = self.saved_command_state(content)?;
        Ok(ClipboardItem {
            key: key.to_owned(),
            content: content.to_owned(),
            source,
            copied_at,
            is_current,
            is_sensitive: is_sensitive_text(content),
            saved_command_id: saved.as_ref().map(|(id, _)| id.clone()),
            saved_command_is_favorite: saved.map(|(_, favorite)| favorite).unwrap_or(false),
        })
    }

    fn saved_command_state(&self, content: &str) -> Result<Option<(String, bool)>, LibraryError> {
        self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, is_favorite FROM commands
                     WHERE deleted_at IS NULL AND command = ?1
                     ORDER BY updated_at DESC LIMIT 1",
                    [content],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0)),
                )
                .optional()
                .map_err(LibraryError::Sqlite)
        })
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::services::database::Database;

    fn database() -> (tempfile::TempDir, Database) {
        let temp = tempdir().expect("temp dir");
        let database = Database::open_or_recover(temp.path().join("commands.db"))
            .expect("db")
            .database;
        (temp, database)
    }

    #[test]
    fn local_history_deduplicates_and_updates_recency() {
        let (_temp, database) = database();
        let service = ClipboardHistoryService::new(&database);
        assert!(service.record_local("docker ps").expect("insert"));
        std::thread::sleep(std::time::Duration::from_millis(3));
        assert!(!service.record_local("docker ps").expect("update"));
        assert!(service.record_local("docker ps -a").expect("insert"));
        let items = service.list_local().expect("list");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].content, "docker ps -a");
        assert_eq!(service.count().expect("count"), 2);
    }

    #[test]
    fn sensitive_text_is_not_recorded() {
        let (_temp, database) = database();
        let service = ClipboardHistoryService::new(&database);
        assert!(!service.record_local("password=hunter2").expect("skip"));
        assert!(service.list_local().expect("list").is_empty());
    }

    #[test]
    fn retention_prunes_old_entries_without_touching_recent_ones() {
        let (_temp, database) = database();
        let service = ClipboardHistoryService::new(&database);
        service.record_local("old-item").expect("old");
        service.record_local("new-item").expect("new");
        const EIGHT_DAYS_MS: i64 = 8 * 86_400_000;
        database
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE clipboard_entries SET copied_at = ?1 WHERE content = 'old-item'",
                    [now_millis() - EIGHT_DAYS_MS],
                )?;
                Ok::<_, rusqlite::Error>(())
            })
            .expect("age entry");
        service.prune(100, 7).expect("prune");
        let items = service.list_local().expect("list");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].content, "new-item");
    }

    #[test]
    fn prune_and_clear_do_not_touch_commands() {
        let (_temp, database) = database();
        let service = ClipboardHistoryService::new(&database);
        let command = crate::services::library::LibraryService::new(&database)
            .create_command(crate::models::command::CommandInput {
                title: "保留命令".to_owned(),
                command: "echo keep-me".to_owned(),
                description: String::new(),
                shell: "unknown".to_owned(),
                category_id: None,
                tags: Vec::new(),
            })
            .expect("command");
        for index in 0..12 {
            service
                .record_local(&format!("echo {index}"))
                .expect("record");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        service.prune(10, 7).expect("prune");
        assert_eq!(service.list_local().expect("list").len(), 10);
        assert!(service.clear().expect("clear") > 0);
        assert_eq!(service.count().expect("count"), 0);

        let command_count: i64 = database
            .with_connection(|connection| {
                connection.query_row("SELECT count(*) FROM commands", [], |row| row.get(0))
            })
            .expect("commands");
        assert_eq!(command_count, 1);
        assert_eq!(
            crate::services::library::LibraryService::new(&database)
                .get_command(&command.id)
                .expect("command survives")
                .command,
            "echo keep-me"
        );
    }
}
