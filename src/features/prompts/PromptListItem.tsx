import {
  Copy,
  GripVertical,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import type { DragEvent, MouseEvent } from "react";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import type { Prompt } from "@/types/app";
import { cn } from "@/utils/cn";
import { formatRelativeTime } from "@/utils/time";
import { promptDisplayTitle, resolvePromptTint } from "./promptAppearance";

interface PromptListItemProps {
  prompt: Prompt;
  categoryPath?: string | null;
  active: boolean;
  selected: boolean;
  selectionOrder: number;
  dragging: boolean;
  canDrag: boolean;
  dropPosition: "before" | "after" | null;
  onActivate: () => void;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
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

export function PromptListItem({
  prompt,
  categoryPath,
  active,
  selected,
  selectionOrder,
  dragging,
  canDrag,
  dropPosition,
  onActivate,
  onSelect,
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
}: PromptListItemProps) {
  const tint = resolvePromptTint(prompt);
  const title = prompt.title.trim();
  const label = promptDisplayTitle(prompt);

  return (
    <div
      data-prompt-id={prompt.id}
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
              "prompt-tint",
              !selected &&
                "hover:ring-1 hover:ring-inset hover:ring-line-strong/60",
            )
          : "hover:bg-muted/25",
        active &&
          "before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-brand",
        active && !tint.hasTint && "bg-muted/45",
        selected && (tint.hasTint ? "ring-1 ring-inset ring-brand/45" : "bg-muted/70"),
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
          aria-label={`拖动排序 ${label}`}
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
          aria-label={`选择 ${label}`}
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
        aria-pressed={prompt.isFavorite}
        aria-label={prompt.isFavorite ? "取消收藏" : "收藏提示词"}
        className={cn(
          "mt-0.5 rounded p-0.5 transition-colors hover:bg-surface",
          prompt.isFavorite
            ? "text-amber"
            : "text-ink-faint opacity-45 hover:text-ink group-hover:opacity-100",
        )}
      >
        <Star
          className="size-3.5"
          fill={prompt.isFavorite ? "currentColor" : "none"}
        />
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={onCopy}
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
          title="单击选中查看，双击复制完整提示词"
        >
          {title ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[12.5px] font-semibold text-ink">
                {title}
              </span>
              <span className="shrink-0 text-[9.5px] text-ink-faint">
                {prompt.useCount > 0 ? `使用 ${prompt.useCount} 次` : ""}
                {prompt.lastUsedAt && prompt.useCount > 0 ? " · " : ""}
                {prompt.lastUsedAt
                  ? formatRelativeTime(prompt.lastUsedAt)
                  : ""}
              </span>
            </span>
          ) : null}
          <p
            className={cn(
              "mt-0.5 whitespace-pre-wrap break-words text-[11.5px] leading-[1.55] text-ink-muted",
              title ? "line-clamp-2" : "line-clamp-3",
            )}
          >
            {prompt.content}
          </p>
        </button>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
          {prompt.categoryName ? (
            <span
              className="flex max-w-[140px] min-w-0 items-center gap-0.5 rounded bg-muted/70 px-1.5 py-px text-[9.5px] text-ink-muted"
              title={categoryPath ?? prompt.categoryName}
            >
              <CategoryIcon
                iconName={prompt.categoryIconName}
                color={prompt.categoryColor}
                size={9}
              />
              <span className="truncate">
                {categoryPath ?? prompt.categoryName}
              </span>
            </span>
          ) : (
            <span className="rounded bg-muted/60 px-1.5 py-px text-[9.5px] text-ink-faint">
              默认
            </span>
          )}
          {prompt.tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => onTagClick(tag.id)}
              className="rounded bg-muted px-1.5 py-px text-[9.5px] text-ink-muted transition-colors hover:text-ink"
            >
              #{tag.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={onCopy}
          className="rounded p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          aria-label={`复制 ${label}`}
          title="复制完整提示词"
        >
          <Copy className="size-3" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          aria-label={`编辑 ${label}`}
          title="编辑"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
          aria-label={`删除 ${label}`}
          title="删除"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {selected ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-brand" />
      ) : null}
    </div>
  );
}
