use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use thiserror::Error;

use crate::models::settings::{AppSettings, SETTINGS_SCHEMA_VERSION};

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("无法读写设置文件：{0}")]
    Io(#[from] std::io::Error),
    #[error("无法解析设置数据：{0}")]
    Serialize(#[from] serde_json::Error),
}

pub struct SettingsLoadResult {
    pub settings: AppSettings,
    pub warning: Option<String>,
    pub is_first_run: bool,
    pub migrated: bool,
}

/// File-backed settings repository.
///
/// Settings are deliberately kept out of the future command database: window
/// lifecycle needs them before the database layer is available, and they are
/// plain preferences rather than user content.
pub struct SettingsRepository {
    path: PathBuf,
}

impl SettingsRepository {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> SettingsLoadResult {
        if !self.path.exists() {
            return SettingsLoadResult {
                settings: AppSettings::default(),
                warning: None,
                is_first_run: true,
                migrated: false,
            };
        }

        let raw = match fs::read(&self.path) {
            Ok(raw) => raw,
            Err(error) => {
                return SettingsLoadResult {
                    settings: AppSettings::default(),
                    warning: Some(format!(
                        "无法读取设置文件，已使用默认设置。原文件未被修改。（{error}）"
                    )),
                    is_first_run: false,
                    migrated: false,
                };
            }
        };

        let parsed: AppSettings = match serde_json::from_slice(&raw) {
            Ok(parsed) => parsed,
            Err(error) => {
                return SettingsLoadResult {
                    settings: AppSettings::default(),
                    warning: Some(format!(
                        "设置文件格式无法识别，已使用默认设置。原文件不会被自动覆盖。（{error}）"
                    )),
                    is_first_run: false,
                    migrated: false,
                };
            }
        };

        if parsed.schema_version > SETTINGS_SCHEMA_VERSION {
            return SettingsLoadResult {
                settings: AppSettings::default(),
                warning: Some(format!(
                    "设置文件版本（{}）高于当前应用支持的版本（{}），已使用默认设置。原文件会在首次保存前备份。",
                    parsed.schema_version, SETTINGS_SCHEMA_VERSION
                )),
                is_first_run: false,
                migrated: false,
            };
        }

        let mut settings = parsed;
        let migrated = settings.schema_version < SETTINGS_SCHEMA_VERSION;
        if migrated {
            settings.migrate();
        } else {
            settings.sanitize();
        }
        SettingsLoadResult {
            settings,
            warning: None,
            is_first_run: false,
            migrated,
        }
    }

    /// Write through a same-directory temporary file so a crash cannot leave a
    /// half-written settings file. On Windows, `rename` replaces an existing
    /// destination atomically.
    pub fn save(&self, settings: &AppSettings) -> Result<(), SettingsError> {
        let parent = self.path.parent().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "settings path has no parent directory",
            )
        })?;
        fs::create_dir_all(parent)?;

        self.backup_unreadable_file(parent)?;

        let temp_path = self.path.with_extension("json.tmp");
        let payload = serde_json::to_vec_pretty(settings)?;

        {
            let mut file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&temp_path)?;
            file.write_all(&payload)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
        }

        fs::rename(&temp_path, &self.path)?;
        Ok(())
    }

    fn backup_unreadable_file(&self, parent: &Path) -> Result<(), SettingsError> {
        if !self.path.exists() {
            return Ok(());
        }

        let raw = fs::read(&self.path)?;
        let parse_result = serde_json::from_slice::<AppSettings>(&raw);
        let is_current_or_migratable = parse_result
            .as_ref()
            .map(|settings| settings.schema_version <= SETTINGS_SCHEMA_VERSION)
            .unwrap_or(false);

        if is_current_or_migratable {
            return Ok(());
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let backup = parent.join(format!("settings.json.backup-{stamp}"));
        fs::copy(&self.path, backup)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::settings::{ThemePreference, WindowBounds, WindowLayouts};

    fn repository() -> (tempfile::TempDir, SettingsRepository) {
        let temp = tempfile::tempdir().expect("temp dir");
        let repo = SettingsRepository::new(temp.path().join("settings.json"));
        (temp, repo)
    }

    #[test]
    fn missing_file_is_a_first_run() {
        let (_temp, repo) = repository();
        let loaded = repo.load();
        assert!(loaded.is_first_run);
        assert!(!loaded.migrated);
        assert!(loaded.warning.is_none());
        assert_eq!(loaded.settings, AppSettings::default());
    }

    #[test]
    fn settings_round_trip_preserves_preferences_and_layouts() {
        let (_temp, repo) = repository();
        let settings = AppSettings {
            theme: ThemePreference::Dark,
            auto_hide_quick_panel: false,
            launch_at_startup: true,
            last_mode: crate::models::settings::UiMode::Quick,
            window_layouts: WindowLayouts {
                quick: Some(WindowBounds {
                    x: -1200,
                    y: 120,
                    width: 800,
                    height: 580,
                }),
                manager: Some(WindowBounds {
                    x: 120,
                    y: 80,
                    width: 1240,
                    height: 820,
                }),
            },
            ..AppSettings::default()
        };

        repo.save(&settings).expect("save");
        let loaded = repo.load();
        assert!(loaded.warning.is_none());
        assert!(!loaded.is_first_run);
        assert!(!loaded.migrated);
        assert_eq!(loaded.settings, settings);

        let persisted = fs::read_to_string(repo.path()).expect("read settings");
        assert!(persisted.ends_with('\n'));
        assert!(persisted.contains("\"schemaVersion\": 5"));
    }

    #[test]
    fn corrupt_file_is_preserved_and_not_overwritten_on_load() {
        let (_temp, repo) = repository();
        fs::write(repo.path(), "{ definitely not json").expect("write corrupt file");
        let original = fs::read(repo.path()).expect("read corrupt file");

        let loaded = repo.load();
        assert!(loaded.warning.is_some());
        assert_eq!(fs::read(repo.path()).expect("file remains"), original);

        repo.save(&AppSettings::default())
            .expect("save replacement");
        let backups = fs::read_dir(repo.path().parent().unwrap())
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.json.backup-")
            })
            .count();
        assert_eq!(
            backups, 1,
            "corrupt settings should be backed up before replacement"
        );
    }

    #[test]
    fn future_schema_is_reported_as_incompatible() {
        let (_temp, repo) = repository();
        let raw = r#"{"schemaVersion":99,"shortcut":"Ctrl+Shift+V"}"#;
        fs::write(repo.path(), raw).expect("write future settings");

        let loaded = repo.load();
        assert!(loaded.warning.is_some());
        assert_eq!(loaded.settings, AppSettings::default());
    }

    #[test]
    fn invalid_saved_bounds_are_discarded() {
        let (_temp, repo) = repository();
        let raw = r#"{
          "schemaVersion": 3,
          "windowLayouts": {
            "quick": { "x": 0, "y": 0, "width": 10, "height": 10 },
            "manager": { "x": 20, "y": 20, "width": 900, "height": 650 }
          }
        }"#;
        fs::write(repo.path(), raw).expect("write settings");

        let loaded = repo.load();
        assert!(loaded.settings.window_layouts.quick.is_none());
        assert!(loaded.settings.window_layouts.manager.is_some());
    }

    #[test]
    fn schema_one_migrates_and_resets_stale_window_layouts() {
        let (_temp, repo) = repository();
        let raw = r#"{
          "schemaVersion": 1,
          "shortcut": "Ctrl+Alt+P",
          "theme": "dark",
          "windowLayouts": {
            "quick": { "x": 20, "y": 20, "width": 800, "height": 580 },
            "manager": { "x": 20, "y": 20, "width": 1240, "height": 820 }
          }
        }"#;
        fs::write(repo.path(), raw).expect("write legacy settings");

        let loaded = repo.load();
        assert!(loaded.migrated);
        assert_eq!(loaded.settings.schema_version, 5);
        assert_eq!(loaded.settings.shortcut, "Ctrl+Alt+P");
        assert_eq!(loaded.settings.theme, ThemePreference::Dark);
        assert!(loaded.settings.window_layouts.quick.is_none());
        assert!(loaded.settings.window_layouts.manager.is_none());
        assert!(loaded.settings.clipboard_monitoring_enabled);
        assert_eq!(loaded.settings.clipboard_history_limit, 100);
        assert!(loaded.settings.custom_colors.is_empty());
        assert_eq!(
            loaded.settings.ai_base_url,
            crate::models::ai::AI_DEFAULT_BASE_URL
        );
        assert!(!loaded.settings.ai_auto_annotation);
    }

    #[test]
    fn schema_two_preserves_layouts_and_adds_clipboard_defaults() {
        let (_temp, repo) = repository();
        let raw = r#"{
          "schemaVersion": 2,
          "shortcut": "Ctrl+Alt+P",
          "theme": "dark",
          "windowLayouts": {
            "quick": { "x": 20, "y": 20, "width": 460, "height": 560 },
            "manager": { "x": 20, "y": 20, "width": 900, "height": 650 }
          }
        }"#;
        fs::write(repo.path(), raw).expect("write schema 2 settings");

        let loaded = repo.load();
        assert!(loaded.migrated);
        assert_eq!(loaded.settings.schema_version, 5);
        assert_eq!(loaded.settings.shortcut, "Ctrl+Alt+P");
        assert!(loaded.settings.window_layouts.quick.is_some());
        assert!(loaded.settings.window_layouts.manager.is_some());
        assert!(loaded.settings.clipboard_monitoring_enabled);
        assert_eq!(loaded.settings.clipboard_history_limit, 100);
        assert_eq!(loaded.settings.clipboard_history_retention_days, 7);
        assert!(!loaded.settings.hide_quick_panel_after_copy);
        assert!(loaded.settings.custom_colors.is_empty());
    }

    #[test]
    fn schema_three_to_four_preserves_clipboard_preferences_and_palette() {
        let (_temp, repo) = repository();
        let raw = r##"{
          "schemaVersion": 3,
          "shortcut": "Ctrl+Alt+P",
          "clipboardMonitoringEnabled": false,
          "clipboardHistoryLimit": 250,
          "clipboardHistoryRetentionDays": 14,
          "hideQuickPanelAfterCopy": true,
          "customColors": ["#edf3fc", "#EDF3FC", "invalid", "#fceef0"]
        }"##;
        fs::write(repo.path(), raw).expect("write schema 3 settings");

        let loaded = repo.load();
        assert!(loaded.migrated);
        assert_eq!(loaded.settings.schema_version, 5);
        assert!(!loaded.settings.clipboard_monitoring_enabled);
        assert_eq!(loaded.settings.clipboard_history_limit, 250);
        assert_eq!(loaded.settings.clipboard_history_retention_days, 14);
        assert!(loaded.settings.hide_quick_panel_after_copy);
        assert_eq!(
            loaded.settings.custom_colors,
            vec!["#EDF3FC".to_owned(), "#FCEEF0".to_owned()]
        );
        assert_eq!(loaded.settings.ai_timeout_seconds, 30);
        assert!(loaded.settings.ai_temperature.is_none());
        assert!(!loaded.settings.ai_auto_annotation);
    }

    #[test]
    fn schema_four_ai_config_migrates_without_losing_existing_fields() {
        let (_temp, repo) = repository();
        let raw = r##"{
          "schemaVersion": 4,
          "shortcut": "Ctrl+Alt+P",
          "theme": "dark",
          "clipboardMonitoringEnabled": false,
          "customColors": ["#EDF3FC"],
          "aiProvider": "openai",
          "aiBaseUrl": "https://api.openai.com/v1",
          "aiModel": "gpt-4.1-mini",
          "aiTimeoutSeconds": 45,
          "aiTemperature": 0.3,
          "aiAutoAnnotation": true
        }"##;
        fs::write(repo.path(), raw).expect("write schema 4 settings");

        let loaded = repo.load();
        assert!(loaded.migrated);
        assert_eq!(loaded.settings.schema_version, 5);
        assert_eq!(loaded.settings.theme, ThemePreference::Dark);
        assert!(!loaded.settings.clipboard_monitoring_enabled);
        assert_eq!(loaded.settings.ai_provider, "openai");
        assert_eq!(loaded.settings.ai_model, "gpt-4.1-mini");
        assert_eq!(loaded.settings.ai_timeout_seconds, 45);
        assert_eq!(loaded.settings.ai_temperature, Some(0.3));
        assert!(loaded.settings.ai_auto_annotation);
        repo.save(&loaded.settings)
            .expect("persist migrated settings");
        let persisted = fs::read_to_string(repo.path()).expect("settings");
        assert!(!persisted.contains("apiKey"));
        assert!(!persisted.contains("api_key"));
        assert!(!persisted.contains("sk-"));
    }
}
