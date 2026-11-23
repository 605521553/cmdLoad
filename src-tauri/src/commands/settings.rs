use tauri::{AppHandle, State};

use crate::{
    commands::app::build_snapshot,
    error::CommandError,
    models::{
        app::AppSnapshot,
        settings::{normalize_custom_colors, SettingsPatch},
    },
    services::{
        autostart,
        hotkey::{self, ShortcutSpec},
        window as window_service,
    },
    state::{AppState, ShortcutRuntime},
};

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<AppSnapshot, CommandError> {
    let state = state.inner();
    let is_noop = patch.shortcut.is_none()
        && patch.launch_at_startup.is_none()
        && patch.auto_hide_quick_panel.is_none()
        && patch.theme.is_none()
        && patch.sidebar_width.is_none()
        && patch.clipboard_monitoring_enabled.is_none()
        && patch.clipboard_history_limit.is_none()
        && patch.clipboard_history_retention_days.is_none()
        && patch.hide_quick_panel_after_copy.is_none()
        && patch.custom_colors.is_none()
        && patch.ai_provider.is_none()
        && patch.ai_base_url.is_none()
        && patch.ai_model.is_none()
        && patch.ai_timeout_seconds.is_none()
        && patch.ai_temperature.is_none()
        && patch.clear_ai_temperature.is_none()
        && patch.ai_auto_annotation.is_none();
    if is_noop {
        return Ok(build_snapshot(&app, state));
    }

    let _transaction = state.lock_transaction();
    let original_settings = state.settings();
    let original_shortcut = state.shortcut();
    let mut next_settings = original_settings.clone();

    // Validate all new values before changing any native state.
    let new_shortcut = match patch.shortcut.as_deref() {
        Some(value) => {
            let spec = hotkey::normalize_shortcut(value).map_err(CommandError::hotkey)?;
            next_settings.shortcut = spec.display.clone();
            Some(spec)
        }
        None => None,
    };

    if let Some(auto_hide) = patch.auto_hide_quick_panel {
        next_settings.auto_hide_quick_panel = auto_hide;
    }
    if let Some(theme) = patch.theme {
        next_settings.theme = theme;
    }
    if let Some(sidebar_width) = patch.sidebar_width {
        next_settings.sidebar_width = sidebar_width.clamp(160, 260);
    }
    if let Some(enabled) = patch.clipboard_monitoring_enabled {
        next_settings.clipboard_monitoring_enabled = enabled;
    }
    if let Some(limit) = patch.clipboard_history_limit {
        next_settings.clipboard_history_limit = limit.clamp(10, 500);
    }
    if let Some(days) = patch.clipboard_history_retention_days {
        next_settings.clipboard_history_retention_days = days.clamp(1, 365);
    }
    if let Some(hide) = patch.hide_quick_panel_after_copy {
        next_settings.hide_quick_panel_after_copy = hide;
    }
    if let Some(colors) = &patch.custom_colors {
        next_settings.custom_colors = normalize_custom_colors(colors);
    }
    if let Some(provider) = &patch.ai_provider {
        let provider = provider.trim().to_lowercase();
        if provider.is_empty() || provider.chars().count() > 40 {
            return Err(CommandError::new(
                "AI_CONFIG_INVALID",
                "AI 服务商标识无效。",
            ));
        }
        next_settings.ai_provider = provider;
    }
    if let Some(base_url) = &patch.ai_base_url {
        next_settings.ai_base_url = crate::services::ai::validate_base_url(base_url)
            .map_err(|message| CommandError::new("AI_CONFIG_INVALID", message))?;
    }
    if let Some(model) = &patch.ai_model {
        let model = model.trim();
        if model.is_empty() || model.chars().count() > 120 {
            return Err(CommandError::new(
                "AI_CONFIG_INVALID",
                "模型名称需为 1–120 个字符。",
            ));
        }
        next_settings.ai_model = model.to_owned();
    }
    if let Some(timeout) = patch.ai_timeout_seconds {
        next_settings.ai_timeout_seconds = timeout.clamp(5, 120);
    }
    if let Some(temperature) = patch.ai_temperature {
        if !temperature.is_finite() || !(0.0..=2.0).contains(&temperature) {
            return Err(CommandError::new(
                "AI_CONFIG_INVALID",
                "Temperature 需在 0–2 之间，或留空使用服务默认值。",
            ));
        }
        next_settings.ai_temperature = Some(temperature);
    }
    if patch.clear_ai_temperature == Some(true) {
        next_settings.ai_temperature = None;
    }
    if let Some(enabled) = patch.ai_auto_annotation {
        next_settings.ai_auto_annotation = enabled;
    }

    // Autostart is updated through the native manager, not merely written to
    // JSON. Remember the actual prior state so it can be rolled back if a later
    // part of the transaction fails.
    let mut autostart_rolled_back_to: Option<bool> = None;
    if let Some(desired) = patch.launch_at_startup {
        next_settings.launch_at_startup = desired;
        let current = autostart::is_enabled(&app).map_err(CommandError::autostart)?;
        if current != desired {
            autostart::set_enabled(&app, desired).map_err(CommandError::autostart)?;
            autostart_rolled_back_to = Some(current);
        }
    }

    let shortcut_was_applied = if let Some(spec) = &new_shortcut {
        match apply_shortcut_change(&app, state, spec) {
            Ok(applied) => applied,
            Err(error) => {
                if let Some(previous) = autostart_rolled_back_to {
                    restore_autostart(&app, previous);
                }
                return Err(error);
            }
        }
    } else {
        false
    };

    if let Err(error) = state.persist_settings(next_settings.clone()) {
        if shortcut_was_applied {
            if let Some(spec) = &new_shortcut {
                rollback_shortcut(&app, state, &original_shortcut, spec);
            }
        }
        if let Some(previous) = autostart_rolled_back_to {
            restore_autostart(&app, previous);
        }
        return Err(CommandError::settings(error));
    }

    state.set_settings_warning(None);

    if patch.clipboard_history_limit.is_some() || patch.clipboard_history_retention_days.is_some() {
        let _ = crate::services::clipboard::ClipboardHistoryService::new(state.database()).prune(
            next_settings.clipboard_history_limit,
            next_settings.clipboard_history_retention_days,
        );
    }

    if patch.theme.is_some() {
        if let Err(error) = window_service::apply_theme(&app, next_settings.theme) {
            window_service::emit_runtime_error(
                &app,
                format!("主题偏好已保存，但系统标题栏主题未能更新。（{error}）"),
            );
        }
    }

    if new_shortcut.is_some() {
        update_tray_tooltip(&app, &next_settings.shortcut);
    }

    Ok(build_snapshot(&app, state))
}

/// Register the saved shortcut on application startup. A failure is a runtime
/// warning, not a boot failure: the tray and window lifecycle remain usable.
pub fn initialize_shortcut(app: &AppHandle, state: &AppState) {
    let configured = state.settings().shortcut;
    let runtime = match hotkey::normalize_shortcut(&configured) {
        Ok(spec) => match hotkey::register(app, &spec) {
            Ok(()) => ShortcutRuntime {
                registered: true,
                shortcut: Some(spec),
                error: None,
            },
            Err(error) => ShortcutRuntime {
                registered: false,
                shortcut: Some(spec),
                error: Some(error.to_string()),
            },
        },
        Err(error) => ShortcutRuntime {
            registered: false,
            shortcut: None,
            error: Some(error.to_string()),
        },
    };
    state.set_shortcut(runtime);
}

fn apply_shortcut_change(
    app: &AppHandle,
    state: &AppState,
    spec: &ShortcutSpec,
) -> Result<bool, CommandError> {
    let previous = state.shortcut();

    if previous.registered
        && previous
            .shortcut
            .as_ref()
            .map(|current| current.shortcut == spec.shortcut)
            .unwrap_or(false)
    {
        if previous.error.is_some()
            || previous
                .shortcut
                .as_ref()
                .map(|current| current.display != spec.display)
                .unwrap_or(false)
        {
            state.set_shortcut(ShortcutRuntime {
                registered: true,
                shortcut: Some(spec.clone()),
                error: None,
            });
        }
        return Ok(false);
    }

    let had_previous = previous.registered && previous.shortcut.is_some();
    if had_previous {
        let old_spec = previous.shortcut.as_ref().expect("checked above");
        hotkey::unregister(app, old_spec).map_err(CommandError::hotkey)?;
    }

    match hotkey::register(app, spec) {
        Ok(()) => {
            state.set_shortcut(ShortcutRuntime {
                registered: true,
                shortcut: Some(spec.clone()),
                error: None,
            });
            Ok(true)
        }
        Err(_error) => {
            let mut restored = false;
            if had_previous {
                if let Some(old_spec) = &previous.shortcut {
                    restored = hotkey::register(app, old_spec).is_ok();
                }
            }

            let message = if had_previous && restored {
                "新快捷键无法注册，可能已被系统或其他程序占用。已恢复原快捷键。"
            } else if had_previous {
                "新快捷键无法注册，且原快捷键未能恢复。请在设置中重新指定快捷键。"
            } else {
                "快捷键无法注册，可能已被系统或其他程序占用。请换一个组合后重试。"
            };

            state.set_shortcut(ShortcutRuntime {
                registered: restored,
                shortcut: previous.shortcut,
                error: Some(message.to_owned()),
            });
            Err(CommandError::new("HOTKEY_CONFLICT", message))
        }
    }
}

/// Restore the previous native shortcut after a later step of the settings
/// transaction failed.
fn rollback_shortcut(
    app: &AppHandle,
    state: &AppState,
    original: &ShortcutRuntime,
    applied_spec: &ShortcutSpec,
) {
    let current = state.shortcut();
    if current.registered {
        let _ = hotkey::unregister(app, applied_spec);
    }

    let mut runtime = original.clone();
    if original.registered {
        if let Some(old_spec) = &original.shortcut {
            match hotkey::register(app, old_spec) {
                Ok(()) => runtime.error = None,
                Err(error) => {
                    runtime.registered = false;
                    runtime.error = Some(format!(
                        "设置保存失败，且原快捷键未能恢复，请重新设置。（{error}）"
                    ));
                }
            }
        }
    }
    state.set_shortcut(runtime);
}

fn restore_autostart(app: &AppHandle, previous: bool) {
    if let Err(error) = autostart::set_enabled(app, previous) {
        window_service::emit_runtime_error(
            app,
            format!("设置保存失败，且开机自启动状态未能回滚，请手动检查。（{error}）"),
        );
    }
}

fn update_tray_tooltip(app: &AppHandle, shortcut: &str) {
    if let Some(tray) = app.tray_by_id(crate::services::tray::TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("Pata Commands · {shortcut} 呼出")));
    }
}
