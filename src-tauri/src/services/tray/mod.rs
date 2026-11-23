use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use thiserror::Error;

use crate::{
    services::window::{
        emit_runtime_error, quit_application, show_manager, show_quick_panel, show_settings,
        suppress_auto_hide_for_tray,
    },
    state::AppState,
};

pub const TRAY_ID: &str = "main-tray";
const MENU_QUICK: &str = "tray-quick-panel";
const MENU_MANAGER: &str = "tray-manager";
const MENU_SETTINGS: &str = "tray-settings";
const MENU_QUIT: &str = "tray-quit";

#[derive(Debug, Error)]
pub enum TrayError {
    #[error("系统托盘图标资源缺失，请重新安装应用。")]
    MissingIcon,
    #[error("无法初始化系统托盘：{0}")]
    Tauri(#[from] tauri::Error),
}

pub fn create_tray(app: &AppHandle) -> Result<(), TrayError> {
    let quick = MenuItem::with_id(app, MENU_QUICK, "打开快捷面板", true, None::<&str>)?;
    let manager = MenuItem::with_id(app, MENU_MANAGER, "打开完整管理", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "设置", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quick, &manager, &settings, &separator, &quit])?;

    let shortcut = app.state::<AppState>().settings().shortcut;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or(TrayError::MissingIcon)?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(format!("Pata Commands · {shortcut} 呼出"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            suppress_auto_hide_for_tray(app);
            match event.id().as_ref() {
                MENU_QUICK => {
                    if let Err(error) = show_quick_panel(app) {
                        emit_runtime_error(app, error.to_string());
                    }
                }
                MENU_MANAGER => {
                    if let Err(error) = show_manager(app) {
                        emit_runtime_error(app, error.to_string());
                    }
                }
                MENU_SETTINGS => {
                    if let Err(error) = show_settings(app) {
                        emit_runtime_error(app, error.to_string());
                    }
                }
                MENU_QUIT => quit_application(app),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    suppress_auto_hide_for_tray(app);
                    if let Err(error) = show_quick_panel(app) {
                        emit_runtime_error(app, error.to_string());
                    }
                }
                TrayIconEvent::Click { .. } => {
                    suppress_auto_hide_for_tray(app);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
