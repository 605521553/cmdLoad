import { Star } from "lucide-react";
import type { MouseEvent } from "react";
import { CommandPrimary } from "@/features/command-display/CommandPrimary";
import { ShellBadge } from "@/features/command-display/ShellBadge";
import { getShellLabel } from "@/features/command-display/shellDisplay";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import { resolveCommandTint } from "@/features/appearance/commandAppearance";
import type { Command } from "@/types/app";
import { cn } from "@/utils/cn";

interface QuickCommandItemProps {
  command: Command;
  categoryPath?: string | null;
  selected: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function QuickCommandItem({
  command,
  categoryPath,
  selected,
  onSelect,
  onCopy,
  onContextMenu,
}: QuickCommandItemProps) {
  const tint = resolveCommandTint(command);
  const hasShell = getShellLabel(command.shell) !== null;
  const hasTrailing =
    command.isFavorite || hasShell || Boolean(command.categoryName);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-quick-command-id={command.id}
      data-tinted={tint.hasTint || undefined}
      style={tint.style}
      onMouseEnter={onSelect}
      onClick={onCopy}
      onContextMenu={onContextMenu}
      className={cn(
        "relative flex w-full flex-col rounded-[10px] border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow]",
        tint.hasTint && "command-tint",
        selected
          ? cn(
              "border-line-strong text-ink shadow-sm before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-brand",
              tint.hasTint ? "ring-1 ring-inset ring-brand/30" : "bg-surface",
            )
          : cn(
              "border-transparent text-ink",
              tint.hasTint
                ? "hover:ring-1 hover:ring-inset hover:ring-line-strong/50"
                : "hover:bg-surface/70",
            ),
      )}
    >
      <CommandPrimary
        command={command}
        density="quick"
        lines={2}
        trailing={
          hasTrailing ? (
            <span className="flex min-w-0 items-center gap-1">
              {command.isFavorite ? (
                <Star
                  className="size-2.5 shrink-0 text-amber"
                  fill="currentColor"
                  aria-label="已收藏"
                />
              ) : null}
              <ShellBadge shell={command.shell} compact />
              {command.categoryName ? (
                <span
                  className="flex max-w-[92px] min-w-0 shrink items-center gap-0.5 rounded bg-muted/80 px-1 py-px text-[9px] text-ink-muted"
                  title={categoryPath ?? command.categoryName}
                  aria-label={`所属目录：${categoryPath ?? command.categoryName}`}
                >
                  <CategoryIcon
                    iconName={command.categoryIconName}
                    color={command.categoryColor}
                    size={9}
                  />
                  <span className="truncate">{command.categoryName}</span>
                </span>
              ) : null}
            </span>
          ) : undefined
        }
      />
    </button>
  );
}
