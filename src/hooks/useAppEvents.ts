import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "@/stores/appStore";
import type {
  ClipboardChangedPayload,
  DataChangedPayload,
  ManagerView,
  ModeChangedPayload,
  NavigatePayload,
  PanelShownPayload,
  UiMode,
} from "@/types/app";

export const APP_EVENTS = {
  modeChanged: "app://mode-changed",
  navigate: "app://navigate",
  panelShown: "app://panel-shown",
  runtimeError: "app://runtime-error",
  dataChanged: "data://commands-changed",
  promptsChanged: "data://prompts-changed",
  clipboardChanged: "clipboard://changed",
} as const;

/**
 * Bridge native window/tray lifecycle events into the UI store. Registration is
 * centralized so individual screens never need to know about Tauri transport.
 */
export function useAppEvents(): void {
  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const register = async () => {
      const registrations = await Promise.all([
        listen<ModeChangedPayload>(APP_EVENTS.modeChanged, ({ payload }) => {
          if (isUiMode(payload?.mode)) {
            useAppStore.getState().handleModeChanged(payload.mode);
          }
        }),
        listen<NavigatePayload>(APP_EVENTS.navigate, ({ payload }) => {
          if (isManagerView(payload?.view)) {
            useAppStore.getState().setManagerView(payload.view);
          }
        }),
        listen<PanelShownPayload>(APP_EVENTS.panelShown, ({ payload }) => {
          if (payload?.mode === "quick") {
            useAppStore.getState().requestSearchFocus();
          }
        }),
        listen<string>(APP_EVENTS.runtimeError, ({ payload }) => {
          useAppStore.getState().showNotice({
            kind: "error",
            message: typeof payload === "string" ? payload : "窗口操作未完成，请重试。",
          });
        }),
        listen<DataChangedPayload>(APP_EVENTS.dataChanged, ({ payload }) => {
          const revision =
            typeof payload?.revision === "number" ? payload.revision : 0;
          useAppStore.getState().handleDataChanged(revision);
        }),
        listen<DataChangedPayload>(
          APP_EVENTS.promptsChanged,
          ({ payload }) => {
            const revision =
              typeof payload?.revision === "number" ? payload.revision : 0;
            useAppStore.getState().handlePromptsChanged(revision);
          },
        ),
        listen<ClipboardChangedPayload>(
          APP_EVENTS.clipboardChanged,
          ({ payload }) => {
            const revision =
              typeof payload?.revision === "number" ? payload.revision : 0;
            useAppStore.getState().handleClipboardChanged(revision);
          },
        ),
      ]);

      if (disposed) {
        registrations.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...registrations);
    };

    void register().catch(() => {
      if (!disposed) {
        useAppStore.getState().showNotice({
          kind: "error",
          message: "无法接收窗口事件，快捷键、托盘切换和剪贴板状态可能不会即时刷新。",
        });
      }
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
}

export function isUiMode(value: unknown): value is UiMode {
  return value === "quick" || value === "manager";
}

const MANAGER_VIEWS: readonly ManagerView[] = [
  "library",
  "prompts",
  "workflows",
  "clipboard",
  "overview",
  "settings",
];

export function isManagerView(value: unknown): value is ManagerView {
  return (
    typeof value === "string" &&
    (MANAGER_VIEWS as readonly string[]).includes(value)
  );
}
