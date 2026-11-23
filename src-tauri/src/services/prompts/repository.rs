use std::collections::{HashMap, HashSet};

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};

use crate::models::{
    command::{CategoryChildAction, CategoryCommandAction, CategoryDeleteOptions, Tag, TagSummary},
    prompt::{
        MovePromptsResult, Prompt, PromptCategoryDeleteReport, PromptCategoryNode, PromptFilter,
        PromptInput, PromptPlacement, PromptQuery, PromptSort, MAX_PROMPT_CONTENT_CHARS,
    },
};

use super::PromptError;

const PROMPT_SELECT: &str = r#"
SELECT
    p.id, p.title, p.content,
    p.category_id, cat.name AS category_name,
    cat.color AS category_color, cat.icon_name AS category_icon_name,
    p.background_color, p.is_favorite, p.sort_order,
    p.use_count, p.last_used_at, p.created_at, p.updated_at
FROM prompts p
LEFT JOIN prompt_categories cat ON cat.id = p.category_id
"#;

pub struct PromptRepository<'a> {
    connection: &'a Connection,
}

impl<'a> PromptRepository<'a> {
    pub fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub fn list_prompts(&self, query: &PromptQuery) -> Result<Vec<Prompt>, PromptError> {
        let limit = query.limit.unwrap_or(200).clamp(1, 500);
        let mut clauses = vec!["p.deleted_at IS NULL".to_owned()];
        let mut params = Vec::<Value>::new();

        match query.filter {
            PromptFilter::All => {}
            PromptFilter::Recent => clauses.push("p.last_used_at IS NOT NULL".to_owned()),
            PromptFilter::Favorites => clauses.push("p.is_favorite = 1".to_owned()),
        }

        if let Some(category_id) = query
            .category_id
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            clauses.push("p.category_id = ?".to_owned());
            params.push(Value::Text(category_id.to_owned()));
        }
        if query.unclassified_only {
            clauses.push("p.category_id IS NULL".to_owned());
        }
        if let Some(tag_id) = query.tag_id.as_deref().filter(|value| !value.is_empty()) {
            clauses.push(
                "EXISTS (SELECT 1 FROM prompt_tags pt_filter
                  WHERE pt_filter.prompt_id = p.id AND pt_filter.tag_id = ?)"
                    .to_owned(),
            );
            params.push(Value::Text(tag_id.to_owned()));
        }

        let search = query.search.trim();
        if !search.is_empty() {
            let like = format!("%{}%", escape_like(search));
            let mut search_clauses = vec![
                "p.title LIKE ? ESCAPE '\\'".to_owned(),
                "p.content LIKE ? ESCAPE '\\'".to_owned(),
                "EXISTS (SELECT 1 FROM prompt_tags pt_search JOIN tags t_search ON t_search.id = pt_search.tag_id WHERE pt_search.prompt_id = p.id AND t_search.name LIKE ? ESCAPE '\\')".to_owned(),
            ];
            for _ in 0..3 {
                params.push(Value::Text(like.clone()));
            }
            if let Some(fts_query) = build_fts_query(search) {
                search_clauses.push(
                    "p.id IN (SELECT prompt_id FROM prompts_fts WHERE prompts_fts MATCH ?)"
                        .to_owned(),
                );
                params.push(Value::Text(fts_query));
            }
            clauses.push(format!("({})", search_clauses.join(" OR ")));
        }

        let order = match query.sort {
            PromptSort::Manual => {
                "p.sort_order ASC, p.updated_at DESC, p.title COLLATE NOCASE ASC, p.id ASC"
            }
            PromptSort::Recent => {
                "p.last_used_at IS NULL ASC, p.last_used_at DESC, p.updated_at DESC, p.id ASC"
            }
            PromptSort::Updated => "p.updated_at DESC, p.title COLLATE NOCASE ASC, p.id ASC",
            PromptSort::Title => "p.title COLLATE NOCASE ASC, p.sort_order ASC, p.id ASC",
            PromptSort::MostUsed => {
                "p.use_count DESC, p.last_used_at IS NULL ASC, p.last_used_at DESC, p.id ASC"
            }
        };
        params.push(Value::Integer(limit as i64));

        let sql = format!(
            "{PROMPT_SELECT} WHERE {} ORDER BY {order} LIMIT ?",
            clauses.join(" AND ")
        );
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(params.iter()), map_prompt_row)?;
        let mut prompts = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        self.attach_tags(&mut prompts)?;
        Ok(prompts)
    }

    pub fn library_summary(
        &self,
    ) -> Result<crate::models::prompt::PromptLibrarySummary, PromptError> {
        let prompt_count: i64 = self.connection.query_row(
            "SELECT count(*) FROM prompts WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        let favorite_count: i64 = self.connection.query_row(
            "SELECT count(*) FROM prompts WHERE deleted_at IS NULL AND is_favorite = 1",
            [],
            |row| row.get(0),
        )?;
        let category_count: i64 =
            self.connection
                .query_row("SELECT count(*) FROM prompt_categories", [], |row| {
                    row.get(0)
                })?;
        let tag_count: i64 =
            self.connection
                .query_row("SELECT count(*) FROM prompt_tags", [], |row| row.get(0))?;
        let recent_prompts = self.list_prompts(&PromptQuery {
            filter: PromptFilter::Recent,
            sort: PromptSort::Recent,
            limit: Some(3),
            ..PromptQuery::default()
        })?;
        Ok(crate::models::prompt::PromptLibrarySummary {
            prompt_count,
            favorite_count,
            category_count,
            tag_count,
            recent_prompts,
        })
    }

    pub fn get_prompt(&self, id: &str) -> Result<Option<Prompt>, PromptError> {
        let sql = format!("{PROMPT_SELECT} WHERE p.id = ?1 AND p.deleted_at IS NULL");
        let mut prompt = self
            .connection
            .query_row(&sql, [id], map_prompt_row)
            .optional()?;
        if let Some(prompt) = prompt.as_mut() {
            let tags = self.tags_for_ids(std::slice::from_ref(&prompt.id))?;
            prompt.tags = tags.get(&prompt.id).cloned().unwrap_or_default();
        }
        Ok(prompt)
    }

    pub fn find_active_by_content(&self, content: &str) -> Result<Option<Prompt>, PromptError> {
        let id: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM prompts
                 WHERE deleted_at IS NULL AND content = ?1
                 ORDER BY updated_at DESC LIMIT 1",
                [content],
                |row| row.get(0),
            )
            .optional()?;
        match id {
            Some(id) => self.get_prompt(&id),
            None => Ok(None),
        }
    }

    pub fn create_prompt(
        &self,
        id: &str,
        input: &PromptInput,
        now: i64,
    ) -> Result<Prompt, PromptError> {
        validate_input(input)?;
        let transaction = self.connection.unchecked_transaction()?;
        ensure_category_exists(&transaction, input.category_id.as_deref())?;
        let next_sort: i64 = transaction.query_row(
            "SELECT coalesce(max(sort_order), 0) + 10 FROM prompts WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO prompts (
                id, title, content, category_id, background_color,
                is_favorite, sort_order, use_count, last_used_at,
                created_at, updated_at, deleted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, NULL, ?8, ?8, NULL)",
            params![
                id,
                input.title.trim(),
                input.content,
                input.category_id,
                input.background_color,
                input.favorite as i64,
                next_sort,
                now
            ],
        )?;
        self.replace_tags(&transaction, id, &input.tags, now)?;
        transaction.commit()?;
        self.get_prompt(id)?
            .ok_or_else(|| PromptError::Internal("提示词写入后无法读取".to_owned()))
    }

    pub fn update_prompt(
        &self,
        id: &str,
        input: &PromptInput,
        now: i64,
    ) -> Result<Prompt, PromptError> {
        validate_input(input)?;
        let transaction = self.connection.unchecked_transaction()?;
        ensure_category_exists(&transaction, input.category_id.as_deref())?;
        let changed = transaction.execute(
            "UPDATE prompts
             SET title = ?2, content = ?3, category_id = ?4,
                 background_color = ?5, is_favorite = ?6, updated_at = ?7
             WHERE id = ?1 AND deleted_at IS NULL",
            params![
                id,
                input.title.trim(),
                input.content,
                input.category_id,
                input.background_color,
                input.favorite as i64,
                now
            ],
        )?;
        if changed == 0 {
            return Err(PromptError::NotFound);
        }
        self.replace_tags(&transaction, id, &input.tags, now)?;
        transaction.commit()?;
        self.get_prompt(id)?
            .ok_or_else(|| PromptError::Internal("提示词更新后无法读取".to_owned()))
    }

    pub fn delete_prompt(&self, id: &str, now: i64) -> Result<(), PromptError> {
        let changed = self.connection.execute(
            "UPDATE prompts SET deleted_at = ?2, updated_at = ?2
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        if changed == 0 {
            return Err(PromptError::NotFound);
        }
        Ok(())
    }

    pub fn toggle_favorite(&self, id: &str, now: i64) -> Result<Prompt, PromptError> {
        let changed = self.connection.execute(
            "UPDATE prompts
             SET is_favorite = CASE is_favorite WHEN 1 THEN 0 ELSE 1 END,
                 updated_at = ?2
             WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        if changed == 0 {
            return Err(PromptError::NotFound);
        }
        self.get_prompt(id)?.ok_or(PromptError::NotFound)
    }

    pub fn record_usage(&self, ids: &[String], now: i64) -> Result<usize, PromptError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let transaction = self.connection.unchecked_transaction()?;
        let mut changed = 0;
        {
            let mut statement = transaction.prepare(
                "UPDATE prompts
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

    pub fn reorder_prompts(&self, ids: &[String]) -> Result<(), PromptError> {
        if ids.is_empty() {
            return Err(PromptError::Validation("没有需要排序的提示词。".to_owned()));
        }
        let mut unique = HashSet::new();
        if !ids.iter().all(|id| unique.insert(id.as_str())) {
            return Err(PromptError::Validation(
                "提示词排序列表包含重复 ID。".to_owned(),
            ));
        }

        let transaction = self.connection.unchecked_transaction()?;
        let current = {
            let mut statement = transaction.prepare(
                "SELECT id, sort_order FROM prompts
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
            return Err(PromptError::NotFound);
        }

        let mut final_ids = current.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
        for (position, id) in positions.into_iter().zip(ids.iter()) {
            final_ids[position] = id.clone();
        }

        {
            let mut statement =
                transaction.prepare("UPDATE prompts SET sort_order = ?2 WHERE id = ?1")?;
            for (index, id) in final_ids.iter().enumerate() {
                statement.execute(params![id, ((index as i64) + 1) * 10])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn move_prompts_to_category(
        &self,
        ids: &[String],
        category_id: Option<&str>,
        now: i64,
    ) -> Result<MovePromptsResult, PromptError> {
        if ids.is_empty() {
            return Err(PromptError::Validation("没有需要移动的提示词。".to_owned()));
        }
        let transaction = self.connection.unchecked_transaction()?;
        ensure_category_exists(&transaction, category_id)?;
        let previous = prompts_for_movement(&transaction, ids)?;
        let next_sort: i64 = transaction.query_row(
            "SELECT coalesce(max(sort_order), 0) + 10 FROM prompts
             WHERE deleted_at IS NULL AND category_id IS ?1",
            [category_id],
            |row| row.get(0),
        )?;
        let mut moved = 0usize;
        let mut update = transaction.prepare(
            "UPDATE prompts
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
        Ok(MovePromptsResult { moved, previous })
    }

    pub fn restore_prompt_placements(
        &self,
        placements: &[PromptPlacement],
        now: i64,
    ) -> Result<usize, PromptError> {
        if placements.is_empty() {
            return Ok(0);
        }
        let transaction = self.connection.unchecked_transaction()?;
        let mut changed = 0usize;
        let mut update = transaction.prepare(
            "UPDATE prompts
             SET category_id = ?2, sort_order = ?3, updated_at = ?4
             WHERE id = ?1 AND deleted_at IS NULL",
        )?;
        for placement in placements {
            let category_exists: bool = match placement.category_id.as_deref() {
                Some(category_id) => {
                    transaction.query_row(
                        "SELECT count(*) FROM prompt_categories WHERE id = ?1",
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

    pub fn set_prompts_color(
        &self,
        ids: &[String],
        color: Option<&str>,
    ) -> Result<usize, PromptError> {
        validate_prompt_ids(ids)?;
        let transaction = self.connection.unchecked_transaction()?;
        ensure_prompts_exist(&transaction, ids)?;
        let placeholders = repeat_placeholders(ids.len());
        let sql = format!(
            "UPDATE prompts SET background_color = ?1
             WHERE deleted_at IS NULL AND id IN ({placeholders})"
        );
        let mut values = Vec::<Value>::with_capacity(ids.len() + 1);
        values.push(match color {
            Some(value) => Value::Text(value.to_owned()),
            None => Value::Null,
        });
        values.extend(ids.iter().map(|id| Value::Text(id.clone())));
        let changed = transaction.execute(&sql, params_from_iter(values.iter()))?;
        transaction.commit()?;
        Ok(changed)
    }

    pub fn list_categories(&self) -> Result<Vec<PromptCategoryNode>, PromptError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, parent_id, sort_order, color, icon_name FROM prompt_categories
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
            "SELECT category_id, count(*) FROM prompts
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
        let mut children: HashMap<Option<String>, Vec<PromptCategoryNode>> = HashMap::new();
        for (id, name, parent_id, sort_order, color, icon_name) in categories.drain(..) {
            let parent_id = parent_id.filter(|parent| ids.contains(parent) && *parent != id);
            children
                .entry(parent_id.clone())
                .or_default()
                .push(PromptCategoryNode {
                    prompt_count: counts.get(&id).copied().unwrap_or(0),
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
    ) -> Result<String, PromptError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(PromptError::Validation(
                "目录名称需为 1–80 个字符。".to_owned(),
            ));
        }
        ensure_category_exists(self.connection, parent_id)?;
        let duplicate: i64 = self.connection.query_row(
            "SELECT count(*) FROM prompt_categories
             WHERE name = ?1 COLLATE NOCASE AND parent_id IS ?2",
            params![name, parent_id],
            |row| row.get(0),
        )?;
        if duplicate > 0 {
            return Err(PromptError::Conflict(
                "同一父目录下已存在同名目录。".to_owned(),
            ));
        }
        let next_sort: i64 = self.connection.query_row(
            "SELECT coalesce(max(sort_order), 0) + 10 FROM prompt_categories WHERE parent_id IS ?1",
            [parent_id],
            |row| row.get(0),
        )?;
        self.connection.execute(
            "INSERT INTO prompt_categories
                (id, name, parent_id, sort_order, created_at, updated_at)
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
    ) -> Result<(), PromptError> {
        let current = self
            .connection
            .query_row(
                "SELECT name, parent_id FROM prompt_categories WHERE id = ?1",
                [id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .ok_or(PromptError::NotFound)?;
        let next_name = name.map(str::trim).filter(|value| !value.is_empty());
        if next_name.is_some_and(|value| value.chars().count() > 80) {
            return Err(PromptError::Validation(
                "目录名称需为 1–80 个字符。".to_owned(),
            ));
        }
        let next_parent = parent_id.map(|value| value.map(str::to_owned));
        if let Some(Some(parent)) = &next_parent {
            if parent == id {
                return Err(PromptError::Validation("目录不能移动到自身。".to_owned()));
            }
            ensure_category_exists(self.connection, Some(parent))?;
            if self.is_category_descendant(parent, id)? {
                return Err(PromptError::Validation(
                    "目录不能移动到自己的子目录中。".to_owned(),
                ));
            }
        }
        let final_name = next_name.unwrap_or(&current.0);
        let final_parent = next_parent.as_ref().unwrap_or(&current.1);
        let duplicate: i64 = self.connection.query_row(
            "SELECT count(*) FROM prompt_categories
             WHERE id <> ?1 AND name = ?2 COLLATE NOCASE AND parent_id IS ?3",
            params![id, final_name, final_parent],
            |row| row.get(0),
        )?;
        if duplicate > 0 {
            return Err(PromptError::Conflict(
                "同一父目录下已存在同名目录。".to_owned(),
            ));
        }
        self.connection.execute(
            "UPDATE prompt_categories SET name = ?2, parent_id = ?3, updated_at = ?4
             WHERE id = ?1",
            params![id, final_name, final_parent, now],
        )?;
        Ok(())
    }

    pub fn set_category_appearance(
        &self,
        id: &str,
        color: Option<&str>,
        icon_name: Option<&str>,
        now: i64,
    ) -> Result<(), PromptError> {
        let changed = self.connection.execute(
            "UPDATE prompt_categories SET color = ?2, icon_name = ?3, updated_at = ?4
             WHERE id = ?1",
            params![id, color, icon_name, now],
        )?;
        if changed == 0 {
            return Err(PromptError::NotFound);
        }
        Ok(())
    }

    pub fn reorder_categories(
        &self,
        parent_id: Option<&str>,
        ids: &[String],
    ) -> Result<(), PromptError> {
        if ids.is_empty() {
            return Err(PromptError::Validation("没有需要排序的目录。".to_owned()));
        }
        ensure_category_exists(self.connection, parent_id)?;
        let mut unique = HashSet::new();
        if !ids.iter().all(|id| unique.insert(id.as_str())) {
            return Err(PromptError::Validation(
                "目录排序列表包含重复 ID。".to_owned(),
            ));
        }
        let siblings = {
            let mut statement = self.connection.prepare(
                "SELECT id FROM prompt_categories
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
            return Err(PromptError::NotFound);
        }
        let mut final_ids = siblings;
        for (position, id) in positions.into_iter().zip(ids.iter()) {
            final_ids[position] = id.clone();
        }
        let transaction = self.connection.unchecked_transaction()?;
        {
            let mut statement = transaction
                .prepare("UPDATE prompt_categories SET sort_order = ?2 WHERE id = ?1")?;
            for (index, id) in final_ids.iter().enumerate() {
                statement.execute(params![id, ((index as i64) + 1) * 10])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_category_with_options(
        &self,
        id: &str,
        options: &CategoryDeleteOptions,
        now: i64,
    ) -> Result<PromptCategoryDeleteReport, PromptError> {
        let transaction = self.connection.unchecked_transaction()?;
        let parent_id: Option<String> = transaction
            .query_row(
                "SELECT parent_id FROM prompt_categories WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(PromptError::NotFound)?;
        let prompt_target = match options.command_action {
            CategoryCommandAction::MoveToParent => parent_id.clone(),
            CategoryCommandAction::Unclassified => None,
        };
        ensure_category_exists(&transaction, prompt_target.as_deref())?;

        let category_ids = if options.child_action == CategoryChildAction::DeleteSubtree {
            let mut statement = transaction.prepare(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM prompt_categories WHERE id = ?1
                    UNION ALL
                    SELECT c.id FROM prompt_categories c
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

        let prompt_ids = {
            let placeholders = repeat_placeholders(category_ids.len());
            let sql = format!(
                "SELECT id FROM prompts
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
            "SELECT coalesce(max(sort_order), 0) + 10 FROM prompts
             WHERE deleted_at IS NULL AND category_id IS ?1",
            [prompt_target.as_deref()],
            |row| row.get(0),
        )?;
        {
            let mut update = transaction.prepare(
                "UPDATE prompts
                 SET category_id = ?2, sort_order = ?3, updated_at = ?4
                 WHERE id = ?1 AND deleted_at IS NULL",
            )?;
            for prompt_id in &prompt_ids {
                update.execute(params![prompt_id, prompt_target, next_sort, now])?;
                next_sort += 10;
            }
        }

        if options.child_action == CategoryChildAction::Promote {
            let children = {
                let mut statement = transaction.prepare(
                    "SELECT id, name FROM prompt_categories
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
                "SELECT coalesce(max(sort_order), 0) + 10 FROM prompt_categories
                 WHERE parent_id IS ?1 AND id <> ?2",
                params![parent_id, id],
                |row| row.get(0),
            )?;
            for (child_id, child_name) in children {
                let duplicate: i64 = transaction.query_row(
                    "SELECT count(*) FROM prompt_categories
                     WHERE parent_id IS ?1 AND id <> ?2 AND name = ?3 COLLATE NOCASE",
                    params![parent_id, id, child_name],
                    |row| row.get(0),
                )?;
                if duplicate > 0 {
                    return Err(PromptError::Conflict(format!(
                        "无法提升子目录「{child_name}」：目标层级已有同名目录。"
                    )));
                }
                transaction.execute(
                    "UPDATE prompt_categories SET parent_id = ?2, sort_order = ?3 WHERE id = ?1",
                    params![child_id, parent_id, child_sort],
                )?;
                child_sort += 10;
            }
        }

        let deleted = transaction.execute("DELETE FROM prompt_categories WHERE id = ?1", [id])?;
        if deleted == 0 {
            return Err(PromptError::NotFound);
        }
        transaction.commit()?;
        Ok(PromptCategoryDeleteReport {
            moved_prompts: prompt_ids.len(),
            deleted_categories: category_ids.len(),
            target_category_id: prompt_target,
        })
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>, PromptError> {
        let mut statement = self.connection.prepare(
            "SELECT t.id, t.name, t.color, t.created_at, count(p.id)
             FROM tags t
             JOIN prompt_tags pt ON pt.tag_id = t.id
             JOIN prompts p ON p.id = pt.prompt_id AND p.deleted_at IS NULL
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
        prompt_id: &str,
        tags: &[String],
        now: i64,
    ) -> Result<(), PromptError> {
        connection.execute("DELETE FROM prompt_tags WHERE prompt_id = ?1", [prompt_id])?;
        let mut seen = HashSet::new();
        for raw in tags {
            let name = raw.trim();
            if name.is_empty() || name.chars().count() > 40 {
                return Err(PromptError::Validation(
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
                "INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?1, ?2)",
                params![prompt_id, tag_id],
            )?;
        }
        Ok(())
    }

    fn tags_for_ids(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, Vec<TagSummary>>, PromptError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders = repeat_placeholders(ids.len());
        let sql = format!(
            "SELECT pt.prompt_id, t.id, t.name, t.color
             FROM prompt_tags pt
             JOIN tags t ON t.id = pt.tag_id
             WHERE pt.prompt_id IN ({placeholders})
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
            let (prompt_id, tag) = row?;
            result.entry(prompt_id).or_default().push(tag);
        }
        Ok(result)
    }

    fn attach_tags(&self, prompts: &mut [Prompt]) -> Result<(), PromptError> {
        let ids = prompts
            .iter()
            .map(|prompt| prompt.id.clone())
            .collect::<Vec<_>>();
        let mut tags = self.tags_for_ids(&ids)?;
        for prompt in prompts {
            prompt.tags = tags.remove(&prompt.id).unwrap_or_default();
        }
        Ok(())
    }

    fn is_category_descendant(&self, candidate: &str, ancestor: &str) -> Result<bool, PromptError> {
        let mut current = Some(candidate.to_owned());
        let mut visited = HashSet::new();
        while let Some(id) = current {
            if !visited.insert(id.clone()) {
                return Ok(true);
            }
            let parent: Option<String> = self
                .connection
                .query_row(
                    "SELECT parent_id FROM prompt_categories WHERE id = ?1",
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
}

fn build_category_tree(
    parent_id: Option<String>,
    children: &mut HashMap<Option<String>, Vec<PromptCategoryNode>>,
    depth: usize,
) -> Vec<PromptCategoryNode> {
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

fn validate_prompt_ids(ids: &[String]) -> Result<(), PromptError> {
    if ids.is_empty() {
        return Err(PromptError::Validation(
            "没有选择需要修改外观的提示词。".to_owned(),
        ));
    }
    let mut unique = HashSet::new();
    if !ids.iter().all(|id| unique.insert(id.as_str())) {
        return Err(PromptError::Validation(
            "提示词外观列表中包含重复 ID。".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_prompts_exist(connection: &Connection, ids: &[String]) -> Result<(), PromptError> {
    let placeholders = repeat_placeholders(ids.len());
    let sql =
        format!("SELECT count(*) FROM prompts WHERE deleted_at IS NULL AND id IN ({placeholders})");
    let found: i64 = connection.query_row(&sql, params_from_iter(ids.iter()), |row| row.get(0))?;
    if found as usize != ids.len() {
        return Err(PromptError::NotFound);
    }
    Ok(())
}

fn prompts_for_movement(
    connection: &Connection,
    ids: &[String],
) -> Result<Vec<PromptPlacement>, PromptError> {
    let placeholders = repeat_placeholders(ids.len());
    let sql = format!(
        "SELECT id, category_id, sort_order FROM prompts
         WHERE deleted_at IS NULL AND id IN ({placeholders})"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(params_from_iter(ids.iter()), |row| {
            Ok(PromptPlacement {
                id: row.get(0)?,
                category_id: row.get(1)?,
                sort_order: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.len() != ids.len() {
        return Err(PromptError::NotFound);
    }
    let mut by_id = rows
        .into_iter()
        .map(|placement| (placement.id.clone(), placement))
        .collect::<HashMap<_, _>>();
    ids.iter()
        .map(|id| {
            by_id
                .remove(id)
                .ok_or_else(|| PromptError::Internal("提示词移动结果不完整。".to_owned()))
        })
        .collect()
}

fn map_prompt_row(row: &Row<'_>) -> rusqlite::Result<Prompt> {
    Ok(Prompt {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        category_id: row.get(3)?,
        category_name: row.get(4)?,
        category_color: row.get(5)?,
        category_icon_name: row.get(6)?,
        background_color: row.get(7)?,
        is_favorite: row.get::<_, i64>(8)? != 0,
        sort_order: row.get(9)?,
        use_count: row.get(10)?,
        last_used_at: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        tags: Vec::new(),
    })
}

fn ensure_category_exists(
    connection: &Connection,
    category_id: Option<&str>,
) -> Result<(), PromptError> {
    if let Some(id) = category_id.filter(|value| !value.is_empty()) {
        let exists: i64 = connection.query_row(
            "SELECT count(*) FROM prompt_categories WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(PromptError::Validation("所选目录不存在。".to_owned()));
        }
    }
    Ok(())
}

fn validate_input(input: &PromptInput) -> Result<(), PromptError> {
    if input.content.trim().is_empty() {
        return Err(PromptError::Validation("提示词内容不能为空。".to_owned()));
    }
    if input.content.chars().count() > MAX_PROMPT_CONTENT_CHARS {
        return Err(PromptError::Validation(
            "提示词内容过长（最多 200,000 个字符）。".to_owned(),
        ));
    }
    if input.title.trim().chars().count() > 200 {
        return Err(PromptError::Validation(
            "提示词标题不能超过 200 个字符。".to_owned(),
        ));
    }
    if input.tags.len() > 24 {
        return Err(PromptError::Validation(
            "单条提示词最多 24 个标签。".to_owned(),
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
