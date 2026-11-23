use serde::Serialize;

use crate::services::{
    ai::AiError, hotkey::HotkeyError, library::LibraryError, prompts::PromptError,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn settings(error: impl std::fmt::Display) -> Self {
        Self::new("SETTINGS_ERROR", error.to_string())
    }

    pub fn window(error: impl std::fmt::Display) -> Self {
        Self::new("WINDOW_ERROR", error.to_string())
    }

    pub fn hotkey(error: HotkeyError) -> Self {
        match error {
            HotkeyError::Invalid(message) => Self::new("HOTKEY_INVALID", message),
            HotkeyError::Unavailable => Self::new(
                "HOTKEY_CONFLICT",
                "无法注册该快捷键，它可能已被系统或其他程序占用。原快捷键已保留，请换一个组合。",
            ),
            HotkeyError::Unregister(message) => Self::new("HOTKEY_UNREGISTER_FAILED", message),
        }
    }

    pub fn autostart(error: impl std::fmt::Display) -> Self {
        Self::new("AUTOSTART_ERROR", error.to_string())
    }

    pub fn library(error: LibraryError) -> Self {
        let code = match &error {
            LibraryError::Validation(_) => "COMMAND_VALIDATION",
            LibraryError::NotFound => "COMMAND_NOT_FOUND",
            LibraryError::Conflict(_) => "COMMAND_CONFLICT",
            LibraryError::Clipboard(_) => "CLIPBOARD_ERROR",
            LibraryError::SensitiveContent => "SENSITIVE_CONTENT",
            LibraryError::Database(_) | LibraryError::Sqlite(_) => "DATABASE_ERROR",
            LibraryError::Io(_) => "FILE_ERROR",
            LibraryError::Json(_) => "IMPORT_FORMAT_ERROR",
            LibraryError::Internal(_) => "COMMAND_INTERNAL_ERROR",
        };
        Self::new(code, error.to_string())
    }

    pub fn prompts(error: PromptError) -> Self {
        let code = match &error {
            PromptError::Validation(_) => "PROMPT_VALIDATION",
            PromptError::NotFound => "PROMPT_NOT_FOUND",
            PromptError::Conflict(_) => "PROMPT_CONFLICT",
            PromptError::Clipboard(_) => "CLIPBOARD_ERROR",
            PromptError::SensitiveContent => "SENSITIVE_CONTENT",
            PromptError::Database(_) | PromptError::Sqlite(_) => "DATABASE_ERROR",
            PromptError::Internal(_) => "PROMPT_INTERNAL_ERROR",
        };
        Self::new(code, error.to_string())
    }

    pub fn ai(error: AiError) -> Self {
        let code = match &error {
            AiError::NotConfigured(_) | AiError::InvalidConfig(_) => "AI_NOT_CONFIGURED",
            AiError::Timeout(_) => "AI_TIMEOUT",
            AiError::Network(_) => "AI_NETWORK_ERROR",
            AiError::Http(_) => "AI_HTTP_ERROR",
            AiError::Unauthorized(_) => "AI_UNAUTHORIZED",
            AiError::EndpointNotFound => "AI_ENDPOINT_NOT_FOUND",
            AiError::RateLimited(_) => "AI_RATE_LIMITED",
            AiError::BadRequest(_) => "AI_BAD_REQUEST",
            AiError::InvalidResponse | AiError::InvalidJson => "AI_INVALID_RESPONSE",
            AiError::EmptyAnnotation => "AI_EMPTY_RESPONSE",
            AiError::SensitiveBlocked => "AI_SENSITIVE_BLOCKED",
            AiError::StaleCommand => "AI_STALE_COMMAND",
            AiError::CommandNotFound => "COMMAND_NOT_FOUND",
            AiError::Cancelled => "AI_CANCELLED",
            AiError::Busy => "AI_BUSY",
            AiError::InvalidInput(_) => "AI_VALIDATION",
            AiError::Database(_) => "DATABASE_ERROR",
            AiError::Credential(_) => "AI_CREDENTIAL_ERROR",
        };
        Self::new(code, error.to_string())
    }
}
