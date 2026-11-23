import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { ClipboardStatus, SettingsPatch } from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";
import { SettingRow } from "./SettingRow";
import { SettingsSection } from "./SettingsSection";

type PendingField = "enabled" | "limit" | "retention" | "hide" | null;

const LIMIT_OPTIONS = [25, 50, 100, 200, 500];
const RETENTION_OPTIONS = [1, 3, 7, 14, 30, 90];

export function ClipboardSettings() {
  const snapshot = useAppStore((state) => state.snapshot);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const showNotice = useAppStore((state) => state.showNotice);
  const [status, setStatus] = useState<ClipboardStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [pending, setPending] = useState<PendingField>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const refreshStatus = () => {
    setStatusLoading(true);
    appApi
      .getClipboardStatus()
      .then(setStatus)
      .catch((error) => {
        showNotice({ kind: "error", message: getUserErrorMessage(error) });
      })
      .finally(() => setStatusLoading(false));
  };

  useEffect(() => {
    refreshStatus();
    // Only load once when the settings screen mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = snapshot?.settings;
  const limitOptions = useMemo(() => {
    const current = settings?.clipboardHistoryLimit ?? 100;
    return [...new Set([...LIMIT_OPTIONS, current])].sort((a, b) => a - b);
  }, [settings?.clipboardHistoryLimit]);
  const retentionOptions = useMemo(() => {
    const current = settings?.clipboardHistoryRetentionDays ?? 7;
    return [...new Set([...RETENTION_OPTIONS, current])].sort((a, b) => a - b);
  }, [settings?.clipboardHistoryRetentionDays]);

  if (!settings) {
    return null;
  }

  const persist = async (
    field: Exclude<PendingField, null>,
    patch: SettingsPatch,
    message: string,
  ) => {
    setPending(field);
    try {
      await updateSettings(patch);
      showNotice({ kind: "success", message });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      const result = await appApi.clearClipboardHistory();
      setConfirmClear(false);
      showNotice({
        kind: "success",
        message:
          result.removed > 0
            ? `已清空 ${result.removed} 条本地剪贴板历史`
            : "本地剪贴板历史已经是空的",
      });
      refreshStatus();
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setClearing(false);
    }
  };

  const controlsDisabled = pending !== null || clearing;
  const systemStatus = status?.systemHistoryStatus;
  const systemLabel = statusLoading
    ? "读取中"
    : systemStatus === "available"
      ? "已启用"
      : systemStatus === "disabled"
        ? "系统未启用"
        : systemStatus === "access_denied"
          ? "无法访问"
          : systemStatus === "unsupported"
            ? "不可用"
            : "读取失败";
  const systemTone =
    systemStatus === "available"
      ? "success"
      : systemStatus === "disabled"
        ? "neutral"
        : "warning";

  return (
    <>
      <SettingsSection
        title="剪贴板"
        description="从剪贴板一键收藏命令。本地历史只保存在这台电脑的 SQLite 中，不会自动加入命令库。"
      >
        <SettingRow
          title="本地剪贴板监听"
          description="后台使用 Windows AddClipboardFormatListener 记录最近复制的文本。关闭后停止新增记录，已有记录仍可查看和清理。"
        >
          <Switch
            checked={settings.clipboardMonitoringEnabled}
            disabled={controlsDisabled}
            onCheckedChange={(checked) =>
              void persist(
                "enabled",
                { clipboardMonitoringEnabled: checked },
                checked ? "已开启本地剪贴板监听" : "已关闭本地剪贴板监听",
              )
            }
            aria-label="本地剪贴板监听"
          />
        </SettingRow>

        <SettingRow
          title="历史缓存上限"
          description="超过上限时自动删除最旧的临时记录；默认 100 条。"
        >
          <select
            value={settings.clipboardHistoryLimit}
            disabled={controlsDisabled}
            onChange={(event) =>
              void persist(
                "limit",
                { clipboardHistoryLimit: Number(event.target.value) },
                "已更新本地历史缓存上限",
              )
            }
            className="h-7 rounded-md border border-line bg-surface px-2 text-[11px] text-ink outline-none hover:border-line-strong focus:border-ink-faint"
            aria-label="本地剪贴板历史缓存上限"
          >
            {limitOptions.map((limit) => (
              <option key={limit} value={limit}>
                {limit} 条
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          title="保存期限"
          description="超过保留天数的本地临时记录会自动清理。"
        >
          <select
            value={settings.clipboardHistoryRetentionDays}
            disabled={controlsDisabled}
            onChange={(event) =>
              void persist(
                "retention",
                { clipboardHistoryRetentionDays: Number(event.target.value) },
                "已更新本地历史保存期限",
              )
            }
            className="h-7 rounded-md border border-line bg-surface px-2 text-[11px] text-ink outline-none hover:border-line-strong focus:border-ink-faint"
            aria-label="本地剪贴板历史保存期限"
          >
            {retentionOptions.map((days) => (
              <option key={days} value={days}>
                {days} 天
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          title="敏感内容过滤"
          description="密码、Token、私钥等疑似内容不会写入本地历史；从当前剪贴板保存时会要求二次确认。"
        >
          <span className="rounded border border-line bg-muted px-1.5 py-0.5 text-[10.5px] text-ink-muted">
            始终启用
          </span>
        </SettingRow>

        <SettingRow
          title="Windows 系统剪贴板历史"
          description={
            status?.systemHistoryMessage ??
            "通过 Windows 官方 WinRT Clipboard API 只读访问，不修改或删除系统历史。"
          }
        >
          <span className="flex items-center gap-1.5 text-[10.5px] text-ink-muted">
            {statusLoading ? (
              <span className="text-ink-faint">读取中…</span>
            ) : (
              <>
                <StatusDot tone={systemTone} />
                {systemLabel}
              </>
            )}
          </span>
        </SettingRow>

        <SettingRow
          title="复制后自动隐藏快捷面板"
          description="从快捷面板复制命令或剪贴板内容后收起面板；保存操作不会收起。"
        >
          <Switch
            checked={settings.hideQuickPanelAfterCopy}
            disabled={controlsDisabled}
            onCheckedChange={(checked) =>
              void persist(
                "hide",
                { hideQuickPanelAfterCopy: checked },
                checked
                  ? "复制后将自动隐藏快捷面板"
                  : "复制后保持快捷面板打开",
              )
            }
            aria-label="复制后自动隐藏快捷面板"
          />
        </SettingRow>

        <SettingRow
          title="清空本地剪贴板历史"
          description="只删除本应用缓存的临时文本，不删除永久命令，也不修改 Windows 系统历史。"
        >
          <span className="mr-1 text-[10.5px] text-ink-faint">
            {status ? `${status.localHistoryCount} 条` : "—"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={controlsDisabled || (status?.localHistoryCount ?? 0) === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 />
            清空
          </Button>
        </SettingRow>
      </SettingsSection>

      <ConfirmDialog
        open={confirmClear}
        title="清空本地剪贴板历史？"
        description="将删除本应用缓存的临时剪贴板文本。永久命令和 Windows 系统剪贴板历史不会被删除。"
        confirmLabel="清空本地历史"
        danger
        busy={clearing}
        onConfirm={() => void clearHistory()}
        onClose={() => {
          if (!clearing) {
            setConfirmClear(false);
          }
        }}
      />
    </>
  );
}
