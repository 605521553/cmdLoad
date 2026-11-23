mod migrations;

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use parking_lot::Mutex;
#[cfg(test)]
use parking_lot::MutexGuard;
use rusqlite::{Connection, ErrorCode, OpenFlags};
use thiserror::Error;

use self::migrations::apply_migration;
pub use self::migrations::DATABASE_SCHEMA_VERSION;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("无法读写数据库文件：{0}")]
    Io(#[from] std::io::Error),
    #[error("数据库操作失败：{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("数据库完整性检查失败：{0}")]
    Corrupt(String),
    #[error("数据库版本 {found} 高于当前应用支持的版本 {supported}，已停止写入以保护数据。")]
    FutureSchema { found: u32, supported: u32 },
    #[error("数据库迁移 v{version} 失败，原数据库已保留：{source}")]
    Migration {
        version: u32,
        #[source]
        source: rusqlite::Error,
    },
    #[error("数据库损坏后无法创建备份：{0}")]
    Recovery(String),
}

pub struct Database {
    path: PathBuf,
    backups_dir: PathBuf,
    connection: Mutex<Connection>,
}

pub struct DatabaseOpenResult {
    pub database: Database,
    pub warning: Option<String>,
}

impl Database {
    pub fn open_or_recover(path: PathBuf) -> Result<DatabaseOpenResult, DatabaseError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let backups_dir = path
            .parent()
            .map(|parent| parent.join("backups"))
            .unwrap_or_else(|| PathBuf::from("backups"));
        fs::create_dir_all(&backups_dir)?;

        match open_and_migrate(&path) {
            Ok(connection) => Ok(DatabaseOpenResult {
                database: Self {
                    path,
                    backups_dir,
                    connection: Mutex::new(connection),
                },
                warning: None,
            }),
            Err(error) if is_corruption(&error) => {
                let backup = move_corrupt_files_aside(&path)?;
                let warning = format!(
                    "检测到命令数据库损坏，原文件已保留为 {}，应用已创建新的空数据库。",
                    backup.display()
                );
                let connection = open_and_migrate(&path)?;
                Ok(DatabaseOpenResult {
                    database: Self {
                        path,
                        backups_dir,
                        connection: Mutex::new(connection),
                    },
                    warning: Some(warning),
                })
            }
            Err(error) => Err(error),
        }
    }

    pub fn path_string(&self) -> String {
        self.path.display().to_string()
    }

    pub fn backups_dir(&self) -> &Path {
        &self.backups_dir
    }

    #[cfg(test)]
    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.connection.lock()
    }

    pub fn with_connection<T, E>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, E>,
    ) -> Result<T, E> {
        let mut connection = self.connection.lock();
        operation(&mut connection)
    }

    /// Create a consistent backup next to the database using SQLite's
    /// `VACUUM INTO`. The destination path must not already exist.
    pub fn backup_to(&self, destination: &Path) -> Result<(), DatabaseError> {
        if destination.exists() {
            return Err(DatabaseError::Io(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "备份文件已存在",
            )));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = self.connection.lock();
        connection.execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])?;
        Ok(())
    }
}

fn open_and_migrate(path: &Path) -> Result<Connection, DatabaseError> {
    let mut connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_URI,
    )?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let journal_mode: String =
        connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(DatabaseError::Recovery(format!(
            "无法启用 WAL 模式（当前为 {journal_mode}）"
        )));
    }
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "temp_store", "MEMORY")?;

    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(map_integrity_error)?;
    if !integrity.eq_ignore_ascii_case("ok") {
        return Err(DatabaseError::Corrupt(integrity));
    }

    let version: u32 = connection.query_row("PRAGMA user_version", [], |row| {
        let value: i64 = row.get(0)?;
        Ok(value.max(0) as u32)
    })?;
    if version > DATABASE_SCHEMA_VERSION {
        return Err(DatabaseError::FutureSchema {
            found: version,
            supported: DATABASE_SCHEMA_VERSION,
        });
    }

    if version < DATABASE_SCHEMA_VERSION {
        if version > 0 {
            let backup = pre_migration_backup_path(path, version);
            connection
                .execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                .map_err(|source| DatabaseError::Migration { version, source })?;
        }
        for target in (version + 1)..=DATABASE_SCHEMA_VERSION {
            apply_migration(&mut connection, target).map_err(|source| {
                DatabaseError::Migration {
                    version: target,
                    source,
                }
            })?;
        }
    }

    backfill_command_content_hashes(&mut connection).map_err(|source| {
        DatabaseError::Migration {
            version: DATABASE_SCHEMA_VERSION,
            source,
        }
    })?;

    Ok(connection)
}

fn backfill_command_content_hashes(connection: &mut Connection) -> rusqlite::Result<()> {
    let rows = {
        let mut statement =
            connection.prepare("SELECT id, command FROM commands WHERE content_hash IS NULL")?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    if rows.is_empty() {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    {
        let mut statement =
            transaction.prepare("UPDATE commands SET content_hash = ?2 WHERE id = ?1")?;
        for (id, content) in rows {
            statement.execute(rusqlite::params![
                id,
                crate::services::clipboard::content_hash(&content)
            ])?;
        }
    }
    transaction.commit()
}

fn map_integrity_error(error: rusqlite::Error) -> DatabaseError {
    if let rusqlite::Error::SqliteFailure(code, message) = &error {
        if matches!(
            code.code,
            ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase
        ) {
            return DatabaseError::Corrupt(message.clone().unwrap_or_else(|| error.to_string()));
        }
    }
    DatabaseError::Sqlite(error)
}

fn is_corruption(error: &DatabaseError) -> bool {
    match error {
        DatabaseError::Corrupt(_) => true,
        DatabaseError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => matches!(
            code.code,
            ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase
        ),
        _ => false,
    }
}

fn pre_migration_backup_path(path: &Path, from_version: u32) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("commands.db");
    let stamp = timestamp_millis();
    parent.join(format!("{stem}.pre-migration-v{from_version}-{stamp}.bak"))
}

fn move_corrupt_files_aside(path: &Path) -> Result<PathBuf, DatabaseError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("commands.db");
    let stamp = timestamp_millis();
    let target = parent.join(format!("{stem}.corrupt-{stamp}"));
    fs::rename(path, &target).map_err(|error| {
        DatabaseError::Recovery(format!(
            "无法移动损坏数据库到 {}：{error}",
            target.display()
        ))
    })?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = path.with_file_name(format!("{stem}{suffix}"));
        if sidecar.exists() {
            let destination = target.with_file_name(format!(
                "{}{suffix}",
                target
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("commands.db.corrupt")
            ));
            fs::rename(sidecar, destination).map_err(|error| {
                DatabaseError::Recovery(format!("无法移动数据库附属文件：{error}"))
            })?;
        }
    }
    Ok(target)
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::models::command::{CommandFilter, CommandInput, CommandQuery};

    fn open_temp() -> (tempfile::TempDir, Database) {
        let temp = tempdir().expect("temp dir");
        let result = Database::open_or_recover(temp.path().join("commands.db")).expect("open db");
        (temp, result.database)
    }

    #[test]
    fn initializes_wal_foreign_keys_and_fts() {
        let (_temp, database) = open_temp();
        let connection = database.lock();
        let journal: String = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal mode");
        assert_eq!(journal.to_lowercase(), "wal");
        let fk: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign keys");
        assert_eq!(fk, 1);
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, DATABASE_SCHEMA_VERSION as i64);
        let fts_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'commands_fts'",
                [],
                |row| row.get(0),
            )
            .expect("fts table");
        assert!(fts_sql.contains("fts5"));
    }

    #[test]
    fn corrupt_database_is_moved_aside_and_recreated() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path().join("commands.db");
        fs::write(&path, b"this is not a sqlite database").expect("write corrupt file");
        let result = Database::open_or_recover(path.clone()).expect("recover db");
        assert!(result.warning.is_some());
        assert!(path.exists());
        let recovered = fs::read_dir(temp.path())
            .expect("read dir")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(recovered);
        let connection = result.database.lock();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM commands", [], |row| row.get(0))
            .expect("empty commands");
        assert_eq!(count, 0);
    }

    #[test]
    fn schema_one_migrates_command_metadata_and_clipboard_storage() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path().join("commands.db");
        {
            let connection = Connection::open(&path).expect("open db");
            connection
                .execute_batch(super::migrations::MIGRATION_001)
                .expect("v1 schema");
            connection
                .pragma_update(None, "user_version", 1)
                .expect("v1 version");
            connection
                .execute(
                    "INSERT INTO commands (
                        id, title, command, description, shell, is_favorite,
                        sort_order, use_count, created_at, updated_at
                     ) VALUES ('c1', '旧命令', 'docker ps', '', 'powershell', 0, 10, 0, 1, 1)",
                    [],
                )
                .expect("legacy command");
        }

        let result = Database::open_or_recover(path).expect("migrate");
        let connection = result.database.lock();
        let metadata: (String, String, Option<String>) = connection
            .query_row(
                "SELECT source_type, ai_annotation_status, content_hash FROM commands WHERE id = 'c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("metadata");
        assert_eq!(metadata.0, "manual");
        assert_eq!(metadata.1, "none");
        assert!(metadata.2.is_some());
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, DATABASE_SCHEMA_VERSION as i64);
    }

    #[test]
    fn schema_two_migrates_appearance_columns_without_touching_data() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path().join("commands.db");
        {
            let connection = Connection::open(&path).expect("open db");
            connection
                .execute_batch(super::migrations::MIGRATION_001)
                .expect("v1 schema");
            connection
                .execute_batch(super::migrations::MIGRATION_002)
                .expect("v2 schema");
            connection
                .pragma_update(None, "user_version", 2)
                .expect("v2 version");
            connection
                .execute(
                    "INSERT INTO categories (id, name, parent_id, sort_order, created_at, updated_at)
                     VALUES ('cat', '运维', NULL, 10, 1, 1)",
                    [],
                )
                .expect("legacy category");
            connection
                .execute(
                    "INSERT INTO commands (
                        id, title, command, description, shell, category_id, is_favorite,
                        sort_order, use_count, created_at, updated_at, source_type, content_hash
                     ) VALUES ('c1', '旧命令', 'docker ps', '', 'bash', 'cat', 0, 10, 0, 1, 1,
                        'manual', 'hash')",
                    [],
                )
                .expect("legacy command");
        }

        let result = Database::open_or_recover(path).expect("migrate v3");
        let connection = result.database.lock();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, 5);
        let command: (Option<String>, i64) = connection
            .query_row(
                "SELECT background_color, use_category_color FROM commands WHERE id = 'c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("appearance defaults");
        assert_eq!(command, (None, 0));
        let category: (Option<String>, Option<String>) = connection
            .query_row(
                "SELECT color, icon_name FROM categories WHERE id = 'cat'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("category appearance defaults");
        assert_eq!(category, (None, None));
        let title: String = connection
            .query_row("SELECT title FROM commands WHERE id = 'c1'", [], |row| {
                row.get(0)
            })
            .expect("data preserved");
        assert_eq!(title, "旧命令");
    }

    #[test]
    fn schema_three_migrates_ai_annotations_without_touching_commands() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path().join("commands.db");
        {
            let connection = Connection::open(&path).expect("open db");
            connection
                .execute_batch(super::migrations::MIGRATION_001)
                .expect("v1 schema");
            connection
                .execute_batch(super::migrations::MIGRATION_002)
                .expect("v2 schema");
            connection
                .execute_batch(super::migrations::MIGRATION_003)
                .expect("v3 schema");
            connection
                .pragma_update(None, "user_version", 3)
                .expect("v3 version");
            connection
                .execute(
                    "INSERT INTO commands (
                        id, title, command, description, shell, is_favorite,
                        sort_order, use_count, created_at, updated_at,
                        source_type, content_hash, ai_annotation_status
                     ) VALUES ('c1', '查看容器', 'docker ps -a', '手写说明', 'bash', 1,
                        10, 3, 1, 1, 'manual', 'hash', 'none')",
                    [],
                )
                .expect("legacy command");
        }

        let result = Database::open_or_recover(path).expect("migrate v4");
        let connection = result.database.lock();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, 5);
        let command: (String, String, String, String, i64) = connection
            .query_row(
                "SELECT title, command, description, ai_annotation_status, is_favorite
                 FROM commands WHERE id = 'c1'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("command preserved");
        assert_eq!(command.0, "查看容器");
        assert_eq!(command.1, "docker ps -a");
        assert_eq!(command.2, "手写说明");
        assert_eq!(command.3, "none");
        assert_eq!(command.4, 1);
        let annotations: i64 = connection
            .query_row("SELECT count(*) FROM ai_annotations", [], |row| row.get(0))
            .expect("annotation table");
        assert_eq!(annotations, 0);
    }

    #[test]
    fn failed_migration_rolls_back_and_preserves_original_tables() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path().join("commands.db");
        {
            let connection = Connection::open(&path).expect("open db");
            connection
                .execute_batch("CREATE TABLE commands (id TEXT); PRAGMA user_version = 0;")
                .expect("seed conflicting schema");
        }
        let error = Database::open_or_recover(path.clone())
            .err()
            .expect("migration must fail");
        assert!(matches!(error, DatabaseError::Migration { version: 1, .. }));

        let connection = Connection::open(&path).expect("reopen db");
        let categories: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'categories'",
                [],
                |row| row.get(0),
            )
            .expect("categories");
        assert_eq!(categories, 0, "failed migration must roll back");
        let commands: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'commands'",
                [],
                |row| row.get(0),
            )
            .expect("commands");
        assert_eq!(commands, 1, "original table must remain");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, 0);
    }

    #[test]
    fn future_schema_is_rejected() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path().join("commands.db");
        let connection = Connection::open(&path).expect("open db");
        connection
            .pragma_update(None, "user_version", 99)
            .expect("future version");
        drop(connection);
        let error = Database::open_or_recover(path).err().expect("must fail");
        assert!(matches!(
            error,
            DatabaseError::FutureSchema { found: 99, .. }
        ));
    }

    #[test]
    fn search_support_tables_are_present() {
        let (_temp, database) = open_temp();
        let connection = database.lock();
        let tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('commands', 'categories', 'tags', 'command_tags', 'clipboard_entries', 'ai_annotations')",
                [],
                |row| row.get(0),
            )
            .expect("tables");
        assert_eq!(tables, 6);
        let prompt_tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('prompts', 'prompt_categories', 'prompt_tags', 'prompts_fts')",
                [],
                |row| row.get(0),
            )
            .expect("prompt tables");
        assert_eq!(prompt_tables, 4);
        let _ = CommandQuery {
            filter: CommandFilter::All,
            ..CommandQuery::default()
        };
        let _ = CommandInput {
            title: "x".into(),
            command: "echo x".into(),
            description: String::new(),
            shell: "powershell".into(),
            category_id: None,
            tags: Vec::new(),
        };
    }

    #[test]
    fn schema_four_migrates_prompt_library_without_touching_commands() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path().join("commands.db");
        {
            let connection = Connection::open(&path).expect("open db");
            connection
                .execute_batch(super::migrations::MIGRATION_001)
                .expect("v1 schema");
            connection
                .execute_batch(super::migrations::MIGRATION_002)
                .expect("v2 schema");
            connection
                .execute_batch(super::migrations::MIGRATION_003)
                .expect("v3 schema");
            connection
                .execute_batch(super::migrations::MIGRATION_004)
                .expect("v4 schema");
            connection
                .pragma_update(None, "user_version", 4)
                .expect("v4 version");
            connection
                .execute(
                    "INSERT INTO commands (
                        id, title, command, description, shell, is_favorite,
                        sort_order, use_count, created_at, updated_at,
                        source_type, content_hash, ai_annotation_status
                     ) VALUES ('c1', '提示词前命令', 'docker ps', '', 'bash', 1,
                        10, 2, 1, 1, 'manual', 'hash', 'none')",
                    [],
                )
                .expect("legacy command");
        }

        let result = Database::open_or_recover(path).expect("migrate v5");
        let connection = result.database.lock();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, 5);
        let command: (String, i64) = connection
            .query_row(
                "SELECT title, is_favorite FROM commands WHERE id = 'c1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("command preserved");
        assert_eq!(command, ("提示词前命令".to_owned(), 1));
        let prompts: i64 = connection
            .query_row("SELECT count(*) FROM prompts", [], |row| row.get(0))
            .expect("prompts table");
        assert_eq!(prompts, 0);
    }
}
