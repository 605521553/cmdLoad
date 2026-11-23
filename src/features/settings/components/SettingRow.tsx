import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface SettingRowProps {
  title: string;
  description: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function SettingRow({
  title,
  description,
  children,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex min-h-[46px] items-start justify-between gap-6 border-b border-line/70 py-2.5 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-5 text-ink">{title}</p>
        <div className="mt-0.5 text-[12px] leading-[18px] text-ink-muted">
          {description}
        </div>
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2 pt-0.5">{children}</div>
      ) : null}
    </div>
  );
}
