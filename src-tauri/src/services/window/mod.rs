use std::time::Duration;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Theme, WebviewWindow,
};
use thiserror::Error;

use crate::{
    models::{
        app::{ManagerView, ModeChangedPayload, NavigatePayload, PanelShownPayload},
        settings::{ThemePreference, UiMode, WindowBounds},
    },
    services::settings::SettingsError,
    state::AppState,
};

#[derive(Debug, Error)]
pub enum WindowError {
    #[error("无法操作主窗口：{0}")]
    Tauri(#[from] tauri::Error),
    #[error("主窗口不存在，应用可能需要重新启动。")]
    MissingWindow,
    #[error("无法保存窗口状态：{0}")]
    Settings(#[from] SettingsError),
}

pub fn main_window(app: &AppHandle) -> Result<WebviewWindow, WindowError> {
    app.get_webview_window("main")
        .ok_or(WindowError::MissingWindow)
}

pub const MODE_CHANGED_EVENT: &str = "app://mode-changed";
pub const PANEL_SHOWN_EVENT: &str = "app://panel-shown";
pub const NAVIGATE_EVENT: &str = "app://navigate";
pub const RUNTIME_ERROR_EVENT: &str = "app://runtime-error";

pub const QUICK_WINDOW_WIDTH: f64 = 460.0;
pub const QUICK_WINDOW_HEIGHT: f64 = 480.0;
pub const MANAGER_WINDOW_WIDTH: f64 = 900.0;
pub const MANAGER_WINDOW_HEIGHT: f64 = 650.0;
const MANAGER_MIN_WIDTH: f64 = 760.0;
const MANAGER_MIN_HEIGHT: f64 = 560.0;
const QUICK_MIN_WIDTH: f64 = 360.0;
const QUICK_MIN_HEIGHT: f64 = 320.0;
const SCREEN_MARGIN: i32 = 16;
const TITLEBAR_ALLOWANCE: u32 = 48;
const DRAG_SUPPRESSION: Duration = Duration::from_millis(1600);
const TRAY_SUPPRESSION: Duration = Duration::from_millis(1800);
const AUTO_HIDE_DELAY: Duration = Duration::from_millis(220);
const BOUNDS_SAVE_DELAY: Duration = Duration::from_millis(350);

#[derive(Debug, Clone, Copy)]
pub struct ScreenArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
}

pub fn emit_runtime_error(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit(RUNTIME_ERROR_EVENT, message.into());
}

pub fn apply_theme(app: &AppHandle, preference: ThemePreference) -> Result<(), WindowError> {
    let window = main_window(app)?;
    let theme = match preference {
        ThemePreference::System => None,
        ThemePreference::Light => Some(Theme::Light),
        ThemePreference::Dark => Some(Theme::Dark),
    };
    window.set_theme(theme)?;
    Ok(())
}

/// Configure the window for the saved startup mode. The window is not shown
/// here when it was launched by the autostart entry.
pub fn prepare_main_window(app: &AppHandle, start_hidden: bool) -> Result<(), WindowError> {
    let window = main_window(app)?;
    let state = app.state::<AppState>();
    let settings = state.settings();
    let mode = state.mode();

    apply_layout(&window, mode, settings.bounds_for(mode))?;
    let _ = apply_theme(app, settings.theme);

    if !start_hidden {
        show_and_focus(&window)?;
    }

    Ok(())
}

/// Show the requested UI mode. A mode change also persists `lastMode`, so the
/// next launch restores the mode the user actually used.
pub fn present_mode(app: &AppHandle, mode: UiMode) -> Result<(), WindowError> {
    let window = main_window(app)?;
    let state = app.state::<AppState>();
    let previous_mode = state.mode();
    let was_visible = window.is_visible().unwrap_or(false);

    if previous_mode != mode {
        let _transaction = state.lock_transaction();
        let mut next_settings = state.settings();
        if window.is_visible().unwrap_or(false) {
            if let Some(bounds) = capture_bounds(&window) {
                next_settings.set_bounds_for(previous_mode, Some(bounds));
            }
        }

        apply_layout(&window, mode, next_settings.bounds_for(mode))?;

        next_settings.last_mode = mode;
        if let Err(error) = state.persist_settings(next_settings) {
            // Return the window to its prior shape rather than presenting a
            // mode the application could not persist.
            let original = state.settings();
            let _ = apply_layout(&window, previous_mode, original.bounds_for(previous_mode));
            return Err(error.into());
        }

        state.set_mode(mode);
        let _ = app.emit(MODE_CHANGED_EVENT, ModeChangedPayload { mode });
    } else if !was_visible {
        // The window may have been hidden while monitors were rearranged. Apply
        // the saved layout again before showing it so it cannot reappear
        // entirely off-screen or with an out-of-date size.
        let settings = state.settings();
        apply_layout(&window, mode, settings.bounds_for(mode))?;
    }

    show_and_focus(&window)?;
    let _ = app.emit(PANEL_SHOWN_EVENT, PanelShownPayload { mode });
    Ok(())
}

pub fn toggle_quick_panel(app: &AppHandle) -> Result<(), WindowError> {
    let window = main_window(app)?;
    let state = app.state::<AppState>();
    let is_quick_visible = state.mode() == UiMode::Quick && window.is_visible().unwrap_or(false);

    if is_quick_visible {
        hide_window(app)
    } else {
        present_mode(app, UiMode::Quick)
    }
}

pub fn show_settings(app: &AppHandle) -> Result<(), WindowError> {
    present_mode(app, UiMode::Manager)?;
    let _ = app.emit(
        NAVIGATE_EVENT,
        NavigatePayload {
            view: ManagerView::Settings,
        },
    );
    Ok(())
}

pub fn show_manager(app: &AppHandle) -> Result<(), WindowError> {
    present_mode(app, UiMode::Manager)
}

pub fn show_quick_panel(app: &AppHandle) -> Result<(), WindowError> {
    present_mode(app, UiMode::Quick)
}

pub fn show_current_mode(app: &AppHandle) -> Result<(), WindowError> {
    let state = app.state::<AppState>();
    present_mode(app, state.mode())
}

/// Start a native window move from the app's custom drag strip. The native
/// drag loop temporarily changes focus ownership, so auto-hide is suppressed
/// while the move starts. Geometry is persisted by `WindowEvent::Moved`.
pub fn start_window_drag(app: &AppHandle) -> Result<(), WindowError> {
    let window = main_window(app)?;
    let state = app.state::<AppState>();
    state.suppress_auto_hide(DRAG_SUPPRESSION);
    window.start_dragging()?;
    Ok(())
}

/// Suppress auto-hide while the tray menu is opening. Without this, the
/// quick panel can disappear before the user chooses a tray action.
pub fn suppress_auto_hide_for_tray(app: &AppHandle) {
    app.state::<AppState>().suppress_auto_hide(TRAY_SUPPRESSION);
}

/// Persist geometry after the user finishes moving or resizing. Window events
/// arrive at a high frequency during drags, so a small debounce avoids writing
/// the settings file for every pixel.
pub fn schedule_bounds_save(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let revision = state.bump_geometry_revision();
    let window = window.clone();

    std::thread::spawn(move || {
        std::thread::sleep(BOUNDS_SAVE_DELAY);
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        if state.geometry_revision() != revision {
            return;
        }
        remember_visible_bounds(&window, &state);
    });
}

pub fn hide_window(app: &AppHandle) -> Result<(), WindowError> {
    let window = main_window(app)?;
    let state = app.state::<AppState>();
    remember_visible_bounds(&window, &state);
    window.hide()?;
    state.set_window_focus(false);
    Ok(())
}

/// Returns `true` when the caller must prevent the native close so the window
/// can stay resident in the system tray.
pub fn handle_close_requested(window: &WebviewWindow) -> bool {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    if state.quitting.load(std::sync::atomic::Ordering::SeqCst) {
        return false;
    }
    remember_visible_bounds(window, &state);
    let _ = window.hide();
    state.set_window_focus(false);
    true
}

pub fn handle_focus_gained(window: &WebviewWindow) {
    let state = window.app_handle().state::<AppState>();
    state.set_window_focus(true);
}

pub fn handle_focus_lost(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let state = app.state::<AppState>();
    if !state.has_window_focus() {
        return;
    }
    state.set_window_focus(false);
    if state.mode() != UiMode::Quick || !state.settings().auto_hide_quick_panel {
        return;
    }

    // Defer the hide decision. During a native move loop or while the tray menu
    // opens, Windows can briefly report focus loss before the interaction is
    // established. Re-checking after the interaction settles prevents the
    // panel from vanishing under the user's cursor.
    let window = window.clone();
    std::thread::spawn(move || {
        // Poll briefly while the shell owns focus. The tray overflow and native
        // context menus temporarily belong to Explorer rather than to an
        // application window, and auto-hiding there would make tray actions
        // impossible to complete. We still hide as soon as another normal
        // foreground window is selected.
        for _ in 0..75 {
            std::thread::sleep(AUTO_HIDE_DELAY);
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            if state.mode() != UiMode::Quick
                || !state.settings().auto_hide_quick_panel
                || !window.is_visible().unwrap_or(false)
                || window.is_focused().unwrap_or(false)
            {
                return;
            }
            if state.is_auto_hide_suppressed() || foreground_is_internal() {
                continue;
            }
            remember_visible_bounds(&window, &state);
            if window.hide().is_err() {
                emit_runtime_error(&app, "快捷面板未能自动隐藏，请使用 Esc 或托盘操作。");
            }
            return;
        }
    });
}

#[cfg(target_os = "windows")]
fn foreground_is_internal() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return true;
    }

    let mut class_buffer = [0u16; 256];
    let length =
        unsafe { GetClassNameW(hwnd, class_buffer.as_mut_ptr(), class_buffer.len() as i32) };
    if length <= 0 {
        return false;
    }
    let class_name = String::from_utf16_lossy(&class_buffer[..length as usize]);
    is_internal_foreground_class(&class_name)
}

#[cfg(not(target_os = "windows"))]
fn foreground_is_internal() -> bool {
    false
}

fn is_internal_foreground_class(class_name: &str) -> bool {
    matches!(
        class_name,
        "Shell_TrayWnd"
            | "Shell_SecondaryTrayWnd"
            | "NotifyIconOverflowWindow"
            | "TopLevelWindowForOverflowXamlIsland"
            | "XamlExplorerHostIslandWindow_WASDK"
            | "XamlExplorerHostIslandWindow"
            | "#32768"
    )
}

pub fn quit_application(app: &AppHandle) {
    let state = app.state::<AppState>();
    state
        .quitting
        .store(true, std::sync::atomic::Ordering::SeqCst);
    if let Ok(window) = main_window(app) {
        remember_visible_bounds(&window, &state);
    }
    app.exit(0);
}

fn remember_visible_bounds(window: &WebviewWindow, state: &AppState) {
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let Some(bounds) = capture_bounds(window) else {
        return;
    };

    let _transaction = state.lock_transaction();
    let mut settings = state.settings();
    settings.set_bounds_for(state.mode(), Some(bounds));
    if let Err(error) = state.persist_settings(settings) {
        // Hiding must always succeed. Surface the persistence problem on the
        // next inspection instead of trapping the user with an open window.
        state.set_settings_warning(Some(format!(
            "窗口位置未能保存，下一次启动可能会使用默认位置。（{error}）"
        )));
    }
}

fn capture_bounds(window: &WebviewWindow) -> Option<WindowBounds> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    if size.width == 0 || size.height == 0 {
        return None;
    }
    Some(WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn show_and_focus(window: &WebviewWindow) -> Result<(), WindowError> {
    window.show()?;
    let _ = window.unminimize();
    window.set_focus()?;
    Ok(())
}

fn apply_layout(
    window: &WebviewWindow,
    mode: UiMode,
    saved: Option<WindowBounds>,
) -> Result<(), WindowError> {
    window.set_title(match mode {
        UiMode::Quick => "Pata Commands — 快捷面板",
        UiMode::Manager => "Pata Commands",
    })?;

    let screens = available_screen_areas(window);
    let current = current_screen_area(window);
    let placement = resolve_placement(mode, saved, &screens, current);

    window.set_maximizable(mode == UiMode::Manager)?;
    window.set_resizable(true)?;

    if let Some(placement) = placement {
        window.set_min_size(Some(PhysicalSize::new(
            placement.min_width,
            placement.min_height,
        )))?;
    } else {
        let (min_width, min_height) = match mode {
            UiMode::Quick => (QUICK_MIN_WIDTH, QUICK_MIN_HEIGHT),
            UiMode::Manager => (MANAGER_MIN_WIDTH, MANAGER_MIN_HEIGHT),
        };
        window.set_min_size(Some(LogicalSize::new(min_width, min_height)))?;
    }

    if let Some(placement) = placement {
        window.set_size(PhysicalSize::new(placement.width, placement.height))?;
        window.set_position(PhysicalPosition::new(placement.x, placement.y))?;
    } else {
        let (width, height) = match mode {
            UiMode::Quick => (QUICK_WINDOW_WIDTH, QUICK_WINDOW_HEIGHT),
            UiMode::Manager => (MANAGER_WINDOW_WIDTH, MANAGER_WINDOW_HEIGHT),
        };
        window.set_size(LogicalSize::new(width, height))?;
        window.center()?;
    }

    Ok(())
}

fn available_screen_areas(window: &WebviewWindow) -> Vec<ScreenArea> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .filter_map(|monitor| {
            let work_area = monitor.work_area();
            if work_area.size.width == 0 || work_area.size.height == 0 {
                return None;
            }
            Some(ScreenArea {
                x: work_area.position.x,
                y: work_area.position.y,
                width: work_area.size.width,
                height: work_area.size.height,
                scale_factor: monitor.scale_factor(),
            })
        })
        .collect()
}

fn current_screen_area(window: &WebviewWindow) -> Option<ScreenArea> {
    window.current_monitor().ok().flatten().and_then(|monitor| {
        let work_area = monitor.work_area();
        if work_area.size.width == 0 || work_area.size.height == 0 {
            return None;
        }
        Some(ScreenArea {
            x: work_area.position.x,
            y: work_area.position.y,
            width: work_area.size.width,
            height: work_area.size.height,
            scale_factor: monitor.scale_factor(),
        })
    })
}

fn resolve_placement(
    mode: UiMode,
    saved: Option<WindowBounds>,
    screens: &[ScreenArea],
    current: Option<ScreenArea>,
) -> Option<Placement> {
    if screens.is_empty() {
        return None;
    }

    let chosen_by_saved = saved.and_then(|bounds| {
        screens
            .iter()
            .copied()
            .max_by_key(|screen| intersection_area(bounds, *screen))
            .filter(|screen| intersection_area(bounds, *screen) > 0)
    });
    let screen = chosen_by_saved
        .or(current)
        .or_else(|| screens.first().copied())?;
    let saved_is_on_screen = chosen_by_saved.is_some();

    let scale = screen.scale_factor.max(0.5);
    let max_width = screen
        .width
        .saturating_sub((SCREEN_MARGIN * 2) as u32)
        .max(320);
    let max_height = screen
        .height
        .saturating_sub((SCREEN_MARGIN * 2) as u32 + TITLEBAR_ALLOWANCE)
        .max(240);

    let (default_logical_width, default_logical_height, min_logical_width, min_logical_height) =
        match mode {
            UiMode::Quick => (
                QUICK_WINDOW_WIDTH,
                QUICK_WINDOW_HEIGHT,
                QUICK_MIN_WIDTH,
                QUICK_MIN_HEIGHT,
            ),
            UiMode::Manager => (
                MANAGER_WINDOW_WIDTH,
                MANAGER_WINDOW_HEIGHT,
                MANAGER_MIN_WIDTH,
                MANAGER_MIN_HEIGHT,
            ),
        };

    let fallback = (
        (default_logical_width * scale).round() as u32,
        (default_logical_height * scale).round() as u32,
    );
    let (desired_width, desired_height) = saved
        .map(|bounds| (bounds.width, bounds.height))
        .filter(|(width, height)| *width >= 200 && *height >= 160)
        .unwrap_or(fallback);

    let min_width = ((min_logical_width * scale).round() as u32).min(max_width);
    let min_height = ((min_logical_height * scale).round() as u32).min(max_height);

    let width = desired_width.clamp(min_width, max_width);
    let height = desired_height.clamp(min_height, max_height);

    let (x, y) = if let (true, Some(bounds)) = (saved_is_on_screen, saved) {
        clamp_origin(bounds.x, bounds.y, width, height, screen)
    } else {
        centered_origin(width, height, screen)
    };

    Some(Placement {
        x,
        y,
        width,
        height,
        min_width,
        min_height,
    })
}

fn clamp_origin(x: i32, y: i32, width: u32, height: u32, screen: ScreenArea) -> (i32, i32) {
    let min_x = screen.x + SCREEN_MARGIN;
    let max_x = screen.x + screen.width as i32 - width as i32 - SCREEN_MARGIN;
    let min_y = screen.y + SCREEN_MARGIN;
    let outer_height = height as i32 + TITLEBAR_ALLOWANCE as i32;
    let max_y = screen.y + screen.height as i32 - outer_height - SCREEN_MARGIN;

    (
        x.clamp(min_x, max_x.max(min_x)),
        y.clamp(min_y, max_y.max(min_y)),
    )
}

fn centered_origin(width: u32, height: u32, screen: ScreenArea) -> (i32, i32) {
    let x = screen.x + (screen.width as i32 - width as i32) / 2;
    let y = screen.y + (screen.height as i32 - height as i32 - TITLEBAR_ALLOWANCE as i32) / 2;
    clamp_origin(x, y, width, height, screen)
}

fn intersection_area(bounds: WindowBounds, screen: ScreenArea) -> u64 {
    let left = bounds.x.max(screen.x) as i64;
    let top = bounds.y.max(screen.y) as i64;
    let right = (bounds.x as i64 + bounds.width as i64).min(screen.x as i64 + screen.width as i64);
    let bottom =
        (bounds.y as i64 + bounds.height as i64).min(screen.y as i64 + screen.height as i64);

    if right <= left || bottom <= top {
        0
    } else {
        ((right - left) * (bottom - top)) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn primary() -> ScreenArea {
        ScreenArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
            scale_factor: 1.0,
        }
    }

    fn left_monitor() -> ScreenArea {
        ScreenArea {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
            scale_factor: 1.0,
        }
    }

    #[test]
    fn quick_panel_uses_a_compact_default_size() {
        let placement = resolve_placement(UiMode::Quick, None, &[primary()], Some(primary()))
            .expect("placement");
        assert_eq!(placement.width, 460);
        assert_eq!(placement.height, 480);
    }

    #[test]
    fn quick_panel_restores_a_user_resized_geometry() {
        let saved = WindowBounds {
            x: 120,
            y: 90,
            width: 540,
            height: 560,
        };
        let placement =
            resolve_placement(UiMode::Quick, Some(saved), &[primary()], Some(primary()))
                .expect("placement");
        assert_eq!((placement.width, placement.height), (540, 560));
        assert_eq!((placement.x, placement.y), (120, 90));
    }

    #[test]
    fn manager_uses_the_new_default_size() {
        let placement = resolve_placement(UiMode::Manager, None, &[primary()], Some(primary()))
            .expect("placement");
        assert_eq!(placement.width, 900);
        assert_eq!(placement.height, 650);
    }

    #[test]
    fn undersized_saved_windows_are_enlarged_to_the_minimum() {
        let saved = WindowBounds {
            x: 100,
            y: 100,
            width: 300,
            height: 200,
        };
        let placement =
            resolve_placement(UiMode::Manager, Some(saved), &[primary()], Some(primary()))
                .expect("placement");
        assert_eq!(placement.width, 760);
        assert_eq!(placement.height, 560);
    }

    #[test]
    fn offscreen_saved_position_is_recovered_to_a_visible_monitor() {
        let saved = WindowBounds {
            x: 30_000,
            y: 30_000,
            width: 1240,
            height: 820,
        };
        let placement =
            resolve_placement(UiMode::Manager, Some(saved), &[primary()], Some(primary()))
                .expect("placement");
        assert!(placement.x >= 0 && placement.x + placement.width as i32 <= 1920);
        assert!(placement.y >= 0);
        assert!(placement.y + placement.height as i32 + TITLEBAR_ALLOWANCE as i32 <= 1040);
    }

    #[test]
    fn saved_position_is_preserved_on_a_negative_offset_monitor() {
        let saved = WindowBounds {
            x: -1500,
            y: 120,
            width: 1200,
            height: 760,
        };
        let placement = resolve_placement(
            UiMode::Manager,
            Some(saved),
            &[primary(), left_monitor()],
            Some(primary()),
        )
        .expect("placement");
        assert_eq!(placement.x, -1500);
        assert_eq!(placement.y, 120);
    }

    #[test]
    fn a_window_larger_than_the_work_area_is_clamped() {
        let screen = ScreenArea {
            x: 0,
            y: 0,
            width: 1366,
            height: 728,
            scale_factor: 1.0,
        };
        let saved = WindowBounds {
            x: 0,
            y: 0,
            width: 1240,
            height: 820,
        };
        let placement = resolve_placement(UiMode::Manager, Some(saved), &[screen], Some(screen))
            .expect("placement");
        assert!(placement.width <= screen.width - 32);
        assert!(placement.height <= screen.height - 32 - TITLEBAR_ALLOWANCE);
        assert!(placement.y + placement.height as i32 + TITLEBAR_ALLOWANCE as i32 <= 728);
    }

    #[test]
    fn scale_factor_is_applied_to_quick_window_dimensions() {
        let screen = ScreenArea {
            x: 0,
            y: 0,
            width: 2400,
            height: 1400,
            scale_factor: 1.5,
        };
        let placement =
            resolve_placement(UiMode::Quick, None, &[screen], Some(screen)).expect("placement");
        assert_eq!(placement.width, 690);
        assert_eq!(placement.height, 720);
    }

    #[test]
    fn missing_monitors_defer_to_tauri_centering() {
        assert!(resolve_placement(UiMode::Quick, None, &[], None).is_none());
    }

    #[test]
    fn shell_and_tray_surfaces_are_treated_as_internal_focus() {
        for class_name in [
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "NotifyIconOverflowWindow",
            "TopLevelWindowForOverflowXamlIsland",
            "XamlExplorerHostIslandWindow_WASDK",
            "XamlExplorerHostIslandWindow",
            "#32768",
        ] {
            assert!(is_internal_foreground_class(class_name), "{class_name}");
        }
        assert!(!is_internal_foreground_class("Chrome_WidgetWin_1"));
        assert!(!is_internal_foreground_class("Tauri Window"));
    }
}
