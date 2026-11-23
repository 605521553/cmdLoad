use std::{
    sync::{mpsc, OnceLock},
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};

use crate::{
    models::clipboard::ClipboardChangedPayload,
    services::clipboard::{is_sensitive_text, read_current_text, ClipboardHistoryService},
    state::AppState,
};

static UPDATE_TX: OnceLock<mpsc::Sender<()>> = OnceLock::new();

/// Register an official Win32 clipboard format listener on a dedicated
/// message-only window. The worker debounces burst updates before reading.
pub fn start_clipboard_monitor(app: AppHandle) -> Result<(), String> {
    let (update_tx, update_rx) = mpsc::channel();
    UPDATE_TX
        .set(update_tx)
        .map_err(|_| "剪贴板监听已经启动。".to_owned())?;

    let worker_app = app.clone();
    std::thread::Builder::new()
        .name("pata-clipboard-worker".to_owned())
        .spawn(move || run_worker(worker_app, update_rx))
        .map_err(|error| format!("无法启动剪贴板监听线程：{error}"))?;

    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::Builder::new()
        .name("pata-clipboard-window".to_owned())
        .spawn(move || run_message_window(ready_tx))
        .map_err(|error| format!("无法启动剪贴板窗口线程：{error}"))?;

    ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "等待剪贴板监听窗口超时。".to_owned())?
}

fn run_worker(app: AppHandle, receiver: mpsc::Receiver<()>) {
    while receiver.recv().is_ok() {
        std::thread::sleep(Duration::from_millis(120));
        while receiver.try_recv().is_ok() {}
        process_clipboard_update(&app);
    }
}

fn process_clipboard_update(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if state.quitting.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }

    let settings = state.settings();
    let suppressed = state.is_clipboard_capture_suppressed();
    if !suppressed && settings.clipboard_monitoring_enabled {
        match read_current_text() {
            Ok(Some(text)) if !is_sensitive_text(&text) => {
                let service = ClipboardHistoryService::new(state.database());
                match service.record_local(&text) {
                    Ok(_) => {
                        let _ = service.prune(
                            settings.clipboard_history_limit,
                            settings.clipboard_history_retention_days,
                        );
                        state.set_clipboard_monitor_warning(None);
                    }
                    Err(error) => {
                        state.set_clipboard_monitor_warning(Some(format!(
                            "本地剪贴板历史写入失败：{error}"
                        )));
                    }
                }
            }
            Ok(_) => {}
            Err(error) => {
                state.set_clipboard_monitor_warning(Some(error));
            }
        }
    }

    let revision = state.bump_clipboard_revision();
    let _ = app.emit("clipboard://changed", ClipboardChangedPayload { revision });
}

#[cfg(target_os = "windows")]
fn run_message_window(ready: mpsc::Sender<Result<(), String>>) {
    use std::{mem::zeroed, ptr};

    use windows_sys::{
        core::BOOL,
        Win32::{
            Foundation::{GetLastError, HWND, LPARAM, LRESULT, WPARAM},
            System::{
                DataExchange::{AddClipboardFormatListener, RemoveClipboardFormatListener},
                LibraryLoader::GetModuleHandleW,
            },
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
                PostQuitMessage, RegisterClassW, TranslateMessage, UnregisterClassW, HWND_MESSAGE,
                MSG, WM_CLIPBOARDUPDATE, WM_DESTROY, WNDCLASSW,
            },
        },
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_CLIPBOARDUPDATE => {
                if let Some(sender) = UPDATE_TX.get() {
                    let _ = sender.send(());
                }
                0
            }
            WM_DESTROY => {
                RemoveClipboardFormatListener(hwnd);
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    let class_name = "PataCommandsClipboardListener"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let window_name = "Pata Commands Clipboard Listener"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();

    unsafe {
        let instance = GetModuleHandleW(ptr::null());
        if instance.is_null() {
            let _ = ready.send(Err(format!("无法获取程序实例句柄（{}）。", GetLastError())));
            return;
        }

        let mut class: WNDCLASSW = zeroed();
        class.hInstance = instance;
        class.lpfnWndProc = Some(window_proc);
        class.lpszClassName = class_name.as_ptr();
        if RegisterClassW(&class) == 0 {
            let _ = ready.send(Err(format!(
                "无法注册剪贴板监听窗口（{}）。",
                GetLastError()
            )));
            return;
        }

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            window_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            ptr::null_mut(),
            instance,
            ptr::null(),
        );
        if hwnd.is_null() {
            let _ = ready.send(Err(format!(
                "无法创建剪贴板监听窗口（{}）。",
                GetLastError()
            )));
            UnregisterClassW(class_name.as_ptr(), instance);
            return;
        }

        let registered: BOOL = AddClipboardFormatListener(hwnd);
        if registered == 0 {
            let _ = ready.send(Err(format!(
                "无法注册剪贴板格式监听（{}）。",
                GetLastError()
            )));
            DestroyWindow(hwnd);
            UnregisterClassW(class_name.as_ptr(), instance);
            return;
        }

        let _ = ready.send(Ok(()));
        let mut message: MSG = zeroed();
        loop {
            let result = GetMessageW(&mut message, ptr::null_mut(), 0, 0);
            if result <= 0 {
                break;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        RemoveClipboardFormatListener(hwnd);
        UnregisterClassW(class_name.as_ptr(), instance);
    }
}

#[cfg(not(target_os = "windows"))]
fn run_message_window(ready: mpsc::Sender<Result<(), String>>) {
    let _ = ready.send(Err("当前平台不支持系统剪贴板监听。".to_owned()));
}
