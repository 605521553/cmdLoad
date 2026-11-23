//! Shared appearance validation rules.
//!
//! The frontend owns the visual tokens (macaron presets, light/dark
//! adaptation), while Rust owns the persistence contract: only canonical
//! `#RRGGBB` colors and icons from this allow-list reach SQLite.

/// Lucide icon identifiers that a category may store.
///
/// Keep this list in sync with `src/features/appearance/categoryIcons.tsx`.
/// Unknown values are stored as `NULL` so a future downgrade or an import from
/// a newer version still renders the neutral folder icon.
pub const CATEGORY_ICON_NAMES: [&str; 26] = [
    "folder",
    "folder-open",
    "terminal",
    "code",
    "database",
    "server",
    "container",
    "git-branch",
    "network",
    "cloud",
    "settings",
    "package",
    "file-code",
    "workflow",
    "monitor",
    "hard-drive",
    "box",
    "boxes",
    "globe",
    "cpu",
    "layers",
    "shield",
    "book-open",
    "wrench",
    "bug",
    "rocket",
];

/// Normalize a user-supplied hex color to canonical `#RRGGBB`.
///
/// Accepts `#RGB`, `RGB`, `#RRGGBB` and `RRGGBB` (case insensitive). Alpha
/// values are intentionally rejected because command backgrounds and folder
/// icons are rendered through opaque theme tokens.
pub fn normalize_hex_color(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let digits = trimmed.strip_prefix('#').unwrap_or(trimmed);
    let expanded = match digits.len() {
        3 => {
            let mut value = String::with_capacity(6);
            for character in digits.chars() {
                value.push(character);
                value.push(character);
            }
            value
        }
        6 => digits.to_owned(),
        _ => return None,
    };
    if !expanded
        .chars()
        .all(|character| character.is_ascii_hexdigit())
    {
        return None;
    }
    Some(format!("#{}", expanded.to_ascii_uppercase()))
}

/// Normalize a category icon name to the canonical lowercase identifier.
pub fn normalize_category_icon(input: &str) -> Option<String> {
    let value = input.trim().to_ascii_lowercase();
    if CATEGORY_ICON_NAMES.contains(&value.as_str()) {
        Some(value)
    } else {
        None
    }
}

/// Colors are optional; an explicitly provided invalid color is an error,
/// while an empty string is treated as "no custom color".
pub fn normalize_optional_color(input: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = input else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    normalize_hex_color(raw)
        .map(Some)
        .ok_or_else(|| "颜色需为 #RRGGBB 或 #RGB 格式的十六进制值。".to_owned())
}

/// Icons are optional; an explicitly provided unknown icon is an error for
/// interactive writes. Imports sanitize unknown values to `None` instead.
pub fn normalize_optional_icon(input: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = input else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    normalize_category_icon(raw)
        .map(Some)
        .ok_or_else(|| "该图标不在可用的图标集合中。".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_colors_are_normalized_to_canonical_form() {
        assert_eq!(normalize_hex_color("#edf3fc").as_deref(), Some("#EDF3FC"));
        assert_eq!(normalize_hex_color("FCEEF0").as_deref(), Some("#FCEEF0"));
        assert_eq!(normalize_hex_color("#abc").as_deref(), Some("#AABBCC"));
        assert_eq!(
            normalize_hex_color("  #FFF8E8  ").as_deref(),
            Some("#FFF8E8")
        );
    }

    #[test]
    fn invalid_hex_colors_are_rejected() {
        for value in [
            "", "#", "#12", "#1234", "#12345", "#1234567", "#GGGGGG", "red", "#FFF\0",
        ] {
            assert!(
                normalize_hex_color(value).is_none(),
                "{value:?} should be rejected"
            );
        }
        assert_eq!(normalize_optional_color(Some("  ")).unwrap(), None);
        assert!(normalize_optional_color(Some("nope")).is_err());
    }

    #[test]
    fn icons_are_restricted_to_the_allow_list() {
        assert_eq!(
            normalize_category_icon("Git-Branch").as_deref(),
            Some("git-branch")
        );
        assert_eq!(normalize_category_icon("folder").as_deref(), Some("folder"));
        assert!(normalize_category_icon("coffee").is_none());
        assert!(normalize_optional_icon(Some("coffee")).is_err());
        assert_eq!(normalize_optional_icon(None).unwrap(), None);
        assert_eq!(normalize_optional_icon(Some("")).unwrap(), None);
    }
}
