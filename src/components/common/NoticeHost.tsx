import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { cn } from "@/utils/cn";

export function NoticeHost() {
  const notice = useAppStore((state) => state.notice);
  const clearNotice = useAppStore((state) => state.clearNotice);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(
      clearNotice,
      notice.kind === "error" ? 5000 : notice.actionLabel ? 7000 : 2400,
    );
    return () => window.clearTimeout(timeout);
  }, [notice, clearNotice]);

  if (!notice) {
    return null;
  }

  const Icon =
    notice.kind === "success"
      ? CheckCircle2
      : notice.kind === "error"
        ? AlertCircle
        : Info;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2.5 z-50 flex justify-center px-3">
      <div
        role={notice.kind === "error" ? "alert" : "status"}
        className={cn(
          "animate-toast-in pointer-events-auto flex max-w-md items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-popover",
          notice.kind === "success" && "border-success/30 bg-surface text-ink",
          notice.kind === "error" && "border-danger/30 bg-surface text-ink",
          notice.kind === "info" && "border-line bg-surface text-ink",
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            notice.kind === "success" && "text-success",
            notice.kind === "error" && "text-danger",
            notice.kind === "info" && "text-ink-muted",
          )}
        />
        <span className="leading-4">{notice.message}</span>
        {notice.actionLabel && notice.onAction ? (
          <button
            type="button"
            onClick={() => {
              const action = notice.onAction;
              clearNotice();
              void action?.();
            }}
            className="ml-1 shrink-0 rounded border border-line px-1.5 py-0.5 text-[10.5px] font-medium text-ink transition-colors hover:bg-muted"
          >
            {notice.actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={clearNotice}
          className="-mr-0.5 -mt-0.5 ml-1 rounded p-0.5 text-ink-faint transition-colors hover:bg-muted hover:text-ink"
          aria-label="关闭提示"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
