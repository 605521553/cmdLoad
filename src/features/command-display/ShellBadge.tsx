import { cn } from "@/utils/cn";
import { getShellLabel } from "./shellDisplay";

interface ShellBadgeProps {
  shell: string | null | undefined;
  className?: string;
  compact?: boolean;
}

/**
 * Shared Shell badge. It renders nothing for unspecified/unknown shells so
 * callers never need a blank placeholder or separate unknown-shell logic.
 */
export function ShellBadge({
  shell,
  className,
  compact = false,
}: ShellBadgeProps) {
  const label = getShellLabel(shell);
  if (!label) {
    return null;
  }
  return (
    <span
      data-shell-badge={shell?.trim().toLocaleLowerCase() ?? ""}
      title={`Shell：${label}`}
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-line bg-surface px-1 py-px font-mono tracking-wide text-ink-faint",
        compact ? "text-[8px]" : "text-[8.5px]",
        className,
      )}
    >
      {label}
    </span>
  );
}
