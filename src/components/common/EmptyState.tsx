import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

/** Small, flat empty state. No decorative art or oversized whitespace. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-7" : "px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <div className="mb-2.5 flex size-8 items-center justify-center rounded-md border border-line bg-muted text-ink-faint">
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[310px] text-[12px] leading-5 text-ink-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
