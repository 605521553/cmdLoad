use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use uuid::Uuid;

use crate::models::{
    appearance::{normalize_category_icon, normalize_hex_color},
    command::{
        BackupInfo, ExportCategory, ExportCommand, ExportEnvelope, ExportTag, ImportMode,
        ImportReport, RestoreReport, COMMAND_EXPORT_SCHEMA_VERSION, SUPPORTED_SHELLS,
    },
    prompt::{ExportPrompt, ExportPromptCategory},
};

use super::{now_millis, repository::CommandRepository, LibraryError, LibraryService};

impl LibraryService<'_> {
    pub fn export_json(&self) -> Result<String, LibraryError> {
        let envelope = self
            .database
            .with_connection(|connection| CommandRepository::new(connection).export_envelope())?;
        Ok(serde_json::to_string_pretty(&envelope)?)
    }

    pub fn create_backup(&self, label: &str) -> Result<BackupInfo, LibraryError> {
        let label = sanitize_label(label);
        let stamp = now_millis();
        let path = self
            .database
            .backups_dir()
            .join(format!("{label}-{stamp}.db"));
        self.database.backup_to(&path)?;
        backup_info(&path)
    }

    pub fn list_backups(&self) -> Result<Vec<BackupInfo>, LibraryError> {
        fs::create_dir_all(self.database.backups_dir())?;
        let mut backups = Vec::new();
        for entry in fs::read_dir(self.database.backups_dir())? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("db") {
                continue;
            }
            if let Ok(info) = backup_info(&path) {
                backups.push(info);
            }
        }
        backups.sort_by_key(|backup| std::cmp::Reverse(backup.created_at));
        Ok(backups)
    }

    pub fn restore_backup(&self, file_name: &str) -> Result<RestoreReport, LibraryError> {
        let file_name = safe_backup_file_name(file_name)?;
        let backup_path = self.database.backups_dir().join(file_name);
        if !backup_path.is_file() {
            return Err(LibraryError::Validation("所选备份不存在。".to_owned()));
        }

        let (active_count, category_count, tag_count, prompt_count, prompt_category_count) =
            validate_database_backup(&backup_path)?;
        let pre_restore = self.create_backup("pre-restore")?;

        let path_string = backup_path.to_string_lossy().to_string();
        self.database.with_connection(|connection| {
            connection.execute("ATTACH DATABASE ?1 AS restore_db", [&path_string])?;
            let result = (|| {
                connection.pragma_update(None, "defer_foreign_keys", "ON")?;
                let has_annotation_table: bool = connection.query_row(
                    "SELECT count(*) FROM restore_db.sqlite_master
                     WHERE type = 'table' AND name = 'ai_annotations'",
                    [],
                    |row| Ok(row.get::<_, i64>(0)? > 0),
                )?;
                let transaction = connection.transaction()?;
                transaction.execute_batch(
                    "DELETE FROM ai_annotations;
                     DELETE FROM clipboard_entries;
                     DELETE FROM command_tags;
                     DELETE FROM commands;
                     DELETE FROM commands_fts;
                     DELETE FROM prompt_tags;
                     DELETE FROM prompts;
                     DELETE FROM prompts_fts;
                     DELETE FROM prompt_categories;
                     DELETE FROM categories;
                     DELETE FROM tags;",
                )?;
                transaction.execute(
                    "INSERT INTO categories (id, name, parent_id, sort_order, created_at,
                        updated_at, color, icon_name)
                     SELECT id, name, parent_id, sort_order, created_at, updated_at,
                        color, icon_name
                     FROM restore_db.categories",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO tags (id, name, color, created_at)
                     SELECT id, name, color, created_at FROM restore_db.tags",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO commands (id, title, command, description, shell, category_id,
                        is_favorite, sort_order, use_count, last_used_at, created_at, updated_at, deleted_at,
                        source_type, content_hash, ai_annotation_status,
                        background_color, use_category_color)
                     SELECT id, title, command, description, shell, category_id,
                        is_favorite, sort_order, use_count, last_used_at, created_at, updated_at, deleted_at,
                        source_type, content_hash, ai_annotation_status,
                        background_color, use_category_color
                     FROM restore_db.commands",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO command_tags (command_id, tag_id)
                     SELECT command_id, tag_id FROM restore_db.command_tags",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO prompt_categories (
                        id, name, parent_id, sort_order, created_at, updated_at,
                        color, icon_name)
                     SELECT id, name, parent_id, sort_order, created_at, updated_at,
                        color, icon_name
                     FROM restore_db.prompt_categories",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO prompts (
                        id, title, content, category_id, background_color,
                        is_favorite, sort_order, use_count, last_used_at,
                        created_at, updated_at, deleted_at)
                     SELECT id, title, content, category_id, background_color,
                        is_favorite, sort_order, use_count, last_used_at,
                        created_at, updated_at, deleted_at
                     FROM restore_db.prompts",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO prompt_tags (prompt_id, tag_id)
                     SELECT prompt_id, tag_id FROM restore_db.prompt_tags",
                    [],
                )?;
                if has_annotation_table {
                    transaction.execute(
                        "INSERT INTO ai_annotations (
                            id, command_id, short_description, detailed_description,
                            parameters_json, requirements_json, warnings_json,
                            suggested_shell, risk_level, provider, model,
                            command_content_hash, prompt_version, generated_at, updated_at)
                         SELECT id, command_id, short_description, detailed_description,
                            parameters_json, requirements_json, warnings_json,
                            suggested_shell, risk_level, provider, model,
                            command_content_hash, prompt_version, generated_at, updated_at
                         FROM restore_db.ai_annotations",
                        [],
                    )?;
                } else {
                    // Older backups have no AI table; leave all rows retryable.
                    transaction.execute(
                        "UPDATE commands SET ai_annotation_status = 'none'",
                        [],
                    )?;
                }
                // Do not leave a ready/pending marker without its actual
                // annotation after restoring an older or partial backup.
                transaction.execute(
                    "UPDATE commands SET ai_annotation_status =
                        CASE WHEN EXISTS (
                            SELECT 1 FROM ai_annotations a WHERE a.command_id = commands.id
                        ) THEN 'ready'
                        WHEN ai_annotation_status = 'pending' THEN 'failed'
                        ELSE 'none' END",
                    [],
                )?;
                transaction.execute(
                    "INSERT INTO clipboard_entries (id, content, content_hash, source, content_type,
                        copied_at, is_sensitive, linked_command_id)
                     SELECT id, content, content_hash, source, content_type,
                        copied_at, is_sensitive, linked_command_id
                     FROM restore_db.clipboard_entries",
                    [],
                )?;
                transaction.commit()?;
                Ok::<_, LibraryError>(())
            })();
            let detach = connection.execute("DETACH DATABASE restore_db", []);
            let _ = connection.pragma_update(None, "defer_foreign_keys", "OFF");
            result?;
            detach?;
            Ok::<_, LibraryError>(())
        })?;

        Ok(RestoreReport {
            commands: active_count,
            categories: category_count,
            tags: tag_count,
            prompts: prompt_count,
            prompt_categories: prompt_category_count,
            pre_restore_backup: pre_restore.path,
        })
    }

    pub fn import_json(&self, json: &str, mode: ImportMode) -> Result<ImportReport, LibraryError> {
        if json.len() > 100 * 1024 * 1024 {
            return Err(LibraryError::Validation(
                "导入文件不能超过 100 MB。".to_owned(),
            ));
        }
        let envelope: ExportEnvelope = serde_json::from_str(json)?;
        validate_envelope(&envelope)?;
        let backup = self.create_backup("pre-import")?;
        let now = now_millis();

        self.database.with_connection(|connection| {
            connection.pragma_update(None, "defer_foreign_keys", "ON")?;
            let result = (|| {
                let transaction = connection.transaction()?;
                let mut report = match mode {
                    ImportMode::Replace => {
                        replace_import(&transaction, &envelope, now, &backup.path)?
                    }
                    ImportMode::Merge => merge_import(&transaction, &envelope, now)?,
                };
                report.backup_path = Some(backup.path.clone());
                transaction.commit()?;
                Ok::<_, LibraryError>(report)
            })();
            let _ = connection.pragma_update(None, "defer_foreign_keys", "OFF");
            result
        })
    }
}

fn replace_import(
    connection: &Connection,
    envelope: &ExportEnvelope,
    now: i64,
    backup_path: &str,
) -> Result<ImportReport, LibraryError> {
    let replace_prompts = envelope.prompts.is_some() || envelope.prompt_categories.is_some();
    connection.execute_batch(
        "DELETE FROM command_tags;
         DELETE FROM commands;
         DELETE FROM commands_fts;
         DELETE FROM categories;",
    )?;
    if replace_prompts {
        connection.execute_batch(
            "DELETE FROM prompt_tags;
             DELETE FROM prompts;
             DELETE FROM prompts_fts;
             DELETE FROM prompt_categories;
             DELETE FROM tags;",
        )?;
    } else {
        // A schema 1–3 file only replaces the command library. Keep tags that
        // are referenced by the independent prompt library.
        connection.execute(
            "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM prompt_tags)",
            [],
        )?;
    }
    insert_categories(connection, &envelope.categories)?;
    insert_tags(connection, &envelope.tags)?;
    for command in &envelope.commands {
        insert_command(connection, command)?;
        replace_command_tags(connection, &command.id, &command.tags, now)?;
    }

    let prompt_categories = envelope.prompt_categories.as_deref().unwrap_or(&[]);
    let prompts = envelope.prompts.as_deref().unwrap_or(&[]);
    if replace_prompts {
        insert_prompt_categories(connection, prompt_categories)?;
        for prompt in prompts {
            insert_prompt(connection, prompt)?;
            replace_prompt_tags(connection, &prompt.id, &prompt.tags, now)?;
        }
    }

    Ok(ImportReport {
        mode: ImportMode::Replace,
        categories_added: envelope.categories.len(),
        tags_added: envelope.tags.len(),
        commands_added: envelope.commands.len(),
        commands_skipped: 0,
        prompt_categories_added: if replace_prompts {
            prompt_categories.len()
        } else {
            0
        },
        prompts_added: if replace_prompts { prompts.len() } else { 0 },
        prompts_skipped: 0,
        backup_path: Some(backup_path.to_owned()),
    })
}

fn merge_import(
    connection: &Connection,
    envelope: &ExportEnvelope,
    now: i64,
) -> Result<ImportReport, LibraryError> {
    let mut category_map: HashMap<String, String> = HashMap::new();
    let mut categories_added = 0;
    let mut categories_by_id: HashMap<&str, &ExportCategory> = envelope
        .categories
        .iter()
        .map(|category| (category.id.as_str(), category))
        .collect();
    for category in &envelope.categories {
        if resolve_category(
            connection,
            category.id.as_str(),
            &mut category_map,
            &mut categories_by_id,
            now,
        )? {
            categories_added += 1;
        }
    }

    let mut tags_added = 0;
    for tag in &envelope.tags {
        if insert_tag_if_missing(connection, tag)? {
            tags_added += 1;
        }
    }

    let mut commands_added = 0;
    let mut commands_skipped = 0;
    for command in &envelope.commands {
        let exists: i64 = connection.query_row(
            "SELECT count(*) FROM commands WHERE id = ?1",
            [&command.id],
            |row| row.get(0),
        )?;
        if exists > 0 {
            commands_skipped += 1;
            continue;
        }
        let category_id = command
            .category_id
            .as_ref()
            .map(|id| {
                category_map
                    .get(id)
                    .cloned()
                    .ok_or_else(|| LibraryError::Validation("导入命令引用了未知目录。".to_owned()))
            })
            .transpose()?;
        let mut command = command.clone();
        command.category_id = category_id;
        insert_command(connection, &command)?;
        replace_command_tags(connection, &command.id, &command.tags, now)?;
        commands_added += 1;
    }

    let mut prompt_categories_added = 0usize;
    let mut prompt_category_map: HashMap<String, String> = HashMap::new();
    if let Some(categories) = envelope.prompt_categories.as_deref() {
        let mut categories_by_id: HashMap<&str, &ExportPromptCategory> = categories
            .iter()
            .map(|category| (category.id.as_str(), category))
            .collect();
        for category in categories {
            if resolve_prompt_category(
                connection,
                category.id.as_str(),
                &mut prompt_category_map,
                &mut categories_by_id,
                now,
            )? {
                prompt_categories_added += 1;
            }
        }
    }

    let mut prompts_added = 0usize;
    let mut prompts_skipped = 0usize;
    for prompt in envelope.prompts.iter().flatten() {
        let exists: i64 = connection.query_row(
            "SELECT count(*) FROM prompts
             WHERE id = ?1 OR (deleted_at IS NULL AND content = ?2)",
            params![prompt.id, prompt.content],
            |row| row.get(0),
        )?;
        if exists > 0 {
            prompts_skipped += 1;
            continue;
        }
        let category_id = prompt
            .category_id
            .as_ref()
            .map(|id| {
                prompt_category_map.get(id).cloned().ok_or_else(|| {
                    LibraryError::Validation("导入提示词引用了未知目录。".to_owned())
                })
            })
            .transpose()?;
        let mut prompt = prompt.clone();
        prompt.category_id = category_id;
        insert_prompt(connection, &prompt)?;
        replace_prompt_tags(connection, &prompt.id, &prompt.tags, now)?;
        prompts_added += 1;
    }

    Ok(ImportReport {
        mode: ImportMode::Merge,
        categories_added,
        tags_added,
        commands_added,
        commands_skipped,
        prompt_categories_added,
        prompts_added,
        prompts_skipped,
        backup_path: None,
    })
}

fn resolve_category(
    connection: &Connection,
    id: &str,
    map: &mut HashMap<String, String>,
    categories: &mut HashMap<&str, &ExportCategory>,
    now: i64,
) -> Result<bool, LibraryError> {
    if map.contains_key(id) {
        return Ok(false);
    }
    let category = categories
        .get(id)
        .copied()
        .ok_or_else(|| LibraryError::Validation("导入目录引用了未知父目录。".to_owned()))?
        .clone();
    let parent_actual = match category.parent_id.as_deref() {
        Some(parent) => {
            resolve_category(connection, parent, map, categories, now)?;
            map.get(parent).cloned()
        }
        None => None,
    };

    let existing_id: Option<String> = connection
        .query_row(
            "SELECT id FROM categories WHERE id = ?1",
            [&category.id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(existing) = existing_id {
        map.insert(id.to_owned(), existing);
        return Ok(false);
    }
    let same_name: Option<String> = connection
        .query_row(
            "SELECT id FROM categories WHERE name = ?1 COLLATE NOCASE AND parent_id IS ?2",
            params![category.name.trim(), parent_actual],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(existing) = same_name {
        map.insert(id.to_owned(), existing);
        return Ok(false);
    }

    connection.execute(
        "INSERT INTO categories (id, name, parent_id, sort_order, created_at,
            updated_at, color, icon_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            category.id,
            category.name.trim(),
            parent_actual,
            category.sort_order,
            category.created_at.max(0),
            category.updated_at.max(0),
            sanitize_import_color(category.color.as_deref()),
            sanitize_import_icon(category.icon_name.as_deref())
        ],
    )?;
    map.insert(id.to_owned(), category.id.clone());
    let _ = now;
    Ok(true)
}

fn resolve_prompt_category(
    connection: &Connection,
    id: &str,
    map: &mut HashMap<String, String>,
    categories: &mut HashMap<&str, &ExportPromptCategory>,
    now: i64,
) -> Result<bool, LibraryError> {
    if map.contains_key(id) {
        return Ok(false);
    }
    let category = categories
        .get(id)
        .copied()
        .ok_or_else(|| LibraryError::Validation("导入提示词目录引用了未知父目录。".to_owned()))?
        .clone();
    let parent_actual = match category.parent_id.as_deref() {
        Some(parent) => {
            resolve_prompt_category(connection, parent, map, categories, now)?;
            map.get(parent).cloned()
        }
        None => None,
    };

    let existing_id: Option<String> = connection
        .query_row(
            "SELECT id FROM prompt_categories WHERE id = ?1",
            [&category.id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(existing) = existing_id {
        map.insert(id.to_owned(), existing);
        return Ok(false);
    }
    let same_name: Option<String> = connection
        .query_row(
            "SELECT id FROM prompt_categories
             WHERE name = ?1 COLLATE NOCASE AND parent_id IS ?2",
            params![category.name.trim(), parent_actual],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(existing) = same_name {
        map.insert(id.to_owned(), existing);
        return Ok(false);
    }

    connection.execute(
        "INSERT INTO prompt_categories (id, name, parent_id, sort_order, created_at,
            updated_at, color, icon_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            category.id,
            category.name.trim(),
            parent_actual,
            category.sort_order,
            category.created_at.max(0),
            category.updated_at.max(0),
            sanitize_import_color(category.color.as_deref()),
            sanitize_import_icon(category.icon_name.as_deref())
        ],
    )?;
    map.insert(id.to_owned(), category.id.clone());
    let _ = now;
    Ok(true)
}

fn insert_prompt_categories(
    connection: &Connection,
    categories: &[ExportPromptCategory],
) -> Result<(), LibraryError> {
    let mut statement = connection.prepare(
        "INSERT INTO prompt_categories (id, name, parent_id, sort_order, created_at,
            updated_at, color, icon_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for category in categories {
        statement.execute(params![
            category.id,
            category.name.trim(),
            category.parent_id,
            category.sort_order,
            category.created_at.max(0),
            category.updated_at.max(0),
            sanitize_import_color(category.color.as_deref()),
            sanitize_import_icon(category.icon_name.as_deref())
        ])?;
    }
    Ok(())
}

fn insert_prompt(connection: &Connection, prompt: &ExportPrompt) -> Result<(), LibraryError> {
    let title = prompt.title.trim().chars().take(200).collect::<String>();
    connection.execute(
        "INSERT INTO prompts (
            id, title, content, category_id, background_color, is_favorite,
            sort_order, use_count, last_used_at, created_at, updated_at, deleted_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL)",
        params![
            prompt.id,
            title,
            prompt.content,
            prompt.category_id,
            sanitize_import_color(prompt.background_color.as_deref()),
            prompt.is_favorite as i64,
            prompt.sort_order,
            prompt.use_count.max(0),
            prompt.last_used_at,
            prompt.created_at.max(0),
            prompt.updated_at.max(0)
        ],
    )?;
    Ok(())
}

fn replace_prompt_tags(
    connection: &Connection,
    prompt_id: &str,
    tags: &[String],
    now: i64,
) -> Result<(), LibraryError> {
    let mut seen = HashSet::new();
    for name in tags {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let key = name.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let existing: Option<String> = connection
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                [name],
                |row| row.get(0),
            )
            .optional()?;
        let tag_id = if let Some(id) = existing {
            id
        } else {
            let id = Uuid::new_v4().to_string();
            connection.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, NULL, ?3)",
                params![id, name, now],
            )?;
            id
        };
        connection.execute(
            "INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?1, ?2)",
            params![prompt_id, tag_id],
        )?;
    }
    Ok(())
}

fn insert_categories(
    connection: &Connection,
    categories: &[ExportCategory],
) -> Result<(), LibraryError> {
    let mut statement = connection.prepare(
        "INSERT INTO categories (id, name, parent_id, sort_order, created_at,
            updated_at, color, icon_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for category in categories {
        statement.execute(params![
            category.id,
            category.name.trim(),
            category.parent_id,
            category.sort_order,
            category.created_at.max(0),
            category.updated_at.max(0),
            sanitize_import_color(category.color.as_deref()),
            sanitize_import_icon(category.icon_name.as_deref())
        ])?;
    }
    Ok(())
}

/// Imported appearance data is sanitized, never trusted blindly. Unknown icons
/// fall back to the default folder icon and malformed colors are dropped while
/// the original command/category content is still imported.
fn sanitize_import_color(value: Option<&str>) -> Option<String> {
    value.and_then(normalize_hex_color)
}

fn sanitize_import_icon(value: Option<&str>) -> Option<String> {
    value.and_then(normalize_category_icon)
}

fn insert_tags(connection: &Connection, tags: &[ExportTag]) -> Result<(), LibraryError> {
    let mut statement = connection
        .prepare("INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)")?;
    for tag in tags {
        statement.execute(params![
            tag.id,
            tag.name.trim(),
            tag.color,
            tag.created_at.max(0)
        ])?;
    }
    Ok(())
}

fn insert_tag_if_missing(connection: &Connection, tag: &ExportTag) -> Result<bool, LibraryError> {
    let exists: i64 = connection.query_row(
        "SELECT count(*) FROM tags WHERE id = ?1 OR name = ?2 COLLATE NOCASE",
        params![tag.id, tag.name.trim()],
        |row| row.get(0),
    )?;
    if exists > 0 {
        return Ok(false);
    }
    connection.execute(
        "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![tag.id, tag.name.trim(), tag.color, tag.created_at.max(0)],
    )?;
    Ok(true)
}

fn insert_command(connection: &Connection, command: &ExportCommand) -> Result<(), LibraryError> {
    let source_type = if crate::models::command::is_supported_command_source(&command.source_type) {
        command.source_type.as_str()
    } else {
        crate::models::command::COMMAND_SOURCE_IMPORT
    };
    // AI annotations are not part of the versioned JSON envelope. Never import a
    // stale "ready"/"pending" marker without its annotation row.
    let ai_status = "none";
    let title = if command.title.trim().is_empty() {
        crate::services::clipboard::suggest_title(&command.command)
    } else {
        command.title.trim().chars().take(200).collect::<String>()
    };
    connection.execute(
        "INSERT INTO commands (
            id, title, command, description, shell, category_id, is_favorite,
            sort_order, use_count, last_used_at, created_at, updated_at, deleted_at,
            source_type, content_hash, ai_annotation_status,
            background_color, use_category_color
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13, ?14, ?15, ?16, ?17)",
        params![
            command.id,
            title,
            command.command,
            command.description,
            command.shell,
            command.category_id,
            command.is_favorite as i64,
            command.sort_order,
            command.use_count.max(0),
            command.last_used_at,
            command.created_at.max(0),
            command.updated_at.max(0),
            source_type,
            crate::services::clipboard::content_hash(&command.command),
            ai_status,
            sanitize_import_color(command.background_color.as_deref()),
            command.use_category_color as i64
        ],
    )?;
    Ok(())
}

fn replace_command_tags(
    connection: &Connection,
    command_id: &str,
    tags: &[String],
    now: i64,
) -> Result<(), LibraryError> {
    let mut seen = HashSet::new();
    for name in tags {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let key = name.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let existing: Option<String> = connection
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                [name],
                |row| row.get(0),
            )
            .optional()?;
        let tag_id = if let Some(id) = existing {
            id
        } else {
            let id = Uuid::new_v4().to_string();
            connection.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, NULL, ?3)",
                params![id, name, now],
            )?;
            id
        };
        connection.execute(
            "INSERT OR IGNORE INTO command_tags (command_id, tag_id) VALUES (?1, ?2)",
            params![command_id, tag_id],
        )?;
    }
    Ok(())
}

fn validate_envelope(envelope: &ExportEnvelope) -> Result<(), LibraryError> {
    if !(crate::models::command::MIN_SUPPORTED_COMMAND_EXPORT_SCHEMA
        ..=COMMAND_EXPORT_SCHEMA_VERSION)
        .contains(&envelope.schema_version)
    {
        return Err(LibraryError::Validation(format!(
            "不支持的导入版本 {}，当前支持版本 {}–{}。",
            envelope.schema_version,
            crate::models::command::MIN_SUPPORTED_COMMAND_EXPORT_SCHEMA,
            COMMAND_EXPORT_SCHEMA_VERSION
        )));
    }
    if envelope.commands.len() > 10_000 {
        return Err(LibraryError::Validation(
            "单次最多导入 10000 条命令。".to_owned(),
        ));
    }
    let mut category_ids = HashSet::new();
    let mut category_names = HashSet::new();
    for category in &envelope.categories {
        validate_uuid(&category.id, "目录")?;
        if !category_ids.insert(category.id.as_str()) {
            return Err(LibraryError::Validation("导入目录 ID 重复。".to_owned()));
        }
        let name = category.name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(LibraryError::Validation("导入目录名称无效。".to_owned()));
        }
        let key = (
            category.parent_id.clone().unwrap_or_default(),
            name.to_lowercase(),
        );
        if !category_names.insert(key) {
            return Err(LibraryError::Validation(
                "同一父目录下存在重名目录。".to_owned(),
            ));
        }
        if category.parent_id.as_deref() == Some(category.id.as_str()) {
            return Err(LibraryError::Validation(
                "导入目录不能以自身为父级。".to_owned(),
            ));
        }
    }
    for category in &envelope.categories {
        if let Some(parent) = &category.parent_id {
            if !category_ids.contains(parent.as_str()) {
                return Err(LibraryError::Validation(
                    "导入目录引用了不存在的父目录。".to_owned(),
                ));
            }
        }
    }
    detect_category_cycles(&envelope.categories)?;

    let mut tag_ids = HashSet::new();
    let mut tag_names = HashSet::new();
    for tag in &envelope.tags {
        validate_uuid(&tag.id, "标签")?;
        if !tag_ids.insert(tag.id.as_str()) {
            return Err(LibraryError::Validation("导入标签 ID 重复。".to_owned()));
        }
        let name = tag.name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err(LibraryError::Validation("导入标签名称无效。".to_owned()));
        }
        if !tag_names.insert(name.to_lowercase()) {
            return Err(LibraryError::Validation("导入标签名称重复。".to_owned()));
        }
    }

    let mut command_ids = HashSet::new();
    for command in &envelope.commands {
        validate_uuid(&command.id, "命令")?;
        if !command_ids.insert(command.id.as_str()) {
            return Err(LibraryError::Validation("导入命令 ID 重复。".to_owned()));
        }
        if command.title.trim().is_empty() || command.title.chars().count() > 200 {
            return Err(LibraryError::Validation("导入命令标题无效。".to_owned()));
        }
        if command.command.trim().is_empty() || command.command.chars().count() > 100_000 {
            return Err(LibraryError::Validation("导入命令原文无效。".to_owned()));
        }
        if !SUPPORTED_SHELLS.contains(&command.shell.as_str()) {
            return Err(LibraryError::Validation(
                "导入命令包含不支持的 Shell。".to_owned(),
            ));
        }
        if let Some(category) = &command.category_id {
            if !category_ids.contains(category.as_str()) {
                return Err(LibraryError::Validation(
                    "导入命令引用了不存在的目录。".to_owned(),
                ));
            }
        }
        if command.tags.len() > 24 {
            return Err(LibraryError::Validation("导入命令标签过多。".to_owned()));
        }
        for tag in &command.tags {
            if tag.trim().is_empty() || tag.chars().count() > 40 {
                return Err(LibraryError::Validation(
                    "导入命令包含无效标签。".to_owned(),
                ));
            }
        }
        if command.use_count < 0 {
            return Err(LibraryError::Validation(
                "导入命令使用次数无效。".to_owned(),
            ));
        }
    }
    let mut prompt_category_ids = HashSet::new();
    if let Some(categories) = envelope.prompt_categories.as_deref() {
        let mut prompt_category_names = HashSet::new();
        for category in categories {
            validate_uuid(&category.id, "提示词目录")?;
            if !prompt_category_ids.insert(category.id.as_str()) {
                return Err(LibraryError::Validation(
                    "导入提示词目录 ID 重复。".to_owned(),
                ));
            }
            let name = category.name.trim();
            if name.is_empty() || name.chars().count() > 80 {
                return Err(LibraryError::Validation(
                    "导入提示词目录名称无效。".to_owned(),
                ));
            }
            let key = (
                category.parent_id.clone().unwrap_or_default(),
                name.to_lowercase(),
            );
            if !prompt_category_names.insert(key) {
                return Err(LibraryError::Validation(
                    "同一父目录下存在重名提示词目录。".to_owned(),
                ));
            }
            if category.parent_id.as_deref() == Some(category.id.as_str()) {
                return Err(LibraryError::Validation(
                    "导入提示词目录不能以自身为父级。".to_owned(),
                ));
            }
        }
        for category in categories {
            if let Some(parent) = &category.parent_id {
                if !prompt_category_ids.contains(parent.as_str()) {
                    return Err(LibraryError::Validation(
                        "导入提示词目录引用了不存在的父目录。".to_owned(),
                    ));
                }
            }
        }
        detect_prompt_category_cycles(categories)?;
    }

    if let Some(prompts) = envelope.prompts.as_deref() {
        if prompts.len() > 10_000 {
            return Err(LibraryError::Validation(
                "单次最多导入 10000 条提示词。".to_owned(),
            ));
        }
        let mut prompt_ids = HashSet::new();
        for prompt in prompts {
            validate_uuid(&prompt.id, "提示词")?;
            if !prompt_ids.insert(prompt.id.as_str()) {
                return Err(LibraryError::Validation("导入提示词 ID 重复。".to_owned()));
            }
            if prompt.content.trim().is_empty()
                || prompt.content.chars().count() > crate::models::prompt::MAX_PROMPT_CONTENT_CHARS
            {
                return Err(LibraryError::Validation("导入提示词内容无效。".to_owned()));
            }
            if prompt.title.chars().count() > 200 {
                return Err(LibraryError::Validation("导入提示词标题过长。".to_owned()));
            }
            if let Some(category) = &prompt.category_id {
                if !prompt_category_ids.contains(category.as_str()) {
                    return Err(LibraryError::Validation(
                        "导入提示词引用了不存在的目录。".to_owned(),
                    ));
                }
            }
            if prompt.tags.len() > 24 {
                return Err(LibraryError::Validation("导入提示词标签过多。".to_owned()));
            }
            for tag in &prompt.tags {
                if tag.trim().is_empty() || tag.chars().count() > 40 {
                    return Err(LibraryError::Validation(
                        "导入提示词包含无效标签。".to_owned(),
                    ));
                }
            }
            if prompt.use_count < 0 {
                return Err(LibraryError::Validation(
                    "导入提示词使用次数无效。".to_owned(),
                ));
            }
        }
    }
    Ok(())
}

fn detect_prompt_category_cycles(categories: &[ExportPromptCategory]) -> Result<(), LibraryError> {
    let parents: HashMap<&str, Option<&str>> = categories
        .iter()
        .map(|category| (category.id.as_str(), category.parent_id.as_deref()))
        .collect();
    for category in categories {
        let mut seen = HashSet::new();
        let mut current = Some(category.id.as_str());
        while let Some(id) = current {
            if !seen.insert(id) {
                return Err(LibraryError::Validation(
                    "导入提示词目录存在循环引用。".to_owned(),
                ));
            }
            current = parents.get(id).and_then(|parent| *parent);
        }
    }
    Ok(())
}

fn detect_category_cycles(categories: &[ExportCategory]) -> Result<(), LibraryError> {
    let parents: HashMap<&str, Option<&str>> = categories
        .iter()
        .map(|category| (category.id.as_str(), category.parent_id.as_deref()))
        .collect();
    for category in categories {
        let mut seen = HashSet::new();
        let mut current = Some(category.id.as_str());
        while let Some(id) = current {
            if !seen.insert(id) {
                return Err(LibraryError::Validation(
                    "导入目录存在循环引用。".to_owned(),
                ));
            }
            current = parents.get(id).and_then(|parent| *parent);
        }
    }
    Ok(())
}

fn validate_uuid(id: &str, entity: &str) -> Result<(), LibraryError> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| LibraryError::Validation(format!("导入{entity} ID 不是有效 UUID。")))
}

fn validate_database_backup(
    path: &Path,
) -> Result<(usize, usize, usize, usize, usize), LibraryError> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if !integrity.eq_ignore_ascii_case("ok") {
        return Err(LibraryError::Validation(format!(
            "备份完整性检查失败：{integrity}"
        )));
    }
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version != crate::services::database::DATABASE_SCHEMA_VERSION as i64 {
        return Err(LibraryError::Validation(
            "该备份的数据库版本与当前应用不一致。".to_owned(),
        ));
    }
    for table in [
        "commands",
        "categories",
        "tags",
        "command_tags",
        "clipboard_entries",
        "prompts",
        "prompt_categories",
        "prompt_tags",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(LibraryError::Validation(
                "该文件不是有效的命令数据库备份。".to_owned(),
            ));
        }
    }
    let commands: i64 = connection.query_row(
        "SELECT count(*) FROM commands WHERE deleted_at IS NULL",
        [],
        |row| row.get(0),
    )?;
    let categories: i64 =
        connection.query_row("SELECT count(*) FROM categories", [], |row| row.get(0))?;
    let tags: i64 = connection.query_row("SELECT count(*) FROM tags", [], |row| row.get(0))?;
    let prompts: i64 = connection.query_row(
        "SELECT count(*) FROM prompts WHERE deleted_at IS NULL",
        [],
        |row| row.get(0),
    )?;
    let prompt_categories: i64 =
        connection.query_row("SELECT count(*) FROM prompt_categories", [], |row| {
            row.get(0)
        })?;
    Ok((
        commands as usize,
        categories as usize,
        tags as usize,
        prompts as usize,
        prompt_categories as usize,
    ))
}

fn backup_info(path: &Path) -> Result<BackupInfo, LibraryError> {
    let metadata = fs::metadata(path)?;
    let created_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    Ok(BackupInfo {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("backup.db")
            .to_owned(),
        path: path.display().to_string(),
        size_bytes: metadata.len(),
        created_at,
    })
}

fn sanitize_label(label: &str) -> String {
    let label = label
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(32)
        .collect::<String>();
    if label.is_empty() {
        "backup".to_owned()
    } else {
        label
    }
}

fn safe_backup_file_name(file_name: &str) -> Result<&str, LibraryError> {
    let path = PathBuf::from(file_name);
    let is_single_component = path.components().count() == 1;
    let is_db = file_name.ends_with(".db");
    if !is_single_component
        || !is_db
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.starts_with('.')
    {
        return Err(LibraryError::Validation("备份文件名无效。".to_owned()));
    }
    Ok(file_name)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use tempfile::tempdir;

    use super::*;
    use crate::{
        models::{
            ai::{
                AiAnnotationDraft, GeneratedAiAnnotation, ManualAnnotationMode,
                SaveAiAnnotationInput, AI_PROMPT_VERSION,
            },
            command::{CategoryInput, CommandInput, CommandQuery},
            prompt::{PromptInput, PromptQuery},
        },
        services::{
            ai::AiService, clipboard::ClipboardWriter, database::Database, prompts::PromptService,
        },
    };

    struct FakeClipboard(Mutex<Vec<String>>);
    impl ClipboardWriter for FakeClipboard {
        fn write_text(&self, text: &str) -> Result<(), String> {
            self.0.lock().expect("clipboard").push(text.to_owned());
            Ok(())
        }
    }

    fn setup() -> (tempfile::TempDir, Database, FakeClipboard) {
        let temp = tempdir().expect("temp dir");
        let database = Database::open_or_recover(temp.path().join("commands.db"))
            .expect("db")
            .database;
        let clipboard = FakeClipboard(Mutex::new(Vec::new()));
        (temp, database, clipboard)
    }

    fn seed(service: &LibraryService<'_>) -> (String, String) {
        let category = service
            .create_category(CategoryInput {
                name: "数据库".to_owned(),
                parent_id: None,
            })
            .expect("category");
        let mut input = CommandInput {
            title: "备份数据库".to_owned(),
            command: "pg_dump app > backup.sql".to_owned(),
            description: "导出生产库".to_owned(),
            shell: "bash".to_owned(),
            category_id: Some(category),
            tags: vec!["数据库".to_owned(), "运维".to_owned()],
        };
        let command = service.create_command(input.clone()).expect("command");
        input.title = "查看状态".to_owned();
        input.command = "git status".to_owned();
        input.category_id = None;
        service.create_command(input).expect("second");
        (command.id, service.export_json().expect("export"))
    }

    #[test]
    fn json_export_can_be_merged_without_duplicating_existing_ids() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let (_, json) = seed(&service);
        let report = service
            .import_json(&json, ImportMode::Merge)
            .expect("merge");
        assert_eq!(report.commands_added, 0);
        assert_eq!(report.commands_skipped, 2);
        assert!(report.backup_path.is_some());
        let commands = service
            .list_commands(&CommandQuery::default())
            .expect("list");
        assert_eq!(commands.len(), 2);

        service
            .import_json(&json, ImportMode::Replace)
            .expect("replace");
        let commands = service
            .list_commands(&CommandQuery::default())
            .expect("list");
        assert_eq!(commands.len(), 2);
    }

    #[test]
    fn json_round_trip_preserves_command_source_and_legacy_defaults() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        service
            .save_clipboard_text(
                "docker ps -a",
                crate::models::clipboard::ClipboardSource::Current,
                false,
            )
            .expect("clipboard save");
        let json = service.export_json().expect("export");
        assert!(json.contains("\"sourceType\": \"clipboard_current\""));

        service
            .import_json(&json, ImportMode::Replace)
            .expect("replace current source");
        let commands = service
            .list_commands(&CommandQuery::default())
            .expect("list");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].source_type, "clipboard_current");
        assert_eq!(commands[0].ai_annotation_status, "none");

        let mut legacy: serde_json::Value = serde_json::from_str(&json).expect("json value");
        if let Some(object) = legacy.as_object_mut() {
            object.insert("schemaVersion".to_owned(), serde_json::Value::from(1));
        }
        if let Some(items) = legacy
            .get_mut("commands")
            .and_then(serde_json::Value::as_array_mut)
        {
            for item in items {
                if let Some(object) = item.as_object_mut() {
                    object.remove("sourceType");
                    object.remove("aiAnnotationStatus");
                }
            }
        }
        let legacy_json = serde_json::to_string(&legacy).expect("legacy json");
        service
            .import_json(&legacy_json, ImportMode::Replace)
            .expect("legacy replace");
        let commands = service
            .list_commands(&CommandQuery::default())
            .expect("legacy list");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].source_type, "import");
        assert_eq!(commands[0].ai_annotation_status, "none");
    }

    #[test]
    fn json_round_trip_preserves_command_and_category_appearance() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "容器".to_owned(),
                parent_id: None,
            })
            .expect("category");
        service
            .set_category_appearance(
                &category,
                crate::models::command::CategoryAppearanceInput {
                    color: Some("#edf8f2".to_owned()),
                    icon_name: Some("container".to_owned()),
                },
            )
            .expect("category appearance");
        let command = service
            .create_command(CommandInput {
                title: "查看容器".to_owned(),
                command: "docker ps".to_owned(),
                description: String::new(),
                shell: "unknown".to_owned(),
                category_id: Some(category.clone()),
                tags: Vec::new(),
            })
            .expect("command");
        service
            .set_commands_color(std::slice::from_ref(&command.id), Some("#fceef0"))
            .expect("command color");
        service
            .set_commands_follow_category_color(std::slice::from_ref(&command.id), true)
            .expect("follow");

        let json = service.export_json().expect("export");
        assert!(json.contains("\"backgroundColor\": \"#FCEEF0\""));
        assert!(json.contains("\"useCategoryColor\": true"));
        assert!(json.contains("\"iconName\": \"container\""));
        assert!(json.contains("\"color\": \"#EDF8F2\""));

        service
            .import_json(&json, ImportMode::Replace)
            .expect("replace");
        let commands = service
            .list_commands(&CommandQuery::default())
            .expect("commands");
        assert_eq!(commands[0].background_color.as_deref(), Some("#FCEEF0"));
        assert!(commands[0].use_category_color);
        assert_eq!(commands[0].category_color.as_deref(), Some("#EDF8F2"));
        assert_eq!(commands[0].category_icon_name.as_deref(), Some("container"));
        let tree = service.list_categories().expect("categories");
        assert_eq!(tree[0].color.as_deref(), Some("#EDF8F2"));
        assert_eq!(tree[0].icon_name.as_deref(), Some("container"));
    }

    #[test]
    fn import_sanitizes_unknown_icons_and_accepts_legacy_schema_2() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let category = service
            .create_category(CategoryInput {
                name: "未知图标".to_owned(),
                parent_id: None,
            })
            .expect("category");
        service
            .set_category_appearance(
                &category,
                crate::models::command::CategoryAppearanceInput {
                    color: Some("#f4effb".to_owned()),
                    icon_name: Some("terminal".to_owned()),
                },
            )
            .expect("appearance");
        let command = service
            .create_command(CommandInput {
                title: "旧格式".to_owned(),
                command: "echo legacy".to_owned(),
                description: String::new(),
                shell: "bash".to_owned(),
                category_id: Some(category.clone()),
                tags: Vec::new(),
            })
            .expect("command");
        service
            .set_commands_color(std::slice::from_ref(&command.id), Some("#fff0e8"))
            .expect("color");
        let json = service.export_json().expect("export");

        let unknown_icon = json.replace("\"iconName\": \"terminal\"", "\"iconName\": \"coffee\"");
        service
            .import_json(&unknown_icon, ImportMode::Replace)
            .expect("unknown icon should not fail import");
        let tree = service.list_categories().expect("tree");
        assert!(tree[0].icon_name.is_none(), "unknown icon falls back");
        assert_eq!(tree[0].color.as_deref(), Some("#F4EFFB"));

        let invalid_color = json.replace("\"color\": \"#F4EFFB\"", "\"color\": \"red\"");
        service
            .import_json(&invalid_color, ImportMode::Replace)
            .expect("invalid color should be dropped, not fail import");
        let tree = service.list_categories().expect("tree");
        assert!(tree[0].color.is_none(), "invalid color falls back to null");
        assert_eq!(tree[0].icon_name.as_deref(), Some("terminal"));

        let mut legacy: serde_json::Value = serde_json::from_str(&json).expect("json value");
        if let Some(object) = legacy.as_object_mut() {
            object.insert("schemaVersion".to_owned(), serde_json::Value::from(2));
        }
        if let Some(categories) = legacy
            .get_mut("categories")
            .and_then(serde_json::Value::as_array_mut)
        {
            for category in categories {
                if let Some(object) = category.as_object_mut() {
                    object.remove("color");
                    object.remove("iconName");
                }
            }
        }
        if let Some(commands) = legacy
            .get_mut("commands")
            .and_then(serde_json::Value::as_array_mut)
        {
            for command in commands {
                if let Some(object) = command.as_object_mut() {
                    object.remove("backgroundColor");
                    object.remove("useCategoryColor");
                }
            }
        }
        let legacy_json = serde_json::to_string(&legacy).expect("legacy json");
        service
            .import_json(&legacy_json, ImportMode::Replace)
            .expect("legacy schema 2 import");
        let commands = service
            .list_commands(&CommandQuery::default())
            .expect("legacy commands");
        assert!(commands[0].background_color.is_none());
        assert!(!commands[0].use_category_color);
        let tree = service.list_categories().expect("legacy categories");
        assert!(tree[0].color.is_none());
        assert!(tree[0].icon_name.is_none());
    }

    #[test]
    fn replace_import_preserves_nested_categories_tags_and_usage() {
        let (_temp, database, clipboard) = setup();
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
        let command = service
            .create_command(CommandInput {
                title: "嵌套导入".to_owned(),
                command: "echo nested".to_owned(),
                description: "验证目录与标签".to_owned(),
                shell: "bash".to_owned(),
                category_id: Some(child.clone()),
                tags: vec!["one".to_owned(), "two".to_owned()],
            })
            .expect("command");
        service
            .copy_commands(std::slice::from_ref(&command.id))
            .expect("copy");
        let json = service.export_json().expect("export");
        service
            .import_json(&json, ImportMode::Replace)
            .expect("replace");
        let commands = service
            .list_commands(&CommandQuery::default())
            .expect("list");
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].category_id.as_deref(), Some(child.as_str()));
        assert_eq!(commands[0].use_count, 1);
        assert_eq!(commands[0].tags.len(), 2);
        let tree = service.list_categories().expect("categories");
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].id, parent);
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].id, child);
        let _ = service.list_tags().expect("tags");
    }

    #[test]
    fn invalid_import_does_not_change_existing_data() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let (_, mut json) = seed(&service);
        json = json.replace(
            &format!("\"schemaVersion\": {COMMAND_EXPORT_SCHEMA_VERSION}"),
            "\"schemaVersion\": 99",
        );
        let before = service
            .list_commands(&CommandQuery::default())
            .expect("before");
        assert!(service.import_json(&json, ImportMode::Replace).is_err());
        let after = service
            .list_commands(&CommandQuery::default())
            .expect("after");
        assert_eq!(before.len(), after.len());
    }

    #[test]
    fn backup_restore_round_trip_preserves_commands() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let (command_id, _) = seed(&service);
        service
            .set_commands_color(std::slice::from_ref(&command_id), Some("#edf8f2"))
            .expect("command appearance");
        let category_id = service.list_categories().expect("categories")[0].id.clone();
        service
            .set_category_appearance(
                &category_id,
                crate::models::command::CategoryAppearanceInput {
                    color: Some("#fceef0".to_owned()),
                    icon_name: Some("database".to_owned()),
                },
            )
            .expect("category appearance");
        let command = service.get_command(&command_id).expect("command");
        AiService::new(&database)
            .save_generated(SaveAiAnnotationInput {
                generated: GeneratedAiAnnotation {
                    command_id: command.id,
                    command_content_hash: command.content_hash,
                    provider: "deepseek".to_owned(),
                    model: "deepseek-chat".to_owned(),
                    prompt_version: AI_PROMPT_VERSION.to_owned(),
                    generated_at: 1,
                    annotation: AiAnnotationDraft {
                        short_description: "备份数据库".to_owned(),
                        detailed_description: "备份说明".to_owned(),
                        ..AiAnnotationDraft::default()
                    },
                },
                manual_mode: ManualAnnotationMode::Keep,
            })
            .expect("annotation");
        let backup = service.create_backup("manual").expect("backup");
        service.delete_command(&command_id).expect("delete");
        assert_eq!(
            service
                .list_commands(&CommandQuery::default())
                .expect("list")
                .len(),
            1
        );
        let report = service.restore_backup(&backup.file_name).expect("restore");
        assert_eq!(report.commands, 2);
        assert!(Path::new(&report.pre_restore_backup).exists());
        let restored = service.get_command(&command_id).expect("restored");
        assert_eq!(restored.title, "备份数据库");
        assert_eq!(restored.tags.len(), 2);
        assert_eq!(restored.background_color.as_deref(), Some("#EDF8F2"));
        assert_eq!(restored.ai_annotation_status, "ready");
        assert_eq!(
            restored
                .ai_annotation
                .as_ref()
                .map(|annotation| annotation.short_description.as_str()),
            Some("备份数据库")
        );
        let tree = service.list_categories().expect("restored categories");
        assert_eq!(tree[0].color.as_deref(), Some("#FCEEF0"));
        assert_eq!(tree[0].icon_name.as_deref(), Some("database"));
    }

    #[test]
    fn backup_restore_rejects_path_traversal_and_invalid_files() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        assert!(service.restore_backup("../settings.json").is_err());
        assert!(service.restore_backup("missing.db").is_err());
    }

    #[test]
    fn backup_list_contains_created_files() {
        let (_temp, database, clipboard) = setup();
        let service = LibraryService::with_clipboard(&database, &clipboard);
        let backup = service.create_backup("manual").expect("backup");
        let list = service.list_backups().expect("list");
        assert!(list.iter().any(|item| item.file_name == backup.file_name));
    }

    #[test]
    fn json_export_contains_prompts_and_replace_import_keeps_text_exact() {
        let (_temp, database, clipboard) = setup();
        let library = LibraryService::with_clipboard(&database, &clipboard);
        let prompts = PromptService::with_clipboard(&database, &clipboard);
        let category = prompts
            .create_category(CategoryInput {
                name: "科研工作".to_owned(),
                parent_id: None,
            })
            .expect("prompt category");
        let content = "请分析这篇论文：\n\n```text\n摘要：……\n```\n\n- 方法\n- 结果  ";
        let prompt = prompts
            .create_prompt(PromptInput {
                title: "论文分析".to_owned(),
                content: content.to_owned(),
                category_id: Some(category),
                tags: vec!["论文".to_owned()],
                background_color: Some("#EDF8F2".to_owned()),
                favorite: true,
            })
            .expect("prompt");
        seed(&library);

        let json = library.export_json().expect("export");
        assert!(json.contains("\"schemaVersion\": 4"));
        assert!(json.contains("\"prompts\""));
        assert!(json.contains("\"promptCategories\""));
        assert!(json.contains("请分析这篇论文"));

        library
            .import_json(&json, ImportMode::Replace)
            .expect("replace");
        let restored = prompts.get_prompt(&prompt.id).expect("restored prompt");
        assert_eq!(restored.content, content);
        assert!(restored.is_favorite);
        assert_eq!(restored.background_color.as_deref(), Some("#EDF8F2"));
        assert_eq!(restored.tags.len(), 1);
        let tree = prompts.list_categories().expect("prompt categories");
        assert_eq!(tree[0].name, "科研工作");
        assert_eq!(
            library
                .list_commands(&CommandQuery::default())
                .expect("commands")
                .len(),
            2
        );

        let merge = library
            .import_json(&json, ImportMode::Merge)
            .expect("merge");
        assert_eq!(merge.prompts_added, 0);
        assert_eq!(merge.prompts_skipped, 1);
        assert_eq!(merge.commands_skipped, 2);
    }

    #[test]
    fn legacy_command_only_import_does_not_delete_prompt_library() {
        let (_temp, database, clipboard) = setup();
        let library = LibraryService::with_clipboard(&database, &clipboard);
        let prompts = PromptService::with_clipboard(&database, &clipboard);
        let prompt = prompts
            .save_clipboard_text("保留的提示词\n第二行", false)
            .expect("prompt");
        seed(&library);
        let json = library.export_json().expect("export");
        let mut legacy: serde_json::Value = serde_json::from_str(&json).expect("json");
        if let Some(object) = legacy.as_object_mut() {
            object.insert("schemaVersion".to_owned(), serde_json::Value::from(3));
            object.remove("prompts");
            object.remove("promptCategories");
        }
        let legacy_json = serde_json::to_string(&legacy).expect("legacy json");

        let report = library
            .import_json(&legacy_json, ImportMode::Replace)
            .expect("legacy replace");
        assert_eq!(report.prompts_added, 0);
        let kept = prompts
            .get_prompt(&prompt.prompt.id)
            .expect("prompt preserved");
        assert_eq!(kept.content, "保留的提示词\n第二行");
        assert_eq!(
            library
                .list_commands(&CommandQuery::default())
                .expect("commands")
                .len(),
            2
        );
    }

    #[test]
    fn backup_restore_includes_prompts_categories_and_tags() {
        let (_temp, database, clipboard) = setup();
        let library = LibraryService::with_clipboard(&database, &clipboard);
        let prompts = PromptService::with_clipboard(&database, &clipboard);
        let category = prompts
            .create_category(CategoryInput {
                name: "内容创作".to_owned(),
                parent_id: None,
            })
            .expect("category");
        let content = "写一段产品文案：\n\n- 简洁\n- 有行动号召";
        let prompt = prompts
            .create_prompt(PromptInput {
                title: "文案生成".to_owned(),
                content: content.to_owned(),
                category_id: Some(category),
                tags: vec!["文案".to_owned()],
                background_color: None,
                favorite: true,
            })
            .expect("prompt");
        let backup = library.create_backup("manual").expect("backup");
        prompts.delete_prompt(&prompt.id).expect("delete");
        assert!(prompts
            .list_prompts(&PromptQuery::default())
            .expect("list")
            .is_empty());

        let report = library.restore_backup(&backup.file_name).expect("restore");
        assert_eq!(report.prompts, 1);
        assert_eq!(report.prompt_categories, 1);
        let restored = prompts.get_prompt(&prompt.id).expect("restored");
        assert_eq!(restored.content, content);
        assert_eq!(restored.tags.len(), 1);
        let tree = prompts.list_categories().expect("categories");
        assert_eq!(tree[0].name, "内容创作");
        assert_eq!(tree[0].prompt_count, 1);
    }
}
