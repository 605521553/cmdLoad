import { Copy, GripVertical, Pencil, Star, Trash2 } from "lucide-react";
import type { DragEvent, MouseEvent } from "react";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import { resolveCommandTint } from "@/features/appearance/commandAppearance";
import { CommandPrimary } from "@/features/command-display/CommandPrimary";
import { ShellBadge } from "@/features/command-display/ShellBadge";
import { commandLabel } from "@/features/command-display/commandDisplay";
import { getShellLabel } from "@/features/command-display/shellDisplay";
import type { Command } from "@/types/app";
import { cn } from "@/utils/cn";

interface CommandRowProps {
  command: Command;
  active: boolean;
  selected: boolean;
  selectionOrder: number;
  dragging: boolean;
  canDrag: boolean;
  dropPosition: "before" | "after" | null;
  onActivate: () => void;
  onRowClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onCopy: () => void;
  onToggleFavorite: () => void;
  onToggleSelected: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenuKeyboard?: (target: HTMLElement) => void;
  dragHint?: string;
  onTagClick: (tagId: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export function CommandRow({
  command,
  active,
  selected,
  selectionOrder,
  dragging,
  canDrag,
  dropPosition,
  onActivate,
  onRowClick,
  onCopy,
  onToggleFavorite,
  onToggleSelected,
  onEdit,
  onDelete,
  onContextMenu,
  onContextMenuKeyboard,
  dragHint,
  onTagClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: CommandRowProps) {
  const tint = resolveCommandTint(command);
  const hasShell = getShellLabel(command.shell) !== null;
  return (
    <div
      data-command-id={command.id}
      data-tinted={tint.hasTint || undefined}
      style={tint.style}
      onMouseEnter={onActivate}
      onContextMenu={onContextMenu}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex items-start gap-2 border-b border-line/60 px-3 py-2.5 transition-colors last:border-b-0",
        tint.hasTint
          ? cn(
              "command-tint",
              !selected &&
                "hover:ring-1 hover:ring-inset hover:ring-line-strong/60",
            )
          : "hover:bg-muted/25",
        active &&
          "before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-brand",
        active && !tint.hasTint && "bg-muted/45",
        selected &&
          (tint.hasTint
            ? "ring-1 ring-inset ring-brand/45"
            : "bg-muted/70"),
        dragging && "opacity-45",
      )}
    >
      {dropPosition ? (
        <span
          className={cn(
            "pointer-events-none absolute inset-x-2 z-10 h-0.5 bg-brand",
            dropPosition === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      {canDrag ? (
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          className="mt-0.5 cursor-grab rounded p-0.5 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          aria-label={`拖动排序 ${commandLabel(command)}`}
          title={dragHint ?? "拖动排序，或拖到左侧目录"}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}

      <label className="mt-1 flex shrink-0 items-center gap-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={`选择 ${commandLabel(command)}`}
          className="size-3.5 accent-[var(--brand)]"
        />
        {selectionOrder > 0 ? (
          <span
            className="flex size-4 items-center justify-center rounded-full bg-brand text-[9px] font-semibold text-brand-contrast"
            aria-label={`第 ${selectionOrder} 个选择`}
          >
            {selectionOrder}
          </span>
        ) : null}
      </label>

      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={command.isFavorite}
        aria-label={command.isFavorite ? "取消收藏" : "收藏命令"}
        className={cn(
          "mt-0.5 rounded p-0.5 transition-colors hover:bg-surface",
          command.isFavorite
            ? "text-amber"
            : "text-ink-faint opacity-45 hover:text-ink group-hover:opacity-100",
        )}
      >
        <Star
          className="size-3.5"
          fill={command.isFavorite ? "currentColor" : "none"}
        />
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onRowClick}
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              onContextMenuKeyboard?.(event.currentTarget);
            }
          }}
          className="block w-full text-left"
          title="点击复制命令；Ctrl/Shift 点击可多选"
        >
          <CommandPrimary
            command={command}
            density="manager"
            lines={2}
            trailing={
              hasShell || command.categoryName ? (
                <span className="flex min-w-0 items-center gap-1">
                  <ShellBadge shell={command.shell} />
                  {command.categoryName ? (
                    <span className="flex max-w-[96px] min-w-0 shrink items-center gap-0.5 text-[10px] text-ink-faint">
                      <CategoryIcon
                        iconName={command.categoryIconName}
                        color={command.categoryColor}
                        size={10}
                      />
                      <span className="truncate">{command.categoryName}</span>
                    </span>
                  ) : null}
                </span>
              ) : undefined
            }
          />
        </button>

        {command.tags.length > 0 ? (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            {command.tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => onTagClick(tag.id)}
                className="rounded bg-muted px-1.5 py-px text-[10px] text-ink-muted transition-colors hover:text-ink"
              >
                #{tag.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={onCopy}
          className="rounded p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          aria-label={`复制 ${commandLabel(command)}`}
          title="复制"
        >
          <Copy className="size-3" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          aria-label={`编辑 ${commandLabel(command)}`}
          title="编辑"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
          aria-label={`删除 ${commandLabel(command)}`}
          title="删除"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {command.useCount > 0 ? (
        <span className="mt-0.5 shrink-0 text-[9.5px] text-ink-faint">
          {command.useCount} 次
        </span>
      ) : null}

      {selected ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-brand" />
      ) : null}
    </div>
  );
}
