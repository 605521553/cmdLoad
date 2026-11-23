import { ClipboardList, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { ClipboardItemActions } from "@/features/clipboard/ClipboardItemActions";
import { SensitiveClipboardDialog } from "@/features/clipboard/SensitiveClipboardDialog";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { ClipboardItem, ClipboardState } from "@/types/app";
import {
  getUserErrorMessage,
  toAppCommandError,
} from "@/utils/errors";
import { formatRelativeTime } from "@/utils/time";

function normalize(value: string): string {
  return value.toLocaleLowerCase();
}

export function ClipboardPage() {
  const clipboardRevision = useAppStore((state) => state.clipboardRevision);
  const dataRevision = useAppStore((state) => state.dataRevision);
  const requestCommandDetail = useAppStore(
    (state) => state.requestCommandDetail,
  );
  const showNotice = useAppStore((state) => state.showNotice);
  const [state, setState] = useState<ClipboardState | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingPromptKey, setSavingPromptKey] = useState<string | null>(null);
  const [copyingKey, setCopyingKey] = useState<string | null>(null);
  const [sensitiveItem, setSensitiveItem] = useState<ClipboardItem | null>(
    null,
  );
  const [sensitiveMode, setSensitiveMode] = useState<"command" | "prompt">(
    "command",
  );

  useEffect(() => {
    let cancelled = false;
    appApi
      .getClipboardState()
      .then((result) => {
        if (!cancelled) {
          setState(result);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(getUserErrorMessage(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clipboardRevision, dataRevision]);

  const localItems = useMemo(() => {
    const items = state?.localItems ?? [];
    const needle = normalize(query.trim());
    if (!needle) {
      return items;
    }
    return items.filter((item) => normalize(item.content).includes(needle));
  }, [state?.localItems, query]);

  const openSavedCommand = (id: string) => {
    requestCommandDetail(id);
  };

  const markSaved = (
    item: ClipboardItem,
    content: string,
    command: { id: string; isFavorite: boolean },
  ): ClipboardItem =>
    item.content === content
      ? {
          ...item,
          savedCommandId: command.id,
          savedCommandIsFavorite: command.isFavorite,
        }
      : item;

  const saveItem = async (item: ClipboardItem, allowSensitive = false) => {
    if (item.savedCommandId) {
      openSavedCommand(item.savedCommandId);
      return;
    }
    if (item.isSensitive && !allowSensitive) {
      setSensitiveMode("command");
      setSensitiveItem(item);
      return;
    }
    setSavingKey(item.key);
    try {
      const result = await appApi.saveClipboardText({
        content: item.content,
        source: item.source,
        allowSensitive,
      });
      setState((current) =>
        current
          ? {
              ...current,
              current: current.current
                ? markSaved(current.current, item.content, result.command)
                : null,
              localItems: current.localItems.map((candidate) =>
                markSaved(candidate, item.content, result.command),
              ),
            }
          : current,
      );
      setSensitiveItem(null);
      showNotice({
        kind: "success",
        message: result.created
          ? "已保存到命令库的“默认”目录"
          : "该命令已在命令库中（默认目录）",
      });
    } catch (saveError) {
      const appError = toAppCommandError(saveError);
      if (appError.code === "SENSITIVE_CONTENT" && !allowSensitive) {
        setSensitiveMode("command");
        setSensitiveItem(item);
      } else {
        showNotice({ kind: "error", message: appError.message });
      }
    } finally {
      setSavingKey(null);
    }
  };

  const saveItemAsPrompt = async (
    item: ClipboardItem,
    allowSensitive = false,
  ) => {
    if (item.isSensitive && !allowSensitive) {
      setSensitiveMode("prompt");
      setSensitiveItem(item);
      return;
    }
    setSavingPromptKey(item.key);
    try {
      const result = await appApi.saveClipboardAsPrompt(
        item.content,
        allowSensitive,
      );
      setSensitiveItem(null);
      showNotice({
        kind: "success",
        message: result.created
          ? "已保存到提示词库的“默认”目录"
          : "该提示词已在提示词库中（默认目录）",
      });
    } catch (saveError) {
      const appError = toAppCommandError(saveError);
      if (appError.code === "SENSITIVE_CONTENT" && !allowSensitive) {
        setSensitiveMode("prompt");
        setSensitiveItem(item);
      } else {
        showNotice({ kind: "error", message: appError.message });
      }
    } finally {
      setSavingPromptKey(null);
    }
  };

  const copyItem = async (item: ClipboardItem) => {
    if (copyingKey) {
      return;
    }
    setCopyingKey(item.key);
    try {
      await appApi.copyClipboardText(item.content);
      showNotice({ kind: "success", message: "已复制剪贴板内容" });
    } catch (copyError) {
      showNotice({ kind: "error", message: getUserErrorMessage(copyError) });
    } finally {
      setCopyingKey(null);
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
    } catch (clearError) {
      showNotice({ kind: "error", message: getUserErrorMessage(clearError) });
    } finally {
      setClearing(false);
    }
  };

  const current = state?.current ?? null;
  const hasQuery = query.trim().length > 0;

  const renderActions = (item: ClipboardItem) => (
    <ClipboardItemActions
      item={item}
      saving={savingKey === item.key}
      savingPrompt={savingPromptKey === item.key}
      copying={copyingKey === item.key}
      onSave={() => void saveItem(item)}
      onSaveAsPrompt={() => void saveItemAsPrompt(item)}
      onCopy={() => void copyItem(item)}
      onOpenSaved={() => {
        if (item.savedCommandId) {
          openSavedCommand(item.savedCommandId);
        }
      }}
    />
  );

  return (
    <section aria-labelledby="clipboard-heading">
      <h1 id="clipboard-heading" className="sr-only">
        剪贴板
      </h1>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          placeholder="搜索剪贴板历史…"
          aria-label="搜索剪贴板历史"
          className="h-8 w-full max-w-[320px]"
        />
        <span className="text-[10.5px] text-ink-faint">
          {state ? `${localItems.length} / ${state.localHistoryCount} 条` : "读取中…"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={clearing || (state?.localHistoryCount ?? 0) === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 />
            清空本地历史
          </Button>
        </div>
      </div>

      <p className="mb-3 text-[11.5px] leading-4 text-ink-muted">
        临时历史与永久命令库相互独立。点击“保存”会把完整原文写入命令库的“默认”目录；保存按钮旁的下拉菜单可以改为保存到提示词库。两种保存都不打开编辑表单。
      </p>

      {error ? (
        <p className="mb-3 rounded border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="mb-3 rounded-lg border border-line bg-surface">
        <div className="flex h-9 items-center gap-2 border-b border-line px-3">
          <h2 className="text-[12.5px] font-medium text-ink">当前剪贴板</h2>
          {current ? (
            <span className="rounded border border-line bg-canvas px-1 py-px text-[9px] text-ink-faint">
              实时读取
            </span>
          ) : null}
          <div className="ml-auto">{current ? renderActions(current) : null}</div>
        </div>
        <div className="px-3 py-2.5">
          {state?.currentError ? (
            <p className="text-[11.5px] leading-4 text-danger">
              {state.currentError}
            </p>
          ) : current ? (
            <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[12.5px] leading-[1.5] text-ink">
              {current.content}
            </pre>
          ) : (
            <p className="text-[11.5px] text-ink-faint">没有可读取的文本</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="rounded-lg border border-line bg-surface">
          <div className="flex h-9 items-center border-b border-line px-3">
            <h2 className="text-[12.5px] font-medium text-ink">本地最近记录</h2>
            <span className="ml-auto text-[10.5px] text-ink-faint">
              {state ? `${localItems.length} 条` : "读取中…"}
            </span>
          </div>
          {state && localItems.length > 0 ? (
            <ul className="divide-y divide-line/70">
              {localItems.map((item) => (
                <li key={item.key} className="px-3 py-2.5">
                  <div className="flex items-start gap-3">
                    <pre
                      className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px] leading-[1.5] text-ink-muted"
                      title={item.content}
                    >
                      {item.content}
                    </pre>
                    {renderActions(item)}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                    <span>{formatRelativeTime(item.copiedAt)}</span>
                    {item.isSensitive ? (
                      <span className="rounded border border-danger/20 bg-danger-soft px-1 py-px text-[9px] text-danger">
                        敏感
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : state && hasQuery ? (
            <EmptyState
              compact
              icon={<ClipboardList className="size-4" />}
              title="没有匹配的历史记录"
              description="换个关键词，或清空搜索。"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setQuery("")}
                >
                  清空搜索
                </Button>
              }
            />
          ) : (
            <EmptyState
              compact
              icon={<ClipboardList className="size-4" />}
              title={state ? "暂无本地剪贴板记录" : "正在读取剪贴板…"}
              description={
                state
                  ? "复制一段命令后，快捷面板会立即展示它。"
                  : "请稍候。"
              }
            />
          )}
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-line bg-surface p-3">
            <h2 className="text-[12.5px] font-medium text-ink">监听状态</h2>
            <dl className="mt-2 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">本地监听</dt>
                <dd className="text-ink">
                  {state
                    ? state.localHistoryEnabled
                      ? "已开启"
                      : "已关闭"
                    : "读取中…"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">本地记录</dt>
                <dd className="text-ink">{state?.localHistoryCount ?? 0} 条</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-muted">永久命令</dt>
                <dd className="text-ink-faint">不受清理影响</dd>
              </div>
            </dl>
          </div>
          {state?.monitorWarning ? (
            <p className="rounded border border-amber/30 bg-amber-soft px-2.5 py-2 text-[10.5px] leading-4 text-amber">
              {state.monitorWarning}
            </p>
          ) : null}
          <p className="text-[10px] leading-4 text-ink-faint">
            当前剪贴板与本地历史可直接保存或复制。Windows 系统历史仍在快捷面板中只读展示，本页不会修改它。
          </p>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清空本地剪贴板历史？"
        description="将删除本应用缓存的临时文本，不会删除命令库中的永久命令，也不会修改 Windows 系统剪贴板历史。"
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

      <SensitiveClipboardDialog
        item={sensitiveItem}
        busy={savingKey !== null || savingPromptKey !== null}
        onConfirm={() => {
          if (sensitiveItem) {
            if (sensitiveMode === "prompt") {
              void saveItemAsPrompt(sensitiveItem, true);
            } else {
              void saveItem(sensitiveItem, true);
            }
          }
        }}
        onClose={() => {
          if (!savingKey && !savingPromptKey) {
            setSensitiveItem(null);
          }
        }}
      />
    </section>
  );
}
