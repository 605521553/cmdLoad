use rusqlite::{params, OptionalExtension};

use crate::models::ai::{
    AiAnnotation, GeneratedAiAnnotation, ManualAnnotationMode, SaveAiAnnotationInput,
};

use super::{
    command_has_manual_annotation, normalize_draft, now_millis, AiCommandState, AiError, AiService,
};
impl AiService<'_> {
    pub fn command_state(&self, command_id: &str) -> Result<AiCommandState, AiError> {
        self.database.with_connection(|connection| {
            let row = connection
                .query_row(
                    "SELECT c.id, c.command, c.title, c.description, c.shell,
                            c.ai_annotation_status,
                            EXISTS (SELECT 1 FROM ai_annotations a WHERE a.command_id = c.id)
                     FROM commands c
                     WHERE c.id = ?1 AND c.deleted_at IS NULL",
                    [command_id],
                    |row| {
                        Ok(AiCommandState {
                            id: row.get(0)?,
                            command: row.get(1)?,
                            title: row.get(2)?,
                            description: row.get(3)?,
                            shell: row.get(4)?,
                            status: row.get(5)?,
                            has_annotation: row.get::<_, i64>(6)? != 0,
                        })
                    },
                )
                .optional()?;
            row.ok_or(AiError::CommandNotFound)
        })
    }

    pub fn mark_status(&self, command_id: &str, status: &str) -> Result<(), AiError> {
        if !matches!(status, "none" | "pending" | "ready" | "failed") {
            return Err(AiError::InvalidInput("无效的 AI 状态。".to_owned()));
        }
        self.database.with_connection(|connection| {
            let changed = connection.execute(
                "UPDATE commands SET ai_annotation_status = ?2
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![command_id, status],
            )?;
            if changed == 0 {
                return Err(AiError::CommandNotFound);
            }
            Ok(())
        })
    }

    /// A process exit can leave `pending` behind because the network task cannot
    /// finish. Recover those rows as failures at startup so the user can retry.
    pub fn recover_interrupted(&self) -> Result<usize, AiError> {
        self.database.with_connection(|connection| {
            Ok(connection.execute(
                "UPDATE commands SET ai_annotation_status = 'failed'
                 WHERE ai_annotation_status = 'pending' AND deleted_at IS NULL",
                [],
            )?)
        })
    }

    /// Persist a user-confirmed generation result. The current command text hash
    /// is checked again under the same transaction that writes the annotation.
    pub fn save_generated(&self, input: SaveAiAnnotationInput) -> Result<AiAnnotation, AiError> {
        let GeneratedAiAnnotation {
            command_id,
            command_content_hash,
            provider,
            model,
            prompt_version,
            generated_at: _,
            annotation,
        } = input.generated;
        let provider = normalize_metadata("服务商", &provider)?;
        let model = normalize_metadata("模型", &model)?;
        let prompt_version = normalize_metadata("Prompt 版本", &prompt_version)?;
        let draft = normalize_draft(annotation)?;
        let now = now_millis();

        self.database.with_connection(|connection| {
            let transaction = connection.unchecked_transaction()?;
            let current = transaction
                .query_row(
                    "SELECT command, title, description, content_hash
                     FROM commands WHERE id = ?1 AND deleted_at IS NULL",
                    [&command_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .optional()?
                .ok_or(AiError::CommandNotFound)?;
            let current_hash = crate::services::clipboard::content_hash(&current.0);
            if command_content_hash != current_hash
                || current.3.as_deref() != Some(current_hash.as_str())
            {
                return Err(AiError::StaleCommand);
            }

            let manual = command_has_manual_annotation(&current.1, &current.0, &current.2);
            let (next_title, next_description, manual_changed) = match input.manual_mode {
                ManualAnnotationMode::Keep => (current.1.clone(), current.2.clone(), false),
                ManualAnnotationMode::Append if manual => {
                    let existing_title = current.1.trim_end();
                    let suffix = if existing_title.is_empty() {
                        format!("AI：{}", draft.short_description)
                    } else {
                        format!("；AI：{}", draft.short_description)
                    };
                    let title = if current.1.chars().count() + suffix.chars().count() <= 200 {
                        format!("{}{}", current.1, suffix)
                    } else {
                        current.1.clone()
                    };
                    let addition = format!("AI 补充：{}", draft.detailed_description);
                    let description = if current.2.trim().is_empty() {
                        addition
                    } else {
                        format!("{}\n\n{}", current.2.trim_end(), addition)
                    };
                    (title, truncate_chars(&description, 10_000), true)
                }
                ManualAnnotationMode::Replace if manual => (
                    truncate_chars(&draft.short_description, 200),
                    truncate_chars(&draft.detailed_description, 10_000),
                    true,
                ),
                // Append/replace without an existing handwritten annotation has
                // nothing to preserve or replace; the AI row is still saved.
                ManualAnnotationMode::Append | ManualAnnotationMode::Replace => {
                    (current.1.clone(), current.2.clone(), false)
                }
            };

            if manual_changed {
                transaction.execute(
                    "UPDATE commands SET title = ?2, description = ?3, updated_at = ?4
                     WHERE id = ?1 AND deleted_at IS NULL",
                    params![command_id, next_title, next_description, now],
                )?;
            }

            let parameters_json = serde_json::to_string(&draft.parameters)
                .map_err(|error| AiError::InvalidInput(error.to_string()))?;
            let requirements_json = serde_json::to_string(&draft.requirements)
                .map_err(|error| AiError::InvalidInput(error.to_string()))?;
            let warnings_json = serde_json::to_string(&draft.warnings)
                .map_err(|error| AiError::InvalidInput(error.to_string()))?;
            let annotation_id = transaction
                .query_row(
                    "SELECT id FROM ai_annotations WHERE command_id = ?1",
                    [&command_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            transaction.execute(
                "INSERT INTO ai_annotations (
                    id, command_id, short_description, detailed_description,
                    parameters_json, requirements_json, warnings_json,
                    suggested_shell, risk_level, provider, model,
                    command_content_hash, prompt_version, generated_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
                 ON CONFLICT(command_id) DO UPDATE SET
                    short_description = excluded.short_description,
                    detailed_description = excluded.detailed_description,
                    parameters_json = excluded.parameters_json,
                    requirements_json = excluded.requirements_json,
                    warnings_json = excluded.warnings_json,
                    suggested_shell = excluded.suggested_shell,
                    risk_level = excluded.risk_level,
                    provider = excluded.provider,
                    model = excluded.model,
                    command_content_hash = excluded.command_content_hash,
                    prompt_version = excluded.prompt_version,
                    generated_at = excluded.generated_at,
                    updated_at = excluded.updated_at",
                params![
                    annotation_id,
                    command_id,
                    draft.short_description,
                    draft.detailed_description,
                    parameters_json,
                    requirements_json,
                    warnings_json,
                    draft.suggested_shell,
                    draft.risk_level,
                    provider,
                    model,
                    current_hash,
                    prompt_version,
                    now,
                ],
            )?;

            transaction.execute(
                "UPDATE commands SET ai_annotation_status = 'ready'
                 WHERE id = ?1 AND deleted_at IS NULL",
                [&command_id],
            )?;
            transaction.commit()?;

            Ok(AiAnnotation {
                id: annotation_id,
                command_id,
                short_description: draft.short_description,
                detailed_description: draft.detailed_description,
                parameters: draft.parameters,
                requirements: draft.requirements,
                warnings: draft.warnings,
                suggested_shell: draft.suggested_shell,
                risk_level: draft.risk_level,
                provider,
                model,
                command_content_hash: current_hash,
                prompt_version,
                generated_at: now,
                updated_at: now,
                is_stale: false,
            })
        })
    }
}

fn normalize_metadata(label: &str, value: &str) -> Result<String, AiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 120 {
        return Err(AiError::InvalidInput(format!("{label}信息无效。")));
    }
    Ok(trimmed.to_owned())
}

pub fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let mut result = value
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    result.push('…');
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ai::AiAnnotationDraft;

    #[test]
    fn truncation_counts_chinese_characters() {
        assert_eq!(truncate_chars("查看所有容器", 10), "查看所有容器");
        assert_eq!(truncate_chars("查看所有容器并显示状态", 6), "查看所有容…");
    }

    #[test]
    fn draft_validation_is_available_to_repository_tests() {
        let draft = AiAnnotationDraft {
            short_description: "查看所有 Docker 容器".to_owned(),
            detailed_description: "列出全部容器。".to_owned(),
            ..AiAnnotationDraft::default()
        };
        assert!(normalize_draft(draft).is_ok());
    }
}
