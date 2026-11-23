use rusqlite::Connection;

pub const DATABASE_SCHEMA_VERSION: u32 = 5;

pub const MIGRATION_001: &str = r#"
CREATE TABLE categories (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT REFERENCES categories(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    CHECK (length(trim(name)) BETWEEN 1 AND 80),
    CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX idx_categories_parent
    ON categories(parent_id, sort_order, name COLLATE NOCASE);
CREATE UNIQUE INDEX idx_categories_unique_name
    ON categories(ifnull(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE tags (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color       TEXT,
    created_at  INTEGER NOT NULL,
    CHECK (length(trim(name)) BETWEEN 1 AND 40)
);

CREATE TABLE commands (
    id            TEXT PRIMARY KEY NOT NULL,
    title         TEXT NOT NULL,
    command       TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    shell         TEXT NOT NULL DEFAULT 'powershell',
    category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
    is_favorite   INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    use_count     INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    last_used_at  INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    CHECK (length(trim(title)) BETWEEN 1 AND 200),
    CHECK (length(trim(command)) > 0)
);

CREATE INDEX idx_commands_active_sort
    ON commands(deleted_at, category_id, sort_order, updated_at DESC);
CREATE INDEX idx_commands_last_used
    ON commands(deleted_at, last_used_at DESC);
CREATE INDEX idx_commands_favorite
    ON commands(deleted_at, is_favorite, updated_at DESC);

CREATE TABLE command_tags (
    command_id  TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (command_id, tag_id)
);

CREATE INDEX idx_command_tags_tag ON command_tags(tag_id, command_id);

CREATE VIRTUAL TABLE commands_fts USING fts5(
    command_id UNINDEXED,
    title,
    command_text,
    description,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER commands_fts_insert AFTER INSERT ON commands BEGIN
    INSERT INTO commands_fts(command_id, title, command_text, description)
    VALUES (new.id, new.title, new.command, new.description);
END;

CREATE TRIGGER commands_fts_update AFTER UPDATE OF title, command, description ON commands BEGIN
    DELETE FROM commands_fts WHERE command_id = old.id;
    INSERT INTO commands_fts(command_id, title, command_text, description)
    VALUES (new.id, new.title, new.command, new.description);
END;

CREATE TRIGGER commands_fts_delete AFTER DELETE ON commands BEGIN
    DELETE FROM commands_fts WHERE command_id = old.id;
END;
"#;

pub const MIGRATION_002: &str = r#"
ALTER TABLE commands ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE commands ADD COLUMN content_hash TEXT;
ALTER TABLE commands ADD COLUMN ai_annotation_status TEXT NOT NULL DEFAULT 'none';

CREATE INDEX idx_commands_content_hash_active
    ON commands(deleted_at, content_hash);

CREATE TABLE clipboard_entries (
    id              TEXT PRIMARY KEY NOT NULL,
    content         TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'local_monitor',
    content_type    TEXT NOT NULL DEFAULT 'text',
    copied_at       INTEGER NOT NULL,
    is_sensitive    INTEGER NOT NULL DEFAULT 0 CHECK (is_sensitive IN (0, 1)),
    linked_command_id TEXT REFERENCES commands(id) ON DELETE SET NULL,
    CHECK (length(content) > 0),
    CHECK (source IN ('current', 'system_history', 'local_monitor'))
);

CREATE UNIQUE INDEX idx_clipboard_entries_hash
    ON clipboard_entries(content_hash);
CREATE INDEX idx_clipboard_entries_copied
    ON clipboard_entries(copied_at DESC);
"#;

/// Appearance columns are additive and nullable. Existing commands and
/// categories keep their data; a command without a custom color simply uses the
/// theme default, and a category without appearance uses the neutral folder.
pub const MIGRATION_003: &str = r#"
ALTER TABLE commands ADD COLUMN background_color TEXT;
ALTER TABLE commands ADD COLUMN use_category_color INTEGER NOT NULL DEFAULT 0
    CHECK (use_category_color IN (0, 1));

ALTER TABLE categories ADD COLUMN color TEXT;
ALTER TABLE categories ADD COLUMN icon_name TEXT;
"#;

/// AI annotations are additive and isolated from command text and handwritten
/// title/description. Generated content is always stored as structured metadata;
/// the API key is never written here (Windows Credential Manager owns it).
pub const MIGRATION_004: &str = r#"
CREATE TABLE ai_annotations (
    id                     TEXT PRIMARY KEY NOT NULL,
    command_id             TEXT NOT NULL UNIQUE REFERENCES commands(id) ON DELETE CASCADE,
    short_description      TEXT NOT NULL,
    detailed_description   TEXT NOT NULL DEFAULT '',
    parameters_json        TEXT NOT NULL DEFAULT '[]',
    requirements_json      TEXT NOT NULL DEFAULT '[]',
    warnings_json          TEXT NOT NULL DEFAULT '[]',
    suggested_shell        TEXT NOT NULL DEFAULT 'unknown',
    risk_level             TEXT NOT NULL DEFAULT 'unknown',
    provider               TEXT NOT NULL,
    model                  TEXT NOT NULL,
    command_content_hash   TEXT NOT NULL,
    prompt_version         TEXT NOT NULL,
    generated_at           INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL,
    CHECK (length(trim(short_description)) > 0),
    CHECK (suggested_shell IN ('powershell', 'cmd', 'bash', 'sh', 'zsh', 'other', 'unknown')),
    CHECK (risk_level IN ('low', 'medium', 'high', 'unknown'))
);

CREATE INDEX idx_ai_annotations_command ON ai_annotations(command_id);
"#;

/// The prompt library is a separate domain from the command library. Prompt
/// categories, prompts and the prompt/tag join table are new entities: no
/// existing command, clipboard or AI annotation table is altered or backfilled.
/// `tags` stays shared so both libraries can reuse the same tag vocabulary.
pub const MIGRATION_005: &str = r#"
CREATE TABLE prompt_categories (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT REFERENCES prompt_categories(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    color       TEXT,
    icon_name   TEXT,
    CHECK (length(trim(name)) BETWEEN 1 AND 80),
    CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX idx_prompt_categories_parent
    ON prompt_categories(parent_id, sort_order, name COLLATE NOCASE);
CREATE UNIQUE INDEX idx_prompt_categories_unique_name
    ON prompt_categories(ifnull(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE prompts (
    id                TEXT PRIMARY KEY NOT NULL,
    title             TEXT NOT NULL DEFAULT '',
    content           TEXT NOT NULL,
    category_id       TEXT REFERENCES prompt_categories(id) ON DELETE SET NULL,
    background_color  TEXT,
    is_favorite       INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    sort_order        INTEGER NOT NULL DEFAULT 0,
    use_count         INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    last_used_at      INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    deleted_at        INTEGER,
    CHECK (length(trim(content)) > 0),
    CHECK (length(title) <= 200)
);

CREATE INDEX idx_prompts_active_sort
    ON prompts(deleted_at, category_id, sort_order, updated_at DESC);
CREATE INDEX idx_prompts_last_used
    ON prompts(deleted_at, last_used_at DESC);
CREATE INDEX idx_prompts_favorite
    ON prompts(deleted_at, is_favorite, updated_at DESC);

CREATE TABLE prompt_tags (
    prompt_id   TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (prompt_id, tag_id)
);

CREATE INDEX idx_prompt_tags_tag ON prompt_tags(tag_id, prompt_id);

CREATE VIRTUAL TABLE prompts_fts USING fts5(
    prompt_id UNINDEXED,
    title,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER prompts_fts_insert AFTER INSERT ON prompts BEGIN
    INSERT INTO prompts_fts(prompt_id, title, content)
    VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER prompts_fts_update AFTER UPDATE OF title, content ON prompts BEGIN
    DELETE FROM prompts_fts WHERE prompt_id = old.id;
    INSERT INTO prompts_fts(prompt_id, title, content)
    VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER prompts_fts_delete AFTER DELETE ON prompts BEGIN
    DELETE FROM prompts_fts WHERE prompt_id = old.id;
END;
"#;

pub fn apply_migration(connection: &mut Connection, version: u32) -> rusqlite::Result<()> {
    let transaction = connection.transaction()?;
    match version {
        1 => transaction.execute_batch(MIGRATION_001)?,
        2 => transaction.execute_batch(MIGRATION_002)?,
        3 => transaction.execute_batch(MIGRATION_003)?,
        4 => transaction.execute_batch(MIGRATION_004)?,
        5 => transaction.execute_batch(MIGRATION_005)?,
        _ => {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "unknown database migration {version}"
            )));
        }
    }
    transaction.pragma_update(None, "user_version", version)?;
    transaction.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_sql_is_self_contained() {
        assert!(MIGRATION_001.contains("CREATE VIRTUAL TABLE commands_fts"));
        assert!(!MIGRATION_001.contains("PRAGMA"));
        assert!(MIGRATION_002.contains("clipboard_entries"));
        assert!(MIGRATION_002.contains("source_type"));
        assert!(!MIGRATION_002.contains("PRAGMA"));
        assert!(MIGRATION_003.contains("background_color"));
        assert!(MIGRATION_003.contains("use_category_color"));
        assert!(MIGRATION_003.contains("icon_name"));
        assert!(!MIGRATION_003.contains("PRAGMA"));
        assert!(MIGRATION_004.contains("ai_annotations"));
        assert!(MIGRATION_004.contains("command_content_hash"));
        assert!(MIGRATION_004.contains("ON DELETE CASCADE"));
        assert!(!MIGRATION_004.contains("PRAGMA"));
        assert!(MIGRATION_005.contains("CREATE TABLE prompts"));
        assert!(MIGRATION_005.contains("prompt_categories"));
        assert!(MIGRATION_005.contains("CREATE VIRTUAL TABLE prompts_fts"));
        assert!(MIGRATION_005.contains("prompt_tags"));
        assert!(!MIGRATION_005.contains("PRAGMA"));
    }
}
