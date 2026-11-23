import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

export function Kbd({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-surface px-1 font-mono text-[10px] font-medium leading-none text-ink-muted",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
