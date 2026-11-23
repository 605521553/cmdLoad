import {
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useUpdateStore } from "./updateStore";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return "未知大小";
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UpdateDialog() {
  const status = useUpdateStore((state) => state.status);
  const update = useUpdateStore((state) => state.update);
  const configuration = useUpdateStore((state) => state.configuration);
  const dialogOpen = useUpdateStore((state) => state.dialogOpen);
  const progress = useUpdateStore((state) => state.progress);
  const downloadedBytes = useUpdateStore((state) => state.downloadedBytes);
  const totalBytes = useUpdateStore((state) => state.totalBytes);
  const error = useUpdateStore((state) => state.error);
  const check = useUpdateStore((state) => state.check);
  const install = useUpdateStore((state) => state.install);
  const closeDialog = useUpdateStore((state) => state.closeDialog);

  if (!dialogOpen) {
    return null;
  }

  const busy = status === "downloading" || status === "installing";
  const isUpdate = status === "available" || status === "downloading" || status === "installing";
  const publishedAt = formatDate(update?.date);
  const percent =
    progress === null ? null : Math.max(0, Math.min(100, Math.round(progress * 100)));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          closeDialog();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-window"
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
          <span className="flex size-6 items-center justify-center rounded-md border border-line bg-canvas text-ink-faint">
            {status === "up-to-date" ? (
              <CheckCircle2 className="size-3.5 text-success" />
            ) : status === "error" ? (
              <RefreshCw className="size-3.5 text-danger" />
            ) : (
              <Download className="size-3.5" />
            )}
          </span>
          <h2
            id="update-dialog-title"
            className="text-[13px] font-semibold text-ink"
          >
            {status === "up-to-date"
              ? "已是最新版本"
              : status === "error"
                ? "检查更新失败"
                : status === "checking"
                  ? "正在检查更新"
                  : status === "installing"
                    ? "正在安装更新"
                    : status === "downloading"
                      ? "正在下载更新"
                      : "发现新版本"}
          </h2>
          <button
            type="button"
            onClick={closeDialog}
            disabled={busy}
            aria-label="关闭更新对话框"
            className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-40"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {status === "checking" ? (
            <div className="flex items-center gap-2 py-6 text-[12px] text-ink-muted">
              <LoaderCircle className="size-4 animate-spin text-ink-faint" />
              正在连接更新服务器，请稍候…
            </div>
          ) : status === "error" ? (
            <div className="space-y-3">
              <p className="rounded border border-danger/20 bg-danger-soft px-2.5 py-2 text-[11.5px] leading-[1.6] text-danger">
                {error ?? "暂时无法检查更新。"}
              </p>
              <p className="text-[10.5px] leading-4 text-ink-faint">
                可以稍后重试；已安装的版本和数据不会受影响。
              </p>
            </div>
          ) : status === "up-to-date" ? (
            <div className="space-y-2 py-3">
              <p className="text-[12px] text-ink">
                当前版本 v
                {update?.currentVersion ??
                  configuration?.currentVersion ??
                  "—"}{" "}
                已经是最新版本。
              </p>
              <p className="text-[10.5px] leading-4 text-ink-faint">
                再次检查前可以继续正常使用应用。
              </p>
            </div>
          ) : isUpdate && update ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] font-semibold tracking-tight text-ink">
                  v{update.version}
                </span>
                <span className="text-[10.5px] text-ink-faint">
                  当前 v{update.currentVersion}
                </span>
                {publishedAt ? (
                  <span className="ml-auto text-[9.5px] text-ink-faint">
                    {publishedAt}
                  </span>
                ) : null}
              </div>

              <div className="rounded-md border border-line bg-canvas px-2.5 py-2">
                <p className="ui-eyebrow mb-1">更新内容</p>
                <pre className="max-h-[190px] overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-[1.65] text-ink-muted">
                  {update.body?.trim() || "本次更新没有提供详细说明。"}
                </pre>
              </div>

              {status === "downloading" || status === "installing" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-ink-muted">
                    <span>
                      {status === "installing"
                        ? "下载完成，正在安装…"
                        : "正在下载更新…"}
                    </span>
                    <span className="tabular-nums">
                      {percent === null ? "" : `${percent}%`}
                      {totalBytes > 0
                        ? ` · ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                        : ""}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand transition-[width] duration-200"
                      style={{
                        width:
                          status === "installing"
                            ? "100%"
                            : `${percent ?? 8}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              <p className="flex items-start gap-1.5 text-[10px] leading-4 text-ink-faint">
                <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success" />
                安装包会用内置公钥校验签名；更新不会删除命令、提示词或设置。安装完成后应用会自动重启。
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          {status === "error" ? (
            <>
              <Button variant="ghost" size="sm" onClick={closeDialog}>
                关闭
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void check()}
              >
                <RefreshCw />
                重试
              </Button>
            </>
          ) : status === "up-to-date" ? (
            <Button variant="primary" size="sm" onClick={closeDialog}>
              知道了
            </Button>
          ) : status === "checking" ? (
            <Button variant="ghost" size="sm" onClick={closeDialog}>
              关闭
            </Button>
          ) : isUpdate ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                稍后
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void install()}
                disabled={busy}
              >
                {status === "installing" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Download />
                )}
                {status === "downloading"
                  ? "下载中…"
                  : status === "installing"
                    ? "安装中…"
                    : "下载并安装"}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
