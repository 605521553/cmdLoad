use serde::{Deserialize, Serialize};

use crate::models::{
    ai::{
        AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, AI_DEFAULT_PROVIDER, AI_DEFAULT_TIMEOUT_SECONDS,
        AI_MAX_TIMEOUT_SECONDS, AI_MIN_TIMEOUT_SECONDS,
    },
    appearance::normalize_hex_color,
};

/// Schema 5 adds the OpenAI-compatible AI service preferences. The API key is
/// deliberately absent: it lives in Windows Credential Manager.
pub const SETTINGS_SCHEMA_VERSION: u32 = 5;

/// Keep the personal palette compact; the UI intentionally stays lightweight.
pub const MAX_CUSTOM_COLORS: usize = 24;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiMode {
    Quick,
    #[default]
    Manager,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowBounds {
    fn is_usable(self) -> bool {
        (320..=10_000).contains(&self.width) && (240..=10_000).contains(&self.height)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowLayouts {
    pub quick: Option<WindowBounds>,
    pub manager: Option<WindowBounds>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: u32,
    pub shortcut: String,
    pub launch_at_startup: bool,
    pub auto_hide_quick_panel: bool,
    pub theme: ThemePreference,
    pub last_mode: UiMode,
    pub sidebar_width: u32,
    pub clipboard_monitoring_enabled: bool,
    pub clipboard_history_limit: u32,
    pub clipboard_history_retention_days: u32,
    pub hide_quick_panel_after_copy: bool,
    pub custom_colors: Vec<String>,
    pub ai_provider: String,
    pub ai_base_url: String,
    pub ai_model: String,
    pub ai_timeout_seconds: u32,
    pub ai_temperature: Option<f32>,
    pub ai_auto_annotation: bool,
    pub window_layouts: WindowLayouts,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            shortcut: "Ctrl+Shift+V".to_owned(),
            launch_at_startup: false,
            auto_hide_quick_panel: true,
            theme: ThemePreference::System,
            last_mode: UiMode::Manager,
            sidebar_width: 172,
            clipboard_monitoring_enabled: true,
            clipboard_history_limit: 100,
            clipboard_history_retention_days: 7,
            hide_quick_panel_after_copy: false,
            custom_colors: Vec::new(),
            ai_provider: AI_DEFAULT_PROVIDER.to_owned(),
            ai_base_url: AI_DEFAULT_BASE_URL.to_owned(),
            ai_model: AI_DEFAULT_MODEL.to_owned(),
            ai_timeout_seconds: AI_DEFAULT_TIMEOUT_SECONDS,
            ai_temperature: None,
            ai_auto_annotation: false,
            window_layouts: WindowLayouts::default(),
        }
    }
}

impl AppSettings {
    /// Drop malformed geometry while keeping every other user preference.
    pub fn sanitize(&mut self) {
        if !self
            .window_layouts
            .quick
            .map(WindowBounds::is_usable)
            .unwrap_or(true)
        {
            self.window_layouts.quick = None;
        }
        if !self
            .window_layouts
            .manager
            .map(WindowBounds::is_usable)
            .unwrap_or(true)
        {
            self.window_layouts.manager = None;
        }
        if self.shortcut.trim().is_empty() {
            self.shortcut = AppSettings::default().shortcut;
        }
        self.sidebar_width = self.sidebar_width.clamp(160, 260);
        self.clipboard_history_limit = self.clipboard_history_limit.clamp(10, 500);
        self.clipboard_history_retention_days = self.clipboard_history_retention_days.clamp(1, 365);
        self.custom_colors = normalize_custom_colors(&self.custom_colors);
        self.ai_provider = if self.ai_provider.trim().is_empty() {
            AI_DEFAULT_PROVIDER.to_owned()
        } else {
            self.ai_provider.trim().to_lowercase()
        };
        self.ai_base_url = self.ai_base_url.trim().trim_end_matches('/').to_owned();
        if self.ai_base_url.is_empty() {
            self.ai_base_url = AI_DEFAULT_BASE_URL.to_owned();
        }
        self.ai_model = self.ai_model.trim().to_owned();
        if self.ai_model.is_empty() {
            self.ai_model = AI_DEFAULT_MODEL.to_owned();
        }
        self.ai_timeout_seconds = self
            .ai_timeout_seconds
            .clamp(AI_MIN_TIMEOUT_SECONDS, AI_MAX_TIMEOUT_SECONDS);
        self.ai_temperature = self
            .ai_temperature
            .filter(|value| value.is_finite() && (0.0..=2.0).contains(value));
        self.schema_version = SETTINGS_SCHEMA_VERSION;
    }

    /// Upgrade older settings in memory. Schema 1 stale window geometry is
    /// reset once after the compact redesign; later schemas only add fields and
    /// preserve layouts/preferences.
    pub fn migrate(&mut self) {
        if self.schema_version < 2 {
            self.window_layouts = WindowLayouts::default();
        }
        self.schema_version = SETTINGS_SCHEMA_VERSION;
        self.sanitize();
    }

    pub fn view(&self) -> SettingsView {
        SettingsView {
            shortcut: self.shortcut.clone(),
            launch_at_startup: self.launch_at_startup,
            auto_hide_quick_panel: self.auto_hide_quick_panel,
            theme: self.theme,
            sidebar_width: self.sidebar_width,
            clipboard_monitoring_enabled: self.clipboard_monitoring_enabled,
            clipboard_history_limit: self.clipboard_history_limit,
            clipboard_history_retention_days: self.clipboard_history_retention_days,
            hide_quick_panel_after_copy: self.hide_quick_panel_after_copy,
            custom_colors: self.custom_colors.clone(),
            ai_provider: self.ai_provider.clone(),
            ai_base_url: self.ai_base_url.clone(),
            ai_model: self.ai_model.clone(),
            ai_timeout_seconds: self.ai_timeout_seconds,
            ai_temperature: self.ai_temperature,
            ai_auto_annotation: self.ai_auto_annotation,
        }
    }

    pub fn bounds_for(&self, mode: UiMode) -> Option<WindowBounds> {
        match mode {
            UiMode::Quick => self.window_layouts.quick,
            UiMode::Manager => self.window_layouts.manager,
        }
    }

    pub fn set_bounds_for(&mut self, mode: UiMode, bounds: Option<WindowBounds>) {
        match mode {
            UiMode::Quick => self.window_layouts.quick = bounds,
            UiMode::Manager => self.window_layouts.manager = bounds,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub shortcut: String,
    pub launch_at_startup: bool,
    pub auto_hide_quick_panel: bool,
    pub theme: ThemePreference,
    pub sidebar_width: u32,
    pub clipboard_monitoring_enabled: bool,
    pub clipboard_history_limit: u32,
    pub clipboard_history_retention_days: u32,
    pub hide_quick_panel_after_copy: bool,
    pub custom_colors: Vec<String>,
    pub ai_provider: String,
    pub ai_base_url: String,
    pub ai_model: String,
    pub ai_timeout_seconds: u32,
    pub ai_temperature: Option<f32>,
    pub ai_auto_annotation: bool,
}

/// Canonicalize the personal palette: valid `#RRGGBB`, unique, capped.
///
/// Invalid entries (from a hand-edited settings file) are dropped instead of
/// failing the whole settings load.
pub fn normalize_custom_colors(colors: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in colors {
        let Some(color) = normalize_hex_color(value) else {
            continue;
        };
        if !normalized.contains(&color) {
            normalized.push(color);
        }
        if normalized.len() >= MAX_CUSTOM_COLORS {
            break;
        }
    }
    normalized
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub shortcut: Option<String>,
    pub launch_at_startup: Option<bool>,
    pub auto_hide_quick_panel: Option<bool>,
    pub theme: Option<ThemePreference>,
    pub sidebar_width: Option<u32>,
    pub clipboard_monitoring_enabled: Option<bool>,
    pub clipboard_history_limit: Option<u32>,
    pub clipboard_history_retention_days: Option<u32>,
    pub hide_quick_panel_after_copy: Option<bool>,
    pub custom_colors: Option<Vec<String>>,
    pub ai_provider: Option<String>,
    pub ai_base_url: Option<String>,
    pub ai_model: Option<String>,
    pub ai_timeout_seconds: Option<u32>,
    pub ai_temperature: Option<f32>,
    pub clear_ai_temperature: Option<bool>,
    pub ai_auto_annotation: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_product_contract() {
        let settings = AppSettings::default();
        assert_eq!(settings.schema_version, SETTINGS_SCHEMA_VERSION);
        assert_eq!(settings.shortcut, "Ctrl+Shift+V");
        assert!(settings.auto_hide_quick_panel);
        assert!(!settings.launch_at_startup);
        assert_eq!(settings.last_mode, UiMode::Manager);
        assert_eq!(settings.sidebar_width, 172);
        assert!(settings.clipboard_monitoring_enabled);
        assert_eq!(settings.clipboard_history_limit, 100);
        assert_eq!(settings.clipboard_history_retention_days, 7);
        assert!(!settings.hide_quick_panel_after_copy);
        assert!(settings.custom_colors.is_empty());
        assert_eq!(settings.ai_provider, AI_DEFAULT_PROVIDER);
        assert_eq!(settings.ai_base_url, AI_DEFAULT_BASE_URL);
        assert_eq!(settings.ai_model, AI_DEFAULT_MODEL);
        assert_eq!(settings.ai_timeout_seconds, 30);
        assert_eq!(settings.ai_temperature, None);
        assert!(!settings.ai_auto_annotation);
    }

    #[test]
    fn ai_preferences_are_sanitized_without_touching_other_fields() {
        let mut settings = AppSettings {
            theme: ThemePreference::Dark,
            ai_base_url: "  https://example.com/v1/  ".to_owned(),
            ai_model: "  custom-model  ".to_owned(),
            ai_timeout_seconds: 500,
            ai_temperature: Some(9.0),
            ..AppSettings::default()
        };
        settings.sanitize();
        assert_eq!(settings.theme, ThemePreference::Dark);
        assert_eq!(settings.ai_base_url, "https://example.com/v1");
        assert_eq!(settings.ai_model, "custom-model");
        assert_eq!(settings.ai_timeout_seconds, AI_MAX_TIMEOUT_SECONDS);
        assert_eq!(settings.ai_temperature, None);

        settings.ai_timeout_seconds = 1;
        settings.ai_temperature = Some(f32::NAN);
        settings.sanitize();
        assert_eq!(settings.ai_timeout_seconds, AI_MIN_TIMEOUT_SECONDS);
        assert_eq!(settings.ai_temperature, None);
    }

    #[test]
    fn personal_palette_is_normalized_deduplicated_and_capped() {
        let colors = vec![
            "#edf3fc".to_owned(),
            "#EDF3FC".to_owned(),
            "nope".to_owned(),
            "abc".to_owned(),
            String::new(),
        ];
        assert_eq!(
            normalize_custom_colors(&colors),
            vec!["#EDF3FC".to_owned(), "#AABBCC".to_owned()]
        );

        let many = (0..40)
            .map(|index| format!("#{:06X}", index))
            .collect::<Vec<_>>();
        assert_eq!(normalize_custom_colors(&many).len(), MAX_CUSTOM_COLORS);
    }

    #[test]
    fn sidebar_width_is_clamped_to_a_safe_range() {
        let mut settings = AppSettings {
            sidebar_width: 999,
            ..AppSettings::default()
        };
        settings.sanitize();
        assert_eq!(settings.sidebar_width, 260);

        settings.sidebar_width = 10;
        settings.sanitize();
        assert_eq!(settings.sidebar_width, 160);

        settings.clipboard_history_limit = 9999;
        settings.clipboard_history_retention_days = 0;
        settings.sanitize();
        assert_eq!(settings.clipboard_history_limit, 500);
        assert_eq!(settings.clipboard_history_retention_days, 1);
    }

    #[test]
    fn malformed_bounds_are_removed_without_touching_preferences() {
        let mut settings = AppSettings {
            theme: ThemePreference::Dark,
            ..AppSettings::default()
        };
        settings.window_layouts.manager = Some(WindowBounds {
            x: 10,
            y: 10,
            width: 10,
            height: 10,
        });

        settings.sanitize();

        assert_eq!(settings.window_layouts.manager, None);
        assert_eq!(settings.theme, ThemePreference::Dark);
    }

    #[test]
    fn deserialization_uses_defaults_for_missing_fields() {
        let parsed: AppSettings = serde_json::from_str("{}").expect("defaults should deserialize");
        assert_eq!(parsed, AppSettings::default());
    }
}
