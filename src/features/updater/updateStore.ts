import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { appApi } from "@/services/appApi";
import type { UpdateConfiguration } from "@/types/app";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface UpdateSummary {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

interface CheckOptions {
  /** Startup checks stay quiet on errors and up-to-date results. */
  silent?: boolean;
}

interface UpdateStore {
  status: UpdateStatus;
  update: UpdateSummary | null;
  configuration: UpdateConfiguration | null;
  configurationLoaded: boolean;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  dialogOpen: boolean;
  lastCheckedAt: number | null;
  dismissedVersion: string | null;

  loadConfiguration: () => Promise<UpdateConfiguration | null>;
  check: (options?: CheckOptions) => Promise<void>;
  install: () => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
}

/**
 * The plugin holds a native resource that cannot be stored in Zustand. Keeping
 * it in module scope lets the settings page and the startup prompt share one
 * pending update instead of checking twice.
 */
let pendingUpdate: Update | null = null;
let autoCheckStarted = false;

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (
    /404|not found|valid release json|failed to fetch|error sending request|dns|connect/i.test(
      text,
    )
  ) {
    return "无法连接更新服务器，或该版本还没有发布。请稍后重试。";
  }
  return text || "检查更新失败。";
}

function summaryOf(update: Update): UpdateSummary {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  };
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: "idle",
  update: null,
  configuration: null,
  configurationLoaded: false,
  progress: null,
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,
  dialogOpen: false,
  lastCheckedAt: null,
  dismissedVersion: null,

  loadConfiguration: async () => {
    try {
      const configuration = await appApi.getUpdateConfiguration();
      set({ configuration, configurationLoaded: true });
      return configuration;
    } catch {
      // The command is unavailable in browser-only tests; leave the UI usable.
      set({ configurationLoaded: true });
      return null;
    }
  },

  check: async ({ silent = false } = {}) => {
    const state = get();
    if (
      state.status === "checking" ||
      state.status === "downloading" ||
      state.status === "installing"
    ) {
      return;
    }

    let configuration = state.configuration;
    if (!state.configurationLoaded) {
      configuration = await get().loadConfiguration();
    }
    if (configuration && !configuration.configured) {
      const message =
        "更新源尚未配置。发布前请把 tauri.conf.json 中的 plugins.updater.endpoints 改成你自己的 latest.json 地址。";
      set({
        status: "error",
        error: message,
        dialogOpen: !silent,
        lastCheckedAt: Date.now(),
      });
      return;
    }

    set({
      status: "checking",
      error: null,
      progress: null,
      downloadedBytes: 0,
      totalBytes: 0,
      dialogOpen: !silent || get().dialogOpen,
    });

    try {
      const update = await check({ timeout: 20_000 });
      const dismissedVersion = get().dismissedVersion;
      if (!update) {
        set({
          status: "up-to-date",
          update: null,
          error: null,
          lastCheckedAt: Date.now(),
          dialogOpen: !silent,
        });
        return;
      }

      if (pendingUpdate && pendingUpdate !== update) {
        await pendingUpdate.close().catch(() => undefined);
      }
      pendingUpdate = update;
      const summary = summaryOf(update);
      set({
        status: "available",
        update: summary,
        error: null,
        lastCheckedAt: Date.now(),
        dialogOpen:
          !silent || dismissedVersion !== summary.version || get().dialogOpen,
      });
    } catch (error) {
      set({
        status: "error",
        error: errorMessage(error),
        lastCheckedAt: Date.now(),
        dialogOpen: !silent,
      });
    }
  },

  install: async () => {
    const update = pendingUpdate;
    if (!update) {
      set({
        status: "error",
        error: "更新信息已失效，请重新检查更新。",
        dialogOpen: true,
      });
      return;
    }
    set({
      status: "downloading",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
      dialogOpen: true,
    });
    try {
      await update.downloadAndInstall(
        (event) => {
          if (event.event === "Started") {
            set({
              totalBytes: event.data.contentLength ?? 0,
              downloadedBytes: 0,
              progress: 0,
            });
          } else if (event.event === "Progress") {
            const total = get().totalBytes;
            const downloaded = get().downloadedBytes + event.data.chunkLength;
            set({
              downloadedBytes: downloaded,
              progress:
                total > 0 ? Math.min(1, downloaded / total) : null,
            });
          } else if (event.event === "Finished") {
            set({ status: "installing", progress: 1 });
          }
        },
        { timeout: 120_000, restartAfterInstall: true },
      );
      set({ status: "installing", progress: 1 });
      pendingUpdate = null;
      // On Windows the NSIS updater exits the process and the installer starts
      // the new version. On other platforms this call starts the new version.
      await relaunch();
    } catch (error) {
      set({
        status: "error",
        error: errorMessage(error),
        dialogOpen: true,
      });
    }
  },

  openDialog: () => set({ dialogOpen: true }),

  closeDialog: () => {
    const state = get();
    set({
      dialogOpen: false,
      dismissedVersion:
        state.status === "available" && state.update
          ? state.update.version
          : state.dismissedVersion,
    });
  },
}));

/** Run at most one quiet startup check per app process. */
export function autoCheckForUpdates(): void {
  if (autoCheckStarted) {
    return;
  }
  autoCheckStarted = true;
  window.setTimeout(() => {
    void useUpdateStore.getState().check({ silent: true });
  }, 4_000);
}

/** Test helper; never used by production UI. */
export function resetUpdateStoreForTests(): void {
  pendingUpdate = null;
  autoCheckStarted = false;
  useUpdateStore.setState({
    status: "idle",
    update: null,
    configuration: null,
    configurationLoaded: false,
    progress: null,
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
    dialogOpen: false,
    lastCheckedAt: null,
    dismissedVersion: null,
  });
}
