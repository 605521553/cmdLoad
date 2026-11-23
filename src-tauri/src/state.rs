use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{Duration, Instant},
};

use parking_lot::{Mutex, RwLock};

use crate::{
    models::settings::{AppSettings, UiMode},
    services::{
        database::Database,
        hotkey::ShortcutSpec,
        settings::{SettingsError, SettingsRepository},
    },
};

#[derive(Debug, Clone, Default)]
pub struct ShortcutRuntime {
    pub registered: bool,
    pub shortcut: Option<ShortcutSpec>,
    pub error: Option<String>,
}

pub struct AppState {
    repository: SettingsRepository,
    settings: RwLock<AppSettings>,
    current_mode: RwLock<UiMode>,
    shortcut: Mutex<ShortcutRuntime>,
    settings_warning: RwLock<Option<String>>,
    transaction: Mutex<()>,
    has_window_focus: AtomicBool,
    auto_hide_suppressed_until: Mutex<Option<Instant>>,
    geometry_revision: AtomicU64,
    database: Database,
    database_warning: RwLock<Option<String>>,
    data_revision: AtomicU64,
    prompt_revision: AtomicU64,
    clipboard_revision: AtomicU64,
    clipboard_capture_suppressed_until: Mutex<Option<Instant>>,
    clipboard_monitor_warning: RwLock<Option<String>>,
    pub ai_requests: crate::services::ai::AiRequestCancellation,
    pub ai_command_locks: crate::services::ai::AiCommandLocks,
    pub quitting: AtomicBool,
}

impl AppState {
    pub fn new(
        repository: SettingsRepository,
        settings: AppSettings,
        warning: Option<String>,
        database: Database,
        database_warning: Option<String>,
    ) -> Self {
        let current_mode = settings.last_mode;
        Self {
            repository,
            settings: RwLock::new(settings),
            current_mode: RwLock::new(current_mode),
            shortcut: Mutex::new(ShortcutRuntime::default()),
            settings_warning: RwLock::new(warning),
            transaction: Mutex::new(()),
            has_window_focus: AtomicBool::new(false),
            auto_hide_suppressed_until: Mutex::new(None),
            geometry_revision: AtomicU64::new(0),
            database,
            database_warning: RwLock::new(database_warning),
            data_revision: AtomicU64::new(0),
            prompt_revision: AtomicU64::new(0),
            clipboard_revision: AtomicU64::new(0),
            clipboard_capture_suppressed_until: Mutex::new(None),
            clipboard_monitor_warning: RwLock::new(None),
            ai_requests: crate::services::ai::AiRequestCancellation::default(),
            ai_command_locks: crate::services::ai::AiCommandLocks::default(),
            quitting: AtomicBool::new(false),
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.read().clone()
    }

    pub fn mode(&self) -> UiMode {
        *self.current_mode.read()
    }

    pub fn set_mode(&self, mode: UiMode) {
        *self.current_mode.write() = mode;
    }

    pub fn shortcut(&self) -> ShortcutRuntime {
        self.shortcut.lock().clone()
    }

    pub fn set_shortcut(&self, runtime: ShortcutRuntime) {
        *self.shortcut.lock() = runtime;
    }

    pub fn settings_warning(&self) -> Option<String> {
        self.settings_warning.read().clone()
    }

    pub fn set_settings_warning(&self, warning: Option<String>) {
        *self.settings_warning.write() = warning;
    }

    pub fn settings_path(&self) -> String {
        self.repository.path().display().to_string()
    }

    pub fn database(&self) -> &Database {
        &self.database
    }

    pub fn database_path(&self) -> String {
        self.database.path_string()
    }

    pub fn database_warning(&self) -> Option<String> {
        self.database_warning.read().clone()
    }

    pub fn bump_data_revision(&self) -> u64 {
        self.data_revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Prompt mutations are published on their own revision so command views
    /// never reload because a prompt changed (and vice versa).
    pub fn bump_prompt_revision(&self) -> u64 {
        self.prompt_revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn bump_clipboard_revision(&self) -> u64 {
        self.clipboard_revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn suppress_clipboard_capture(&self, duration: Duration) {
        *self.clipboard_capture_suppressed_until.lock() = Some(Instant::now() + duration);
    }

    pub fn is_clipboard_capture_suppressed(&self) -> bool {
        self.clipboard_capture_suppressed_until
            .lock()
            .as_ref()
            .is_some_and(|until| *until > Instant::now())
    }

    pub fn clipboard_monitor_warning(&self) -> Option<String> {
        self.clipboard_monitor_warning.read().clone()
    }

    pub fn set_clipboard_monitor_warning(&self, warning: Option<String>) {
        *self.clipboard_monitor_warning.write() = warning;
    }

    pub fn lock_transaction(&self) -> parking_lot::MutexGuard<'_, ()> {
        self.transaction.lock()
    }

    /// Auto-hide must only react to a real focus transition. Windows can emit a
    /// blur for a window that never acquired foreground focus (for example when
    /// another process steals focus while the app is starting). Without this
    /// guard, a freshly launched quick panel could immediately hide itself.
    pub fn has_window_focus(&self) -> bool {
        self.has_window_focus
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn set_window_focus(&self, focused: bool) {
        self.has_window_focus
            .store(focused, std::sync::atomic::Ordering::SeqCst);
    }

    /// Native move loops and tray menus temporarily take focus away from the
    /// panel. Suppress the auto-hide decision while those operations are
    /// starting so they cannot dismiss the window before they finish.
    pub fn suppress_auto_hide(&self, duration: Duration) {
        *self.auto_hide_suppressed_until.lock() = Some(Instant::now() + duration);
    }

    pub fn is_auto_hide_suppressed(&self) -> bool {
        self.auto_hide_suppressed_until
            .lock()
            .as_ref()
            .is_some_and(|until| *until > Instant::now())
    }

    pub(crate) fn bump_geometry_revision(&self) -> u64 {
        self.geometry_revision.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(crate) fn geometry_revision(&self) -> u64 {
        self.geometry_revision.load(Ordering::SeqCst)
    }

    /// Persist settings first, then publish them in memory. A failed write
    /// leaves the running application on the last known-good snapshot.
    pub fn persist_settings(&self, settings: AppSettings) -> Result<(), SettingsError> {
        self.repository.save(&settings)?;
        *self.settings.write() = settings;
        Ok(())
    }
}
