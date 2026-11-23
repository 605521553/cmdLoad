import { AlertTriangle, Info, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface BannerProps {
  tone?: "warning" | "error" | "info";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Banner({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  className,
}: BannerProps) {
  const Icon = tone === "info" ? Info : AlertTriangle;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs leading-4",
        tone === "warning" && "border-amber/25 bg-amber-soft text-ink",
        tone === "error" && "border-danger/20 bg-danger-soft text-ink",
        tone === "info" && "border-line bg-muted text-ink",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-px size-3.5 shrink-0",
          tone === "warning" && "text-amber",
          tone === "error" && "text-danger",
          tone === "info" && "text-ink-muted",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children ? (
          <div className="mt-0.5 text-[11.5px] leading-4 text-ink-muted">
            {children}
          </div>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="-m-0.5 rounded p-0.5 text-ink-muted transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/5"
          aria-label="关闭提示"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
