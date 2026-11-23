use std::str::FromStr;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HotkeyError {
    #[error("{0}")]
    Invalid(String),
    #[error("无法注册全局快捷键，可能已被系统或其他程序占用。请换一个组合后重试。")]
    Unavailable,
    #[error("无法移除旧快捷键：{0}")]
    Unregister(String),
}

#[derive(Debug, Clone)]
pub struct ShortcutSpec {
    pub display: String,
    pub shortcut: Shortcut,
}

/// Validate, normalize and describe a user-provided shortcut.
///
/// Supported keys mirror the UI recorder: letters, digits, F1-F24 and common
/// navigation keys. Requiring Control/Alt/Super avoids stealing everyday
/// single-key typing from other applications.
pub fn normalize_shortcut(input: &str) -> Result<ShortcutSpec, HotkeyError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(HotkeyError::Invalid("快捷键不能为空。".to_owned()));
    }

    let shortcut = Shortcut::from_str(trimmed).map_err(|_| {
        HotkeyError::Invalid("快捷键格式无效，请使用类似 Ctrl+Shift+V 的组合。".to_owned())
    })?;

    let required = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER;
    if !shortcut.mods.intersects(required) {
        return Err(HotkeyError::Invalid(
            "快捷键必须包含 Ctrl、Alt 或 Win 键。".to_owned(),
        ));
    }

    let key = key_code_label(shortcut.key).ok_or_else(|| {
        HotkeyError::Invalid("暂不支持这个按键。请使用字母、数字、F1–F24 或常用功能键。".to_owned())
    })?;

    let mut parts = Vec::new();
    if shortcut.mods.contains(Modifiers::CONTROL) {
        parts.push("Ctrl".to_owned());
    }
    if shortcut.mods.contains(Modifiers::ALT) {
        parts.push("Alt".to_owned());
    }
    if shortcut.mods.contains(Modifiers::SHIFT) {
        parts.push("Shift".to_owned());
    }
    if shortcut.mods.contains(Modifiers::SUPER) {
        parts.push("Super".to_owned());
    }
    parts.push(key);

    Ok(ShortcutSpec {
        display: parts.join("+"),
        shortcut,
    })
}

pub fn register(app: &AppHandle, spec: &ShortcutSpec) -> Result<(), HotkeyError> {
    app.global_shortcut()
        .register(spec.shortcut)
        .map_err(|_| HotkeyError::Unavailable)
}

pub fn unregister(app: &AppHandle, spec: &ShortcutSpec) -> Result<(), HotkeyError> {
    app.global_shortcut()
        .unregister(spec.shortcut)
        .map_err(|error| HotkeyError::Unregister(error.to_string()))
}

fn key_code_label(code: Code) -> Option<String> {
    use Code::*;

    let label = match code {
        KeyA => "A",
        KeyB => "B",
        KeyC => "C",
        KeyD => "D",
        KeyE => "E",
        KeyF => "F",
        KeyG => "G",
        KeyH => "H",
        KeyI => "I",
        KeyJ => "J",
        KeyK => "K",
        KeyL => "L",
        KeyM => "M",
        KeyN => "N",
        KeyO => "O",
        KeyP => "P",
        KeyQ => "Q",
        KeyR => "R",
        KeyS => "S",
        KeyT => "T",
        KeyU => "U",
        KeyV => "V",
        KeyW => "W",
        KeyX => "X",
        KeyY => "Y",
        KeyZ => "Z",
        Digit0 => "0",
        Digit1 => "1",
        Digit2 => "2",
        Digit3 => "3",
        Digit4 => "4",
        Digit5 => "5",
        Digit6 => "6",
        Digit7 => "7",
        Digit8 => "8",
        Digit9 => "9",
        F1 => "F1",
        F2 => "F2",
        F3 => "F3",
        F4 => "F4",
        F5 => "F5",
        F6 => "F6",
        F7 => "F7",
        F8 => "F8",
        F9 => "F9",
        F10 => "F10",
        F11 => "F11",
        F12 => "F12",
        F13 => "F13",
        F14 => "F14",
        F15 => "F15",
        F16 => "F16",
        F17 => "F17",
        F18 => "F18",
        F19 => "F19",
        F20 => "F20",
        F21 => "F21",
        F22 => "F22",
        F23 => "F23",
        F24 => "F24",
        Space => "Space",
        Enter => "Enter",
        Tab => "Tab",
        Backspace => "Backspace",
        Delete => "Delete",
        Insert => "Insert",
        Home => "Home",
        End => "End",
        PageUp => "PageUp",
        PageDown => "PageDown",
        ArrowUp => "Up",
        ArrowDown => "Down",
        ArrowLeft => "Left",
        ArrowRight => "Right",
        _ => return None,
    };

    Some(label.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_is_valid_and_canonical() {
        let spec = normalize_shortcut("Ctrl+Shift+V").expect("default shortcut must be valid");
        assert_eq!(spec.display, "Ctrl+Shift+V");
        assert_eq!(spec.shortcut.key, Code::KeyV);
    }

    #[test]
    fn modifier_aliases_and_spacing_are_normalized() {
        let spec = normalize_shortcut(" control + SHIFT + v ").expect("aliases should be accepted");
        assert_eq!(spec.display, "Ctrl+Shift+V");
    }

    #[test]
    fn a_modifier_anchor_is_required() {
        let error = normalize_shortcut("Shift+V").expect_err("shift-only must be rejected");
        assert!(matches!(error, HotkeyError::Invalid(_)));
    }

    #[test]
    fn invalid_strings_are_rejected_with_a_readable_message() {
        let error = normalize_shortcut("Ctrl+Shift+NotAKey").expect_err("unknown key");
        assert!(error.to_string().contains("格式无效"));
    }

    #[test]
    fn navigation_and_function_keys_are_supported() {
        assert_eq!(
            normalize_shortcut("Ctrl+Alt+Up").unwrap().display,
            "Ctrl+Alt+Up"
        );
        assert_eq!(normalize_shortcut("Ctrl+F24").unwrap().display, "Ctrl+F24");
    }

    #[test]
    fn unsupported_symbol_keys_are_rejected() {
        let error = normalize_shortcut("Ctrl+Shift+Semicolon").expect_err("unsupported key");
        assert!(error.to_string().contains("暂不支持"));
    }

    #[test]
    fn shortcut_with_only_modifiers_is_invalid() {
        assert!(normalize_shortcut("Ctrl+Shift").is_err());
    }
}
