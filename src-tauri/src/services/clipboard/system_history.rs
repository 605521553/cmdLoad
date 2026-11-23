use std::collections::HashSet;

use crate::models::clipboard::SystemHistoryStatus;

#[derive(Debug, Clone)]
pub struct SystemHistoryRead {
    pub status: SystemHistoryStatus,
    pub enabled: bool,
    pub items: Vec<SystemHistoryText>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SystemHistoryText {
    pub content: String,
    pub copied_at: i64,
    pub is_sensitive: bool,
}

#[cfg(target_os = "windows")]
pub fn read_system_history() -> SystemHistoryRead {
    use windows::{
        ApplicationModel::DataTransfer::{Clipboard, ClipboardHistoryItemsResultStatus},
        Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
    };

    struct Apartment(bool);
    impl Drop for Apartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let _apartment = Apartment(hr.is_ok());

    let enabled = match Clipboard::IsHistoryEnabled() {
        Ok(enabled) => enabled,
        Err(error) => {
            return SystemHistoryRead {
                status: SystemHistoryStatus::Error,
                enabled: false,
                items: Vec::new(),
                message: Some(format!("无法读取 Windows 剪贴板历史状态：{error}")),
            };
        }
    };
    if !enabled {
        return SystemHistoryRead {
            status: SystemHistoryStatus::Disabled,
            enabled: false,
            items: Vec::new(),
            message: Some(
                "Windows 剪贴板历史未启用。仍可保存当前剪贴板，或使用本地监听历史。".to_owned(),
            ),
        };
    }

    let operation = match Clipboard::GetHistoryItemsAsync() {
        Ok(operation) => operation,
        Err(error) => {
            return SystemHistoryRead {
                status: SystemHistoryStatus::Unsupported,
                enabled: true,
                items: Vec::new(),
                message: Some(format!(
                    "无法启动 Windows 剪贴板历史读取，本地监听历史仍可用：{error}"
                )),
            };
        }
    };
    let result = match tauri::async_runtime::block_on(async { operation.await }) {
        Ok(result) => result,
        Err(error) => {
            return SystemHistoryRead {
                status: SystemHistoryStatus::Error,
                enabled: true,
                items: Vec::new(),
                message: Some(format!("读取 Windows 剪贴板历史失败：{error}")),
            };
        }
    };

    let status = match result.Status() {
        Ok(status) => status,
        Err(error) => {
            return SystemHistoryRead {
                status: SystemHistoryStatus::Error,
                enabled: true,
                items: Vec::new(),
                message: Some(format!("剪贴板历史返回无效状态：{error}")),
            };
        }
    };
    if status != ClipboardHistoryItemsResultStatus::Success {
        let (status, message) =
            if status == ClipboardHistoryItemsResultStatus::ClipboardHistoryDisabled {
                (
                    SystemHistoryStatus::Disabled,
                    "Windows 剪贴板历史已关闭，当前剪贴板和本地历史仍可使用。".to_owned(),
                )
            } else if status == ClipboardHistoryItemsResultStatus::AccessDenied {
                (
                    SystemHistoryStatus::AccessDenied,
                    "Windows 未允许读取剪贴板历史，已回退到本地监听历史。".to_owned(),
                )
            } else {
                (
                    SystemHistoryStatus::Error,
                    "Windows 剪贴板历史返回未知状态，已回退到本地监听历史。".to_owned(),
                )
            };
        return SystemHistoryRead {
            status,
            enabled: true,
            items: Vec::new(),
            message: Some(message),
        };
    }

    let items = match result.Items() {
        Ok(items) => items,
        Err(error) => {
            return SystemHistoryRead {
                status: SystemHistoryStatus::Error,
                enabled: true,
                items: Vec::new(),
                message: Some(format!("无法枚举剪贴板历史：{error}")),
            };
        }
    };

    let count = items.Size().unwrap_or(0).min(100);
    let mut seen = HashSet::new();
    let mut texts = Vec::new();
    for index in 0..count {
        let Ok(item) = items.GetAt(index) else {
            continue;
        };
        let timestamp = item
            .Timestamp()
            .ok()
            .map(|value| windows_filetime_to_unix_millis(value.UniversalTime))
            .unwrap_or(0);
        let text = match tauri::async_runtime::block_on(async {
            let content = item.Content()?;
            content.GetTextAsync()?.await
        }) {
            Ok(text) => text.to_string(),
            Err(_) => continue,
        };
        if text.trim().is_empty() || text.chars().count() > 100_000 {
            continue;
        }
        if !seen.insert(text.clone()) {
            continue;
        }
        texts.push(SystemHistoryText {
            is_sensitive: crate::services::clipboard::is_sensitive_text(&text),
            content: text,
            copied_at: timestamp,
        });
    }

    SystemHistoryRead {
        status: SystemHistoryStatus::Available,
        enabled: true,
        items: texts,
        message: None,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn read_system_history() -> SystemHistoryRead {
    SystemHistoryRead {
        status: SystemHistoryStatus::Unsupported,
        enabled: false,
        items: Vec::new(),
        message: Some("当前平台不支持 Windows 剪贴板历史。".to_owned()),
    }
}

#[cfg(target_os = "windows")]
fn windows_filetime_to_unix_millis(filetime: i64) -> i64 {
    const WINDOWS_TO_UNIX_EPOCH_100NS: i64 = 116_444_736_000_000_000;
    (filetime - WINDOWS_TO_UNIX_EPOCH_100NS) / 10_000
}
