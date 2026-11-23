use std::collections::{HashMap, HashSet};

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};

use crate::models::{
    ai::{AiAnnotation, AiAnnotationParameter},
    command::{
        CategoryChildAction, CategoryCommandAction, CategoryDeleteOptions, CategoryDeleteReport,
        CategoryNode, Command, CommandFilter, CommandInput, CommandPlacement, CommandQuery,
        CommandSort, MoveCommandsResult, Tag, TagSummary, COMMAND_EXPORT_SCHEMA_VERSION,
        SUPPORTED_SHELLS,
    },
};

use super::LibraryError;

const COMMAND_SELECT: &str = r#"
SELECT
    c.id, c.title, c.command, c.description, c.shell,
    c.category_id, cat.name AS category_name,
    cat.color AS category_color, cat.icon_name AS category_icon_name,
    c.background_color, c.use_category_color,
    c.source_type, c.ai_annotation_status,
    c.is_favorite, c.sort_order, c.use_count, c.last_used_at,
    c.created_at, c.updated_at, c.content_hash
FROM commands c
LEFT JOIN categories cat ON cat.id = c.category_id
"#;

pub struct CommandRepository<'a> {
    connection: &'a Connection,
}

impl<'a> CommandRepository<'a> {
    pub fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub fn list_commands(&self, query: &CommandQuery) -> Result<Vec<Command>, LibraryError> {
        let limit = query.limit.unwrap_or(200).clamp(1, 500);
        let mut clauses = vec!["c.deleted_at IS NULL".to_owned()];
        let mut params = Vec::<Value>::new();

        match query.filter {
            CommandFilter::All => {}
            CommandFilter::Recent => clauses.push("c.last_used_at IS NOT NULL".to_owned()),
            CommandFilter::Favorites => clauses.push("c.is_favorite = 1".to_owned()),
        }

        if let Some(category_id) = query
            .category_id
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            clauses.push("c.category_id = ?".to_owned());
            params.push(Value::Text(category_id.to_owned()));
        }
        if query.unclassified_only {
            clauses.push("c.category_id IS NULL".to_owned());
        }
        if let Some(tag_id) = query.tag_id.as_deref().filter(|value| !value.is_empty()) {
            clauses.push(
                "EXISTS (SELECT 1 FROM command_tags ct_filter WHERE ct_filter.command_id = c.id AND ct_filter.tag_id = ?)"
                    .to_owned(),
            );
            params.push(Value::Text(tag_id.to_owned()));
        }

        let search = query.search.trim();
        if !search.is_empty() {
            let like = format!("%{}%", escape_like(search));
            let mut search_clauses = vec![
                "c.title LIKE ? ESCAPE '\\'".to_owned(),
                "c.command LIKE ? ESCAPE '\\'".to_owned(),
                "c.description LIKE ? ESCAPE '\\'".to_owned(),
                "EXISTS (SELECT 1 FROM command_tags ct_search JOIN tags t_search ON t_search.id = ct_search.tag_id WHERE ct_search.command_id = c.id AND t_search.name LIKE ? ESCAPE '\\')".to_owned(),
            ];
            for _ in 0..4 {
                params.push(Value::Text(like.clone()));
            }
            if let Some(fts_query) = build_fts_query(search) {
                search_clauses.push(
                    "c.id IN (SELECT command_id FROM commands_fts WHERE commands_fts MATCH ?)"
                        .to_owned(),
                );
                params.push(Value::Text(fts_query));
            }
            clauses.push(format!("({})", search_clauses.join(" OR ")));
        }

        let order = match query.sort {
            CommandSort::Manual => {
                "c.sort_order ASC, c.updated_at DESC, c.title COLLATE NOCASE ASC, c.id ASC"
            }
            CommandSort::Recent => {
                "c.last_used_at IS NULL ASC, c.last_used_at DESC, c.updated_at DESC, c.id ASC"
            }
            CommandSort::Updated => "c.updated_at DESC, c.title COLLATE NOCASE ASC, c.id ASC",
            CommandSort::Title => "c.title COLLATE NOCASE ASC, c.sort_order ASC, c.id ASC",
            CommandSort::MostUsed => {
                "c.use_count DESC, c.last_used_at IS NULL ASC, c.last_used_at DESC, c.id ASC"
            }
        };
        params.push(Value::Integer(limit as i64));

        let sql = format!(
            "{COMMAND_SELECT} WHERE {} ORDER BY {order} LIMIT ?",
            clauses.join(" AND ")
        );
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(params.iter()), map_command_row)?;
        let mut commands = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        self.attach_tags(&mut commands)?;
        self.attach_annotations(&mut commands)?;
        Ok(commands)
    }

    pub fn library_summary(&self) -> Result<crate::models::command::LibrarySummary, LibraryError> {
        let command_count: i64 = self.connection.query_row(
            "SELECT count(*) FROM commands WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        let favorite_count: i64 = self.connection.query_row(
            "SELECT count(*) FROM commands WHERE deleted_at IS NULL AND is_favorite = 1",
            [],
            |row| row.get(0),
        )?;
        let category_count: i64 =
            self.connection
                .query_row("SELECT count(*) FROM categories", [], |row| row.get(0))?;
        let tag_count: i64 = self
            .connection
            .query_row("SELECT count(*) FROM tags", [], |row| row.get(0))?;
        let recent_commands = self.list_commands(&CommandQuery {
            filter: CommandFilter::Recent,
            sort: CommandSort::Recent,
            limit: Some(3),
            ..CommandQuery::default()
        })?;
        Ok(crate::models::command::LibrarySummary {
            command_count,
            favorite_count,
            category_count,
            tag_count,
            recent_commands,
        })
    }

    pub fn get_command(&self, id: &str) -> Result<Option<Command>, LibraryError> {
        let sql = format!("{COMMAND_SELECT} WHERE c.id = ?1 AND c.deleted_at IS NULL");
        let mut command = self
            .connection
            .query_row(&sql, [id], map_command_row)
            .optional()?;
        if let Some(command) = command.as_mut() {
            let tags = self.tags_for_ids(std::slice::from_ref(&command.id))?;
            command.tags = tags.get(&command.id).cloned().unwrap_or_default();
            let annotations = self.annotations_for_ids(std::slice::from_ref(&command.id))?;
            command.ai_annotation = annotations.get(&command.id).cloned();
        }
        Ok(command)
    }

    pub fn create_command(
        &self,
        id: &str,
        input: &CommandInput,
        source_type: &str,
        now: i64,
    ) -> Result<Command, LibraryError> {
        validate_input(input)?;
        let transaction = self.connection.unchecked_transaction()?;
        ensure_category_exists(&transaction, input.category_id.as_deref())?;
        let next_sort: i64 = transaction.query_row(
            "SELECT coalesce(max(sort_order), 0) + 10 FROM commands WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        let command_hash = crate::services::clipboard::content_hash(&input.command);
        transaction.execute(
            "INSERT INTO commands (
                id, title, command, description, shell, category_id,
                source_type, content_hash, ai_annotation_status,
                is_favorite, sort_order, use_count, last_used_at,
                created_at, updated_at, deleted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'none', 0, ?9, 0, NULL, ?10, ?10, NULL)",
            params![
                id,
                input.title.trim(),
                input.command,
                input.description.trim(),
                input.shell.trim(),
                input.category_id,
                source_type,
                command_hash,
                next_sort,
                now
            ],
        )?;
        self.replace_tags(&transaction, id, &input.tags, now)?;
        transaction.commit()?;
        self.get_command(id)?
            .ok_or_else(|| LibraryError::Internal("命令写入后无法读取".to_owned()))
    }

    pub fn find_active_by_content(&self, content: &str) -> Result<Option<Command>, LibraryError> {
        let id: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM commands
                 WHERE deleted_at IS NULL AND command = ?1
                 ORDER BY updated_at DESC LIMIT 1",
                [content],
                |row| row.get(0),
            )
            .optional()?;
        match id {
            Some(id) => self.get_command(&id),
            None => Ok(None),
        }
    }

    pub fn update_command(
        &self,
        id: &str,
        input: &CommandInput,
        now: i64,
    ) -> Result<Command, LibraryError> {
        validate_input(input)?;
        let transaction = self.connection.unchecked_transaction()?;
        ensure_category_exists(&transaction, input.category_id.as_deref())?;
        let command_hash = crate::services::clipboard::content_hash(&input.command);
        let changed = transaction.execute(
            "UPDATE commands
             SET title = ?2, command = ?3, description = ?4, shell = ?5,
                 category_id = ?6, content_hash = ?7, updated_at = ?8
             WHERE id = ?1 AND deleted_at IS NULL",
            params![
                id,
                input.title.trim(),
                input.command,
                input.description.trim(),
                input.shell.trim(),
                input.category_id,
                command_hash,
                now
            ],
        )?;
        if changed == 0 {
            return Err(LibraryError::NotFound);
        }
        self.replace_tags(&transaction, id, &input.tags, now)?;
        transaction.commit()?;
        self.get_command(id)?
            .ok_or_else(|| LibraryError::Internal("命令更新后无法读取".to_owned()))
    }

    /// Soft delete keeps the original row available for future trash/undo and
    /// prevents accidental irreversible data loss from the UI.
    pub fn delete_command(&self, id: &str, now: i64) -> Result<(), LibraryError> {
        let changed = self.connection.execute(
            "UPDATE commands SET deleted_at = ?2, updated_at = ?2
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        if changed == 0 {
            return Err(LibraryError::NotFound);
        }
        Ok(())
    }

    pub fn toggle_favorite(&self, id: &str, now: i64) -> Result<Command, LibraryError> {
        let changed = self.connection.execute(
            "UPDATE commands
             SET is_favorite = CASE is_favorite WHEN 1 THEN 0 ELSE 1 END,
                 updated_at = ?2
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        if changed == 0 {
            return Err(LibraryError::NotFound);
        }
        self.get_command(id)?.ok_or_else(|| LibraryError::NotFound)
    }

    pub fn record_usage(&self, ids: &[String], now: i64) -> Result<usize, LibraryError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let transaction = self.connection.unchecked_transaction()?;
        let mut changed = 0;
        {
            let mut statement = transaction.prepare(
                "UPDATE commands
                 SET use_count = use_count + 1, last_used_at = ?2, updated_at = ?2
                 WHERE id = ?1 AND deleted_at IS NULL",
            )?;
            for id in ids {
                changed += statement.execute(params![id, now])?;
            }
        }
        transaction.commit()?;
        Ok(changed)
    }

    pub fn reorder_commands(&self, ids: &[String], _now: i64) -> Result<(), LibraryError> {
        if ids.is_empty() {
            return Err(LibraryError::Validation("没有需要排序的命令。".to_owned()));
        }
        let mut unique = HashSet::new();
        if !ids.iter().all(|id| unique.insert(id.as_str())) {
            return Err(LibraryError::Validation(
                "命令排序列表包含重复 ID。".to_owned(),
            ));
        }

        let transaction = self.connection.unchecked_transaction()?;
        let current = {
            let mut statement = transaction.prepare(
                "SELECT id, sort_order FROM commands
                 WHERE deleted_at IS NULL
                 ORDER BY sort_order ASC, updated_at DESC, title COLLATE NOCASE ASC, id ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let positions = current
            .iter()
            .enumerate()
            .filter(|(_, (id, _))| unique.contains(id.as_str()))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if positions.len() != ids.len() {
            return Err(LibraryError::NotFound);
        }

        let mut final_ids = current.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
        for (position, id) in positions.into_iter().zip(ids.iter()) {
            final_ids[position] = id.clone();
        }

        {
            let mut statement =
                transaction.prepare("UPDATE commands SET sort_order = ?2 WHERE id = ?1")?;
            for (index, id) in final_ids.iter().enumerate() {
                statement.execute(params![id, ((index as i64) + 1) * 10])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn move_commands_to_category(
        &self,
        ids: &[String],
        category_id: Option<&str>,
        now: i64,
    ) -> Result<MoveCommandsResult, LibraryError> {
        if ids.is_empty() {
            return Err(LibraryError::Validation("没有需要移动的命令。".to_owned()));
        }
        let transaction = self.connection.unchecked_transaction()?;
        ensure_category_exists(&transaction, category_id)?;
        let previous = commands_for_movement(&transaction, ids)?;
        let next_sort: i64 = transaction.query_row(
            "SELECT coalesce(max(sort_order), 0) + 10 FROM commands
             WHERE deleted_at IS NULL AND category_id IS ?1",
            [category_id],
            |row| row.get(0),
        )?;
        let mut moved = 0usize;
        let mut update = transaction.prepare(
            "UPDATE commands
             SET category_id = ?2, sort_order = ?3, updated_at = ?4
             WHERE id = ?1 AND deleted_at IS NULL",
        )?;
        let mut next = next_sort;
        for placement in &previous {
            if placement.category_id.as_deref() == category_id {
                continue;
            }
            update.execute(params![placement.id, category_id, next, now])?;
            next += 10;
            moved += 1;
        }
        drop(update);
        transaction.commit()?;
        Ok(MoveCommandsResult { moved, previous })
    }

    pub fn restore_command_placements(
        &self,
        placements: &[CommandPlacement],
        now: i64,
    ) -> Result<usize, LibraryError> {
        if placements.is_empty() {
            return Ok(0);
        }
        let transaction = self.connection.unchecked_transaction()?;
        let mut changed = 0usize;
        let mut update = transaction.prepare(
            "UPDATE commands
             SET category_id = ?2, sort_order = ?3, updated_at = ?4
             WHERE id = ?1 AND deleted_at IS NULL",
        )?;
        for placement in placements {
            let category_exists: bool = match placement.category_id.as_deref() {
                Some(category_id) => {
                    transaction.query_row(
                        "SELECT count(*) FROM categories WHERE id = ?1",
                        [category_id],
                        |row| row.get::<_, i64>(0),
                    )? > 0
                }
                None => true,
            };
            let category_id = if category_exists {
                placement.category_id.as_deref()
            } else {
                None
            };
            changed += update.execute(params![
                placement.id,
                category_id,
                placement.sort_order,
                now
            ])?;
        }
        drop(update);
        transaction.commit()?;
        Ok(changed)
    }

    pub fn reorder_categories(
        &self,
        parent_id: Option<&str>,
        ids: &[String],
        _now: i64,
    ) -> Result<(), LibraryError> {
        if ids.is_empty() {
            return Err(LibraryError::Validation("没有需要排序的目录。".to_owned()));
        }
        ensure_category_exists(self.connection, parent_id)?;
        let mut unique = HashSet::new();
        if !ids.iter().all(|id| unique.insert(id.as_str())) {
            return Err(LibraryError::Validation(
                "目录排序列表包含重复 ID。".to_owned(),
            ));
        }
        let siblings = {
            let mut statement = self.connection.prepare(
                "SELECT id FROM categories
                 WHERE parent_id IS ?1
                 ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC",
            )?;
            let rows = statement
                .query_map([parent_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let positions = siblings
            .iter()
            .enumerate()
            .filter(|(_, id)| unique.contains(id.as_str()))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if positions.len() != ids.len() {
            return Err(LibraryError::NotFound);
        }
        let mut final_ids = siblings;
        for (position, id) in positions.into_iter().zip(ids.iter()) {
            final_ids[position] = id.clone();
        }
        let transaction = self.connection.unchecked_transaction()?;
        {
            let mut statement =
                transaction.prepare("UPDATE categories SET sort_order = ?2 WHERE id = ?1")?;
            for (index, id) in final_ids.iter().enumerate() {
                statement.execute(params![id, ((index as i64) + 1) * 10])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_categories(&self) -> Result<Vec<CategoryNode>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, parent_id, sort_order, color, icon_name FROM categories
             ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?;
        let mut categories = rows.collect::<rusqlite::Result<Vec<_>>>()?;

        let mut count_statement = self.connection.prepare(
            "SELECT category_id, count(*) FROM commands
             WHERE deleted_at IS NULL AND category_id IS NOT NULL
             GROUP BY category_id",
        )?;
        let counts = count_statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;

        let ids: HashSet<String> = categories
            .iter()
            .map(|(id, _, _, _, _, _)| id.clone())
            .collect();
        let mut children: HashMap<Option<String>, Vec<CategoryNode>> = HashMap::new();
        for (id, name, parent_id, sort_order, color, icon_name) in categories.drain(..) {
            let parent_id = parent_id.filter(|parent| ids.contains(parent) && *parent != id);
            children
                .entry(parent_id.clone())
                .or_default()
                .push(CategoryNode {
                    command_count: counts.get(&id).copied().unwrap_or(0),
                    id,
                    name,
                    parent_id,
                    sort_order,
                    color,
                    icon_name,
                    children: Vec::new(),
                });
        }
        Ok(build_category_tree(None, &mut children, 0))
    }

    pub fn create_category(
        &self,
        id: &str,
        name: &str,
        parent_id: Option<&str>,
        now: i64,
    ) -> Result<String, LibraryError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(LibraryError::Validation(
                "目录名称需为 1–80 个字符。".to_owned(),
            ));
        }
        ensure_category_exists(self.connection, parent_id)?;
        let duplicate: i64 = self.connection.query_row(
            "SELECT count(*) FROM categories WHERE name = ?1 COLLATE NOCASE AND parent_id IS ?2",
            params![name, parent_id],
            |row| row.get(0),
        )?;
        if duplicate > 0 {
            return Err(LibraryError::Conflict(
                "同一父目录下已存在同名目录。".to_owned(),
            ));
        }
        let next_sort: i64 = self.connection.query_row(
            "SELECT coalesce(max(sort_order), 0) + 10 FROM categories WHERE parent_id IS ?1",
            [parent_id],
            |row| row.get(0),
        )?;
        self.connection.execute(
            "INSERT INTO categories (id, name, parent_id, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, name, parent_id, next_sort, now],
        )?;
        Ok(id.to_owned())
    }

    pub fn update_category(
        &self,
        id: &str,
        name: Option<&str>,
        parent_id: Option<Option<&str>>,
        now: i64,
    ) -> Result<(), LibraryError> {
        let current = self
            .connection
            .query_row(
                "SELECT name, parent_id FROM categories WHERE id = ?1",
                [id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .ok_or(LibraryError::NotFound)?;
        let next_name = name.map(str::trim).filter(|value| !value.is_empty());
        if next_name.is_some_and(|value| value.chars().count() > 80) {
            return Err(LibraryError::Validation(
                "目录名称需为 1–80 个字符。".to_owned(),
            ));
        }
        let next_parent = parent_id.map(|value| value.map(str::to_owned));
        if let Some(Some(parent)) = &next_parent {
            if parent == id {
                return Err(LibraryError::Validation("目录不能移动到自身。".to_owned()));
            }
            ensure_category_exists(self.connection, Some(parent))?;
            if self.is_category_descendant(parent, id)? {
                return Err(LibraryError::Validation(
                    "目录不能移动到自己的子目录中。".to_owned(),
                ));
            }
        }
        let final_name = next_name.unwrap_or(&current.0);
        let final_parent = next_parent.as_ref().unwrap_or(&current.1);
        let duplicate: i64 = self.connection.query_row(
            "SELECT count(*) FROM categories
             WHERE id <> ?1 AND name = ?2 COLLATE NOCASE AND parent_id IS ?3",
            params![id, final_name, final_parent],
            |row| row.get(0),
        )?;
        if duplicate > 0 {
            return Err(LibraryError::Conflict(
                "同一父目录下已存在同名目录。".to_owned(),
            ));
        }
        self.connection.execute(
            "UPDATE categories SET name = ?2, parent_id = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, final_name, final_parent, now],
        )?;
        Ok(())
    }

    /// Persist the icon and icon color of a category. Nested categories store
    /// their own appearance independently; nothing is inherited.
    pub fn set_category_appearance(
        &self,
        id: &str,
        color: Option<&str>,
        icon_name: Option<&str>,
        now: i64,
    ) -> Result<(), LibraryError> {
        let changed = self.connection.execute(
            "UPDATE categories SET color = ?2, icon_name = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, color, icon_name, now],
        )?;
        if changed == 0 {
            return Err(LibraryError::NotFound);
        }
        Ok(())
    }

    /// Set or clear a command background color in one transaction. IDs are
    /// validated as a complete, duplicate-free set before anything is written.
    pub fn set_commands_color(
        &self,
        ids: &[String],
        color: Option<&str>,
    ) -> Result<usize, LibraryError> {
        validate_command_ids(ids)?;
        let transaction = self.connection.unchecked_transaction()?;
        ensure_commands_exist(&transaction, ids)?;
        let placeholders = repeat_placeholders(ids.len());
        let sql = format!(
            "UPDATE commands SET background_color = ?1, use_category_color = 0
             WHERE deleted_at IS NULL AND id IN ({placeholders})"
        );
        let mut params = Vec::<Value>::with_capacity(ids.len() + 1);
        params.push(match color {
            Some(value) => Value::Text(value.to_owned()),
            None => Value::Null,
        });
        params.extend(ids.iter().map(|id| Value::Text(id.clone())));
        let changed = transaction.execute(&sql, params_from_iter(params.iter()))?;
        transaction.commit()?;
        Ok(changed)
    }

    /// Toggle the special "follow the category color" mode. The command keeps
    /// its own stored color so disabling the mode restores the previous tint.
    pub fn set_commands_follow_category_color(
        &self,
        ids: &[String],
        enabled: bool,
    ) -> Result<usize, LibraryError> {
        validate_command_ids(ids)?;
        let transaction = self.connection.unchecked_transaction()?;
        ensure_commands_exist(&transaction, ids)?;
        let placeholders = repeat_placeholders(ids.len());
        let sql = format!(
            "UPDATE commands SET use_category_color = ?1
             WHERE deleted_at IS NULL AND id IN ({placeholders})"
        );
        let mut params = Vec::<Value>::with_capacity(ids.len() + 1);
        params.push(Value::Integer(if enabled { 1 } else { 0 }));
        params.extend(ids.iter().map(|id| Value::Text(id.clone())));
        let changed = transaction.execute(&sql, params_from_iter(params.iter()))?;
        transaction.commit()?;
        Ok(changed)
    }

    pub fn delete_category(&self, id: &str) -> Result<(), LibraryError> {
        let child_count: i64 = self.connection.query_row(
            "SELECT count(*) FROM categories WHERE parent_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if child_count > 0 {
            return Err(LibraryError::Conflict(
                "该目录下还有子目录，请先移动或删除子目录。".to_owned(),
            ));
        }
        let command_count: i64 = self.connection.query_row(
            "SELECT count(*) FROM commands WHERE category_id = ?1 AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )?;
        if command_count > 0 {
            return Err(LibraryError::Conflict(
                "该目录下还有命令，请先移动命令或使用“默认”。".to_owned(),
            ));
        }
        let changed = self
            .connection
            .execute("DELETE FROM categories WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(LibraryError::NotFound);
        }
        Ok(())
    }

    pub fn delete_category_with_options(
        &self,
        id: &str,
        options: &CategoryDeleteOptions,
        now: i64,
    ) -> Result<CategoryDeleteReport, LibraryError> {
        let transaction = self.connection.unchecked_transaction()?;
        let parent_id: Option<String> = transaction
            .query_row(
                "SELECT parent_id FROM categories WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(LibraryError::NotFound)?;
        let command_target = match options.command_action {
            CategoryCommandAction::MoveToParent => parent_id.clone(),
            CategoryCommandAction::Unclassified => None,
        };
        ensure_category_exists(&transaction, command_target.as_deref())?;

        let category_ids = if options.child_action == CategoryChildAction::DeleteSubtree {
            let mut statement = transaction.prepare(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM categories WHERE id = ?1
                    UNION ALL
                    SELECT c.id FROM categories c
                    JOIN descendants d ON c.parent_id = d.id
                 )
                 SELECT id FROM descendants",
            )?;
            let rows = statement
                .query_map([id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            vec![id.to_owned()]
        };

        let command_ids = {
            let placeholders = std::iter::repeat_n("?", category_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT id FROM commands
                 WHERE deleted_at IS NULL AND category_id IN ({placeholders})
                 ORDER BY sort_order ASC, updated_at DESC, title COLLATE NOCASE ASC"
            );
            let mut statement = transaction.prepare(&sql)?;
            let rows = statement
                .query_map(params_from_iter(category_ids.iter()), |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        let mut next_sort: i64 = transaction.query_row(
            "SELECT coalesce(max(sort_order), 0) + 10 FROM commands
             WHERE deleted_at IS NULL AND category_id IS ?1",
            [command_target.as_deref()],
            |row| row.get(0),
        )?;
        {
            let mut update = transaction.prepare(
                "UPDATE commands
                 SET category_id = ?2, sort_order = ?3, updated_at = ?4
                 WHERE id = ?1 AND deleted_at IS NULL",
            )?;
            for command_id in &command_ids {
                update.execute(params![command_id, command_target, next_sort, now])?;
                next_sort += 10;
            }
        }

        if options.child_action == CategoryChildAction::Promote {
            let children = {
                let mut statement = transaction.prepare(
                    "SELECT id, name FROM categories
                     WHERE parent_id = ?1
                     ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
                )?;
                let rows = statement
                    .query_map([id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                rows
            };
            let mut child_sort: i64 = transaction.query_row(
                "SELECT coalesce(max(sort_order), 0) + 10 FROM categories
                 WHERE parent_id IS ?1 AND id <> ?2",
                params![parent_id, id],
                |row| row.get(0),
            )?;
            for (child_id, child_name) in children {
                let duplicate: i64 = transaction.query_row(
                    "SELECT count(*) FROM categories
                     WHERE parent_id IS ?1 AND id <> ?2 AND name = ?3 COLLATE NOCASE",
                    params![parent_id, id, child_name],
                    |row| row.get(0),
                )?;
                if duplicate > 0 {
                    return Err(LibraryError::Conflict(format!(
                        "无法提升子目录「{child_name}」：目标层级已有同名目录。"
                    )));
                }
                transaction.execute(
                    "UPDATE categories SET parent_id = ?2, sort_order = ?3 WHERE id = ?1",
                    params![child_id, parent_id, child_sort],
                )?;
                child_sort += 10;
            }
        }

        let deleted = transaction.execute("DELETE FROM categories WHERE id = ?1", [id])?;
        if deleted == 0 {
            return Err(LibraryError::NotFound);
        }
        transaction.commit()?;
        Ok(CategoryDeleteReport {
            moved_commands: command_ids.len(),
            deleted_categories: category_ids.len(),
            target_category_id: command_target,
        })
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, count(c.id)
             FROM tags t
             LEFT JOIN command_tags ct ON ct.tag_id = t.id
             LEFT JOIN commands c ON c.id = ct.command_id AND c.deleted_at IS NULL
             GROUP BY t.id
             ORDER BY t.name COLLATE NOCASE ASC",
        )?;
        let tags = statement
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                    command_count: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(tags)
    }

    fn replace_tags(
        &self,
        connection: &Connection,
        command_id: &str,
        tags: &[String],
        now: i64,
    ) -> Result<(), LibraryError> {
        connection.execute(
            "DELETE FROM command_tags WHERE command_id = ?1",
            [command_id],
        )?;
        let mut seen = HashSet::new();
        for raw in tags {
            let name = raw.trim();
            if name.is_empty() || name.chars().count() > 40 {
                return Err(LibraryError::Validation(
                    "标签名称需为 1–40 个字符。".to_owned(),
                ));
            }
            let dedupe_key = name.to_lowercase();
            if !seen.insert(dedupe_key) {
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
                let id = uuid::Uuid::new_v4().to_string();
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

    fn tags_for_ids(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, Vec<TagSummary>>, LibraryError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders = std::iter::repeat_n("?", ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT ct.command_id, t.id, t.name, t.color
             FROM command_tags ct
             JOIN tags t ON t.id = ct.tag_id
             WHERE ct.command_id IN ({placeholders})
             ORDER BY t.name COLLATE NOCASE ASC"
        );
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                TagSummary {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                },
            ))
        })?;
        let mut result: HashMap<String, Vec<TagSummary>> = HashMap::new();
        for row in rows {
            let (command_id, tag) = row?;
            result.entry(command_id).or_default().push(tag);
        }
        Ok(result)
    }

    fn attach_tags(&self, commands: &mut [Command]) -> Result<(), LibraryError> {
        let ids = commands
            .iter()
            .map(|command| command.id.clone())
            .collect::<Vec<_>>();
        let mut tags = self.tags_for_ids(&ids)?;
        for command in commands {
            command.tags = tags.remove(&command.id).unwrap_or_default();
        }
        Ok(())
    }

    fn annotations_for_ids(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, AiAnnotation>, LibraryError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders = repeat_placeholders(ids.len());
        let sql = format!(
            "SELECT a.id, a.command_id, a.short_description, a.detailed_description,
                    a.parameters_json, a.requirements_json, a.warnings_json,
                    a.suggested_shell, a.risk_level, a.provider, a.model,
                    a.command_content_hash, a.prompt_version, a.generated_at, a.updated_at,
                    c.content_hash
             FROM ai_annotations a
             JOIN commands c ON c.id = a.command_id
             WHERE a.command_id IN ({placeholders})"
        );
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(ids.iter()), |row| {
            let parameters_json: String = row.get(4)?;
            let requirements_json: String = row.get(5)?;
            let warnings_json: String = row.get(6)?;
            let command_content_hash: String = row.get(11)?;
            let current_hash: String = row.get(15)?;
            let is_stale = command_content_hash != current_hash;
            Ok(AiAnnotation {
                id: row.get(0)?,
                command_id: row.get(1)?,
                short_description: row.get(2)?,
                detailed_description: row.get(3)?,
                parameters: serde_json::from_str::<Vec<AiAnnotationParameter>>(&parameters_json)
                    .unwrap_or_default(),
                requirements: serde_json::from_str::<Vec<String>>(&requirements_json)
                    .unwrap_or_default(),
                warnings: serde_json::from_str::<Vec<String>>(&warnings_json).unwrap_or_default(),
                suggested_shell: row.get(7)?,
                risk_level: row.get(8)?,
                provider: row.get(9)?,
                model: row.get(10)?,
                command_content_hash,
                prompt_version: row.get(12)?,
                generated_at: row.get(13)?,
                updated_at: row.get(14)?,
                is_stale,
            })
        })?;
        let mut result = HashMap::new();
        for row in rows {
            let annotation = row?;
            result.insert(annotation.command_id.clone(), annotation);
        }
        Ok(result)
    }

    fn attach_annotations(&self, commands: &mut [Command]) -> Result<(), LibraryError> {
        let ids = commands
            .iter()
            .map(|command| command.id.clone())
            .collect::<Vec<_>>();
        let mut annotations = self.annotations_for_ids(&ids)?;
        for command in commands {
            command.ai_annotation = annotations.remove(&command.id);
        }
        Ok(())
    }

    fn is_category_descendant(
        &self,
        candidate: &str,
        ancestor: &str,
    ) -> Result<bool, LibraryError> {
        let mut current = Some(candidate.to_owned());
        let mut visited = HashSet::new();
        while let Some(id) = current {
            if !visited.insert(id.clone()) {
                return Ok(true);
            }
            let parent: Option<String> = self
                .connection
                .query_row(
                    "SELECT parent_id FROM categories WHERE id = ?1",
                    [&id],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            if parent.as_deref() == Some(ancestor) {
                return Ok(true);
            }
            current = parent;
        }
        Ok(false)
    }

    pub fn export_envelope(&self) -> Result<crate::models::command::ExportEnvelope, LibraryError> {
        let categories = {
            let mut statement = self.connection.prepare(
                "SELECT id, name, parent_id, sort_order, created_at, updated_at, color, icon_name
                 FROM categories ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok(crate::models::command::ExportCategory {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        parent_id: row.get(2)?,
                        sort_order: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        color: row.get(6)?,
                        icon_name: row.get(7)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let tags = {
            let mut statement = self.connection.prepare(
                "SELECT id, name, color, created_at FROM tags ORDER BY name COLLATE NOCASE",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok(crate::models::command::ExportTag {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let mut commands = {
            let mut statement = self.connection.prepare(
                "SELECT c.id, c.title, c.command, c.description, c.shell,
                        c.category_id, c.is_favorite, c.sort_order, c.use_count,
                        c.last_used_at, c.created_at, c.updated_at,
                        c.source_type, c.ai_annotation_status,
                        c.background_color, c.use_category_color
                 FROM commands c WHERE c.deleted_at IS NULL
                 ORDER BY c.sort_order ASC, c.created_at ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok(crate::models::command::ExportCommand {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        command: row.get(2)?,
                        description: row.get(3)?,
                        shell: row.get(4)?,
                        category_id: row.get(5)?,
                        tags: Vec::new(),
                        is_favorite: row.get::<_, i64>(6)? != 0,
                        sort_order: row.get(7)?,
                        use_count: row.get(8)?,
                        last_used_at: row.get(9)?,
                        created_at: row.get(10)?,
                        updated_at: row.get(11)?,
                        source_type: row.get(12)?,
                        ai_annotation_status: row.get(13)?,
                        background_color: row.get(14)?,
                        use_category_color: row.get::<_, i64>(15)? != 0,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for command in &mut commands {
            let tags: Vec<String> = {
                let mut statement = self.connection.prepare(
                    "SELECT t.name FROM command_tags ct JOIN tags t ON t.id = ct.tag_id
                     WHERE ct.command_id = ?1 ORDER BY t.name COLLATE NOCASE",
                )?;
                let values = statement
                    .query_map([&command.id], |row| row.get(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                values
            };
            command.tags = tags;
        }
        let prompt_categories = {
            let mut statement = self.connection.prepare(
                "SELECT id, name, parent_id, sort_order, created_at, updated_at,
                        color, icon_name
                 FROM prompt_categories
                 ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok(crate::models::prompt::ExportPromptCategory {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        parent_id: row.get(2)?,
                        sort_order: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        color: row.get(6)?,
                        icon_name: row.get(7)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let mut prompts = {
            let mut statement = self.connection.prepare(
                "SELECT id, title, content, category_id, is_favorite,
                        background_color, sort_order, use_count, last_used_at,
                        created_at, updated_at
                 FROM prompts WHERE deleted_at IS NULL
                 ORDER BY sort_order ASC, created_at ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok(crate::models::prompt::ExportPrompt {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        content: row.get(2)?,
                        category_id: row.get(3)?,
                        tags: Vec::new(),
                        is_favorite: row.get::<_, i64>(4)? != 0,
                        background_color: row.get(5)?,
                        sort_order: row.get(6)?,
                        use_count: row.get(7)?,
                        last_used_at: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for prompt in &mut prompts {
            let tags: Vec<String> = {
                let mut statement = self.connection.prepare(
                    "SELECT t.name FROM prompt_tags pt JOIN tags t ON t.id = pt.tag_id
                     WHERE pt.prompt_id = ?1 ORDER BY t.name COLLATE NOCASE",
                )?;
                let values = statement
                    .query_map([&prompt.id], |row| row.get(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                values
            };
            prompt.tags = tags;
        }
        Ok(crate::models::command::ExportEnvelope {
            schema_version: COMMAND_EXPORT_SCHEMA_VERSION,
            exported_at: now_millis(),
            application: crate::models::command::ExportApplication {
                name: "Pata Commands".to_owned(),
                version: env!("CARGO_PKG_VERSION").to_owned(),
            },
            categories,
            tags,
            commands,
            prompt_categories: Some(prompt_categories),
            prompts: Some(prompts),
        })
    }
}

fn build_category_tree(
    parent_id: Option<String>,
    children: &mut HashMap<Option<String>, Vec<CategoryNode>>,
    depth: usize,
) -> Vec<CategoryNode> {
    if depth > 64 {
        return Vec::new();
    }
    let mut nodes = children.remove(&parent_id).unwrap_or_default();
    for node in &mut nodes {
        node.children = build_category_tree(Some(node.id.clone()), children, depth + 1);
    }
    nodes
}

fn repeat_placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",")
}

fn validate_command_ids(ids: &[String]) -> Result<(), LibraryError> {
    if ids.is_empty() {
        return Err(LibraryError::Validation(
            "没有选择需要修改外观的命令。".to_owned(),
        ));
    }
    let mut unique = HashSet::new();
    if !ids.iter().all(|id| unique.insert(id.as_str())) {
        return Err(LibraryError::Validation(
            "命令外观列表中包含重复 ID。".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_commands_exist(connection: &Connection, ids: &[String]) -> Result<(), LibraryError> {
    let placeholders = repeat_placeholders(ids.len());
    let sql = format!(
        "SELECT count(*) FROM commands WHERE deleted_at IS NULL AND id IN ({placeholders})"
    );
    let found: i64 = connection.query_row(&sql, params_from_iter(ids.iter()), |row| row.get(0))?;
    if found as usize != ids.len() {
        return Err(LibraryError::NotFound);
    }
    Ok(())
}

fn commands_for_movement(
    connection: &Connection,
    ids: &[String],
) -> Result<Vec<CommandPlacement>, LibraryError> {
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id, category_id, sort_order FROM commands
         WHERE deleted_at IS NULL AND id IN ({placeholders})"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(params_from_iter(ids.iter()), |row| {
            Ok(CommandPlacement {
                id: row.get(0)?,
                category_id: row.get(1)?,
                sort_order: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() != ids.len() {
        return Err(LibraryError::NotFound);
    }
    let mut by_id = rows
        .into_iter()
        .map(|placement| (placement.id.clone(), placement))
        .collect::<HashMap<_, _>>();
    ids.iter()
        .map(|id| {
            by_id
                .remove(id)
                .ok_or_else(|| LibraryError::Internal("命令移动结果不完整。".to_owned()))
        })
        .collect()
}

fn map_command_row(row: &Row<'_>) -> rusqlite::Result<Command> {
    Ok(Command {
        id: row.get(0)?,
        title: row.get(1)?,
        command: row.get(2)?,
        description: row.get(3)?,
        shell: row.get(4)?,
        category_id: row.get(5)?,
        category_name: row.get(6)?,
        category_color: row.get(7)?,
        category_icon_name: row.get(8)?,
        background_color: row.get(9)?,
        use_category_color: row.get::<_, i64>(10)? != 0,
        tags: Vec::new(),
        source_type: row.get(11)?,
        ai_annotation_status: row.get(12)?,
        content_hash: row.get(19)?,
        ai_annotation: None,
        is_favorite: row.get::<_, i64>(13)? != 0,
        sort_order: row.get(14)?,
        use_count: row.get(15)?,
        last_used_at: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

fn ensure_category_exists(
    connection: &Connection,
    category_id: Option<&str>,
) -> Result<(), LibraryError> {
    if let Some(id) = category_id.filter(|value| !value.is_empty()) {
        let exists: i64 = connection.query_row(
            "SELECT count(*) FROM categories WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(LibraryError::Validation("所选目录不存在。".to_owned()));
        }
    }
    Ok(())
}

fn validate_input(input: &CommandInput) -> Result<(), LibraryError> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(LibraryError::Validation(
            "命令标题不能为空且不能超过 200 个字符。".to_owned(),
        ));
    }
    if input.command.trim().is_empty() {
        return Err(LibraryError::Validation("命令原文不能为空。".to_owned()));
    }
    if input.command.chars().count() > 100_000 {
        return Err(LibraryError::Validation("命令原文过长。".to_owned()));
    }
    if input.description.chars().count() > 10_000 {
        return Err(LibraryError::Validation("命令说明过长。".to_owned()));
    }
    if !SUPPORTED_SHELLS.contains(&input.shell.trim()) {
        return Err(LibraryError::Validation("不支持的 Shell 类型。".to_owned()));
    }
    if input.tags.len() > 24 {
        return Err(LibraryError::Validation(
            "单条命令最多 24 个标签。".to_owned(),
        ));
    }
    Ok(())
}

fn build_fts_query(input: &str) -> Option<String> {
    let tokens = input
        .split_whitespace()
        .filter(|token| token.chars().any(|ch| ch.is_alphanumeric()))
        .take(12)
        .map(|token| {
            let escaped = token.replace('"', "\"\"");
            format!("\"{}\"*", escaped.chars().take(64).collect::<String>())
        })
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" AND "))
    }
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
