mod history;
mod monitor;
mod system_history;
mod text;

use std::time::Duration;

pub use history::ClipboardHistoryService;
pub use monitor::start_clipboard_monitor;
pub use system_history::{read_system_history, SystemHistoryRead, SystemHistoryText};
pub use text::{content_hash, is_sensitive_text, suggest_shell, suggest_title};

pub trait ClipboardWriter: Send + Sync {
    fn write_text(&self, text: &str) -> Result<(), String>;
}

#[derive(Debug, Default)]
pub struct SystemClipboard;

impl ClipboardWriter for SystemClipboard {
    fn write_text(&self, text: &str) -> Result<(), String> {
        platform_write_text(text)
    }
}

/// Read the current Unicode text from the Windows clipboard. Returns `Ok(None)`
/// when the clipboard has no text (for example image-only content). A failure
/// must never cause the caller to clear persisted clipboard history.
pub fn read_current_text() -> Result<Option<String>, String> {
    platform_read_text()
}

#[cfg(target_os = "windows")]
fn platform_read_text() -> Result<Option<String>, String> {
    use std::ptr;

    use windows_sys::Win32::{
        Foundation::HANDLE,
        System::{
            DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
    };

    const CF_UNICODETEXT: u32 = 13;

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    let mut opened = false;
    for _ in 0..20 {
        if unsafe { OpenClipboard(ptr::null_mut()) } != 0 {
            opened = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    if !opened {
        return Err("系统剪贴板正被其他程序占用，请稍后重试。".to_owned());
    }
    let _guard = ClipboardGuard;

    let handle: HANDLE = unsafe { GetClipboardData(CF_UNICODETEXT) };
    if handle.is_null() {
        return Ok(None);
    }

    let pointer = unsafe { GlobalLock(handle) };
    if pointer.is_null() {
        return Err("无法读取剪贴板文本内存。".to_owned());
    }
    let bytes = unsafe { GlobalSize(handle) };
    let units = bytes / std::mem::size_of::<u16>();
    if units == 0 {
        unsafe {
            GlobalUnlock(handle);
        }
        return Ok(None);
    }

    let words = unsafe { std::slice::from_raw_parts(pointer.cast::<u16>(), units) };
    let end = words.iter().position(|word| *word == 0).unwrap_or(units);
    let text = String::from_utf16_lossy(&words[..end]);
    unsafe {
        GlobalUnlock(handle);
    }
    if text.is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

#[cfg(not(target_os = "windows"))]
fn platform_read_text() -> Result<Option<String>, String> {
    Err("当前平台不支持读取系统剪贴板。".to_owned())
}

#[cfg(target_os = "windows")]
fn platform_write_text(text: &str) -> Result<(), String> {
    use std::ptr;

    use windows_sys::Win32::{
        Foundation::{GlobalFree, HANDLE},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
    };

    const CF_UNICODETEXT: u32 = 13;

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    let mut opened = false;
    for _ in 0..20 {
        let result = unsafe { OpenClipboard(ptr::null_mut()) };
        if result != 0 {
            opened = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    if !opened {
        return Err("系统剪贴板正被其他程序占用，请稍后重试。".to_owned());
    }
    let _guard = ClipboardGuard;

    if unsafe { EmptyClipboard() } == 0 {
        return Err("无法清空系统剪贴板。".to_owned());
    }

    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let bytes = wide.len() * std::mem::size_of::<u16>();
    let handle: HANDLE = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) };
    if handle.is_null() {
        return Err("无法为剪贴板内容分配内存。".to_owned());
    }

    let pointer = unsafe { GlobalLock(handle) };
    if pointer.is_null() {
        unsafe {
            GlobalFree(handle);
        }
        return Err("无法锁定剪贴板内存。".to_owned());
    }
    unsafe {
        ptr::copy_nonoverlapping(wide.as_ptr(), pointer.cast::<u16>(), wide.len());
        GlobalUnlock(handle);
    }

    let result = unsafe { SetClipboardData(CF_UNICODETEXT, handle) };
    if result.is_null() {
        unsafe {
            GlobalFree(handle);
        }
        return Err("系统剪贴板写入失败。".to_owned());
    }

    // Ownership of the HGLOBAL transfers to the clipboard on success.
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn platform_write_text(_text: &str) -> Result<(), String> {
    Err("当前平台不支持系统剪贴板写入。".to_owned())
}
