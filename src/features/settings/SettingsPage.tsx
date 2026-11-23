import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { AiSettings } from "@/features/settings/components/AiSettings";
import { ClipboardSettings } from "@/features/settings/components/ClipboardSettings";
import { DataTools } from "@/features/settings/components/DataTools";
import { HotkeyRecorder } from "@/features/settings/components/HotkeyRecorder";
import { SettingRow } from "@/features/settings/components/SettingRow";
import { SettingsSection } from "@/features/settings/components/SettingsSection";
import { ThemePicker } from "@/features/settings/components/ThemePicker";
import { UpdateSettings } from "@/features/settings/components/UpdateSettings";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { SettingsPatch, ThemePreference } from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";

const DEFAULT_SIDEBAR_WIDTH = 172;

type PendingField =
  | "shortcut"
  | "autostart"
  | "autoHide"
  | "theme"
  | "sidebar"
  | null;

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-line bg-muted px-1.5 py-0.5 text-[10.5px] text-ink-muted">
      {children}
    </span>
  );
}

export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const refreshSnapshot = useAppStore((state) => state.refreshSnapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const quitApp = useAppStore((state) => state.quitApp);

  const [pending, setPending] = useState<PendingField>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  if (!snapshot) {
    return null;
  }

  const persist = async (
    field: Exclude<PendingField, null>,
    patch: SettingsPatch,
    successMessage: string,
  ) => {
    setPending(field);
    try {
      await updateSettings(patch);
      showNotice({ kind: "success", message: successMessage });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const applyShortcut = async (shortcut: string) => {
    setPending("shortcut");
    try {
      const updated = await updateSettings({ shortcut });
      if (!updated.shortcut.registered) {
        throw new Error(
          updated.shortcut.error ?? "快捷键未能注册，请尝试其他组合。",
        );
      }
      showNotice({ kind: "success", message: "全局快捷键已更新" });
    } finally {
      setPending(null);
    }
  };

  const copyPath = async () => {
    try {
      await appApi.copyClipboardText(snapshot.settingsPath);
      showNotice({ kind: "success", message: "设置文件路径已复制" });
    } catch {
      showNotice({ kind: "error", message: "无法复制路径，请手动选择。" });
    }
  };

  const controlsDisabled = pending !== null;
  const sidebarCanReset =
    snapshot.settings.sidebarWidth !== DEFAULT_SIDEBAR_WIDTH;

  return (
    <div className="animate-content-in mx-auto w-full max-w-[640px]">
      <div className="mb-4 border-b border-line pb-3">
        <h1 className="sr-only">设置</h1>
        <p className="text-[12px] text-ink-muted">
          偏好保存在本机。修改会立即生效并自动保存。
        </p>
      </div>

      <div className="space-y-5">
        <SettingsSection title="通用">
          <SettingRow
            title="开机自动启动"
            description="登录 Windows 后在后台运行，不主动打开窗口。"
          >
            <span className="mr-1 text-[10.5px] text-ink-faint">
              {snapshot.autostartEnabled ? "已开启" : "已关闭"}
            </span>
            <Switch
              checked={snapshot.autostartEnabled}
              disabled={controlsDisabled}
              onCheckedChange={(checked) =>
                void persist(
                  "autostart",
                  { launchAtStartup: checked },
                  checked ? "已开启开机自动启动" : "已关闭开机自动启动",
                )
              }
              aria-label="开机自动启动"
            />
          </SettingRow>

          <SettingRow
            title="关闭窗口"
            description="关闭主窗口时继续在系统托盘中运行。完全退出请使用下方退出操作。"
          >
            <StatusPill>隐藏到托盘</StatusPill>
          </SettingRow>
        </SettingsSection>

        <SettingsSection title="软件更新">
          <UpdateSettings />
        </SettingsSection>

        <SettingsSection title="窗口与快捷键">
          <HotkeyRecorder
            key={`${snapshot.settings.shortcut}:${snapshot.shortcut.registered}`}
            currentShortcut={snapshot.settings.shortcut}
            registered={snapshot.shortcut.registered}
            disabled={controlsDisabled}
            onSave={applyShortcut}
          />

          <SettingRow
            title="侧栏宽度"
            description="拖动侧栏右边缘调整；双击分隔线恢复默认宽度。"
          >
            <span className="font-mono text-[10.5px] text-ink-muted">
              {snapshot.settings.sidebarWidth}px
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={controlsDisabled || !sidebarCanReset}
              onClick={() =>
                void persist("sidebar", { sidebarWidth: DEFAULT_SIDEBAR_WIDTH }, "已恢复默认侧栏宽度")
              }
            >
              重置
            </Button>
          </SettingRow>

          <SettingRow
            title="快捷面板失焦后自动隐藏"
            description="切换到其他窗口时收起快捷面板；拖动和托盘操作不会误触发。"
          >
            <Switch
              checked={snapshot.settings.autoHideQuickPanel}
              disabled={controlsDisabled}
              onCheckedChange={(checked) =>
                void persist(
                  "autoHide",
                  { autoHideQuickPanel: checked },
                  checked ? "已开启失焦自动隐藏" : "已关闭失焦自动隐藏",
                )
              }
              aria-label="快捷面板失焦时自动隐藏"
            />
          </SettingRow>
        </SettingsSection>

        <ClipboardSettings />

        <SettingsSection title="外观">
          <SettingRow
            title="主题"
            description="跟随系统，或固定使用浅色 / 深色外观。"
          >
            <ThemePicker
              value={snapshot.settings.theme}
              disabled={controlsDisabled}
              onChange={(theme: ThemePreference) =>
                void persist(
                  "theme",
                  { theme },
                  theme === "system"
                    ? "已切换为跟随系统主题"
                    : theme === "dark"
                      ? "已切换为深色主题"
                      : "已切换为浅色主题",
                )
              }
            />
          </SettingRow>
        </SettingsSection>

        <AiSettings />

        <SettingsSection title="数据与备份">
          <SettingRow
            title="设置文件"
            description={
              <span className="selectable break-all font-mono text-[10px] leading-4">
                {snapshot.settingsPath}
              </span>
            }
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyPath()}
              title="复制设置文件路径"
            >
              <Copy />
              复制
            </Button>
          </SettingRow>

          <DataTools databasePath={snapshot.databasePath} />

          <SettingRow
            title="完全退出"
            description="停止全局快捷键与托盘服务。设置和本地数据不会删除。"
          >
            {confirmQuit ? (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void quitApp()}
                >
                  确认退出
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmQuit(false)}
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmQuit(true)}
              >
                <ExternalLink />
                退出
              </Button>
            )}
          </SettingRow>
        </SettingsSection>
      </div>

      <p className="mt-6 border-t border-line pt-3 text-[10px] leading-4 text-ink-faint">
        v{snapshot.version} · 本地设置自动保存
      </p>
    </div>
  );
}
