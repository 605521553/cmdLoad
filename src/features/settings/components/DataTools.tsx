import {
  Archive,
  Download,
  FileJson,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { SettingRow } from "@/features/settings/components/SettingRow";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { BackupInfo, ImportMode } from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";

interface PendingImport {
  fileName: string;
  json: string;
  commandCount: number;
  categoryCount: number;
  tagCount: number;
  promptCount: number;
  promptCategoryCount: number;
  schemaVersion: number | string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: number): string {
  if (!value) {
    return "未知时间";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DataTools({ databasePath }: { databasePath: string }) {
  const showNotice = useAppStore((state) => state.showNotice);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBackups = useCallback(async () => {
    setLoadingBackups(true);
    try {
      setBackups(await appApi.listDatabaseBackups());
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setLoadingBackups(false);
    }
  }, [showNotice]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const copyPath = async () => {
    try {
      await appApi.copyClipboardText(databasePath);
      showNotice({ kind: "success", message: "数据库路径已复制" });
    } catch {
      showNotice({ kind: "error", message: "无法复制路径，请手动选择。" });
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      const backup = await appApi.createDatabaseBackup();
      await loadBackups();
      showNotice({
        kind: "success",
        message: `数据库备份已创建：${backup.fileName}`,
      });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (!restoreTarget) {
      return;
    }
    setRestoring(true);
    try {
      const report = await appApi.restoreDatabaseBackup(restoreTarget.fileName);
      setRestoreTarget(null);
      await loadBackups();
      showNotice({
        kind: "success",
        message: `已恢复 ${report.commands} 条命令、${report.categories} 个目录、${report.prompts} 条提示词。恢复前数据库已备份为 ${report.preRestoreBackup.split(/[\\/]/).pop() ?? "新备份"}。`,
      });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setRestoring(false);
    }
  };

  const exportJson = async () => {
    setExporting(true);
    try {
      const path = await appApi.exportLibraryFile();
      setLastExport(path);
      showNotice({
        kind: "success",
        message: `命令库已导出到 ${path}`,
      });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  const readImportFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const json = await file.text();
      const parsed = JSON.parse(json) as {
        schemaVersion?: number | string;
        commands?: unknown[];
        categories?: unknown[];
        tags?: unknown[];
        prompts?: unknown[];
        promptCategories?: unknown[];
      };
      setPendingImport({
        fileName: file.name,
        json,
        commandCount: Array.isArray(parsed.commands) ? parsed.commands.length : 0,
        categoryCount: Array.isArray(parsed.categories)
          ? parsed.categories.length
          : 0,
        tagCount: Array.isArray(parsed.tags) ? parsed.tags.length : 0,
        promptCount: Array.isArray(parsed.prompts) ? parsed.prompts.length : 0,
        promptCategoryCount: Array.isArray(parsed.promptCategories)
          ? parsed.promptCategories.length
          : 0,
        schemaVersion: parsed.schemaVersion ?? "缺失",
      });
      setImportMode("merge");
      setImportError(null);
    } catch (error) {
      showNotice({
        kind: "error",
        message: `无法读取 JSON 文件：${getUserErrorMessage(error)}`,
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const runImport = async () => {
    if (!pendingImport) {
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const report = await appApi.importLibraryJson(
        pendingImport.json,
        importMode,
      );
      setPendingImport(null);
      await loadBackups();
      const skipped =
        report.commandsSkipped > 0
          ? `，跳过 ${report.commandsSkipped} 条已存在命令`
          : "";
      const promptSkipped =
        report.promptsSkipped > 0
          ? `，跳过 ${report.promptsSkipped} 条已存在提示词`
          : "";
      showNotice({
        kind: "success",
        message: `${report.mode === "replace" ? "完整恢复" : "合并导入"}完成：新增 ${report.commandsAdded} 条命令、${report.categoriesAdded} 个目录、${report.tagsAdded} 个标签、${report.promptsAdded} 条提示词、${report.promptCategoriesAdded} 个提示词目录${skipped}${promptSkipped}。`,
      });
    } catch (error) {
      setImportError(getUserErrorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <SettingRow
        title="命令数据库"
        description={
          <span className="selectable break-all font-mono text-[10px] leading-4">
            {databasePath}
          </span>
        }
      >
        <Button variant="ghost" size="sm" onClick={() => void copyPath()}>
          复制路径
        </Button>
      </SettingRow>

      <SettingRow
        title="导出 JSON"
        description={
          <span>
            带版本号的完整命令、提示词、目录和标签数据，保存到系统下载目录。
            {lastExport ? (
              <span className="mt-0.5 block break-all font-mono text-[9.5px] text-ink-faint">
                {lastExport}
              </span>
            ) : null}
          </span>
        }
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void exportJson()}
          disabled={exporting}
        >
          <Download />
          {exporting ? "导出中…" : "导出"}
        </Button>
      </SettingRow>

      <SettingRow
        title="导入 JSON"
        description="先选择文件，再决定合并导入或完整恢复；导入前会自动备份当前数据库。旧版命令 JSON 仍可导入，且不会删除现有提示词库。"
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload />
          选择文件
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => void readImportFile(event.target.files?.[0])}
        />
      </SettingRow>

      <SettingRow
        title="数据库备份"
        description="SQLite 一致性备份保存在应用数据目录的 backups 文件夹。"
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void createBackup()}
          disabled={backupBusy}
        >
          <Archive />
          {backupBusy ? "备份中…" : "立即备份"}
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => void loadBackups()}
          disabled={loadingBackups}
          aria-label="刷新备份列表"
          title="刷新备份列表"
        >
          <RefreshCw className={loadingBackups ? "animate-spin" : undefined} />
        </Button>
      </SettingRow>

      <div className="border-b border-line/70 py-2.5">
        <div className="mb-1.5 flex items-center text-[10.5px] text-ink-faint">
          <span>最近备份</span>
          <span className="ml-auto">{backups.length} 个</span>
        </div>
        {backups.length === 0 ? (
          <p className="rounded border border-dashed border-line px-2.5 py-2 text-[11px] text-ink-faint">
            暂无备份
          </p>
        ) : (
          <div className="max-h-[160px] overflow-y-auto rounded border border-line">
            {backups.map((backup) => (
              <div
                key={backup.fileName}
                className="flex items-center gap-2 border-b border-line/60 px-2 py-1.5 text-[10.5px] last:border-b-0"
              >
                <FileJson className="size-3.5 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[10px] text-ink-muted">
                    {backup.fileName}
                  </p>
                  <p className="text-[9.5px] text-ink-faint">
                    {formatTime(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRestoreTarget(backup)}
                >
                  恢复
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        title="恢复数据库备份"
        description={
          restoreTarget ? (
            <>
              将用备份「{restoreTarget.fileName}」替换当前命令库。应用会先自动备份当前数据库；恢复会放在单个事务中，失败则保留现有数据。
            </>
          ) : null
        }
        confirmLabel="恢复此备份"
        danger
        busy={restoring}
        onConfirm={() => void restoreBackup()}
        onClose={() => {
          if (!restoring) {
            setRestoreTarget(null);
          }
        }}
      />

      {pendingImport ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !importing) {
              setPendingImport(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-dialog-title"
            className="w-full max-w-[440px] rounded-lg border border-line bg-surface shadow-window"
          >
            <div className="flex h-10 items-center border-b border-line px-3.5">
              <h2
                id="import-dialog-title"
                className="text-[13px] font-semibold text-ink"
              >
                导入命令库
              </h2>
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                disabled={importing}
                className="ml-auto rounded p-1 text-ink-faint hover:bg-muted hover:text-ink disabled:opacity-50"
                aria-label="关闭导入对话框"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="space-y-3 px-3.5 py-3">
              <div className="rounded border border-line bg-canvas px-2.5 py-2 text-[11px] text-ink-muted">
                <p className="truncate font-medium text-ink">
                  {pendingImport.fileName}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-faint">
                  JSON 版本 {String(pendingImport.schemaVersion)} ·{" "}
                  {pendingImport.commandCount} 条命令 ·{" "}
                  {pendingImport.categoryCount} 个目录 ·{" "}
                  {pendingImport.tagCount} 个标签 ·{" "}
                  {pendingImport.promptCount} 条提示词 ·{" "}
                  {pendingImport.promptCategoryCount} 个提示词目录
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-2 rounded border border-line px-2.5 py-2">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === "merge"}
                  onChange={() => setImportMode("merge")}
                  className="mt-0.5 accent-[var(--brand)]"
                />
                <span>
                  <span className="block text-[12px] font-medium text-ink">
                    合并导入
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-muted">
                    保留现有数据，新增不存在的命令和提示词；相同 ID 或严格相同提示词正文会跳过。
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2 rounded border border-danger/25 bg-danger-soft/40 px-2.5 py-2">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                  className="mt-0.5 accent-[var(--color-danger)]"
                />
                <span>
                  <span className="block text-[12px] font-medium text-ink">
                    完整恢复（替换当前命令库）
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-muted">
                    清空当前命令、目录、标签和提示词后导入。schema 1–3 的旧文件只替换命令库，保留现有提示词库；导入前自动备份，任何失败都会回滚。
                  </span>
                </span>
              </label>

              {importError ? (
                <p className="text-[11px] leading-4 text-danger" role="alert">
                  {importError}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-3.5 py-2.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingImport(null)}
                disabled={importing}
              >
                取消
              </Button>
              <Button
                variant={importMode === "replace" ? "danger" : "primary"}
                size="sm"
                onClick={() => void runImport()}
                disabled={importing}
              >
                {importing
                  ? "导入中…"
                  : importMode === "replace"
                    ? "确认完整恢复"
                    : "确认合并导入"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
