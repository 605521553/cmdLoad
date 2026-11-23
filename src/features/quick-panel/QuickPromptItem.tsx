import {
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Pencil,
  Star,
} from "lucide-react";
import type { MouseEvent } from "react";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import {
  promptDisplayTitle,
  resolvePromptTint,
} from "@/features/prompts/promptAppearance";
import type { Prompt } from "@/types/app";
import { cn } from "@/utils/cn";

interface QuickPromptItemProps {
  prompt: Prompt;
  categoryPath?: string | null;
  selected: boolean;
  expanded: boolean;
  canExpand: boolean;
  copying: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onToggleExpanded: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}

export function QuickPromptItem({
  prompt,
  categoryPath,
  selected,
  expanded,
  canExpand,
  copying,
  onSelect,
  onCopy,
  onEdit,
  onToggleFavorite,
  onToggleExpanded,
  onContextMenu,
}: QuickPromptItemProps) {
  const tint = resolvePromptTint(prompt);
  const title = prompt.title.trim();
  const label = promptDisplayTitle(prompt);

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-quick-prompt-id={prompt.id}
      data-tinted={tint.hasTint || undefined}
      style={tint.style}
      onMouseEnter={onSelect}
      onClick={onCopy}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col rounded-[10px] border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow]",
        tint.hasTint && "prompt-tint",
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
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-line/80 bg-surface/80 text-ink-faint">
          <FileText className="size-2.5" />
        </span>
        <div className="min-w-0 flex-1">
          {title ? (
            <p className="truncate text-[11.5px] font-semibold text-ink">
              {title}
            </p>
          ) : (
            <p className="truncate text-[10px] text-ink-faint">
              {label}
            </p>
          )}
          <p
            className={cn(
              "mt-0.5 whitespace-pre-wrap break-words text-[10.5px] leading-[1.55] text-ink-muted",
              expanded
                ? "max-h-[240px] overflow-y-auto pr-1"
                : "line-clamp-[5]",
            )}
          >
            {prompt.content}
          </p>
        </div>
        <div
          className="flex shrink-0 items-center gap-0.5"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label={prompt.isFavorite ? "取消收藏" : "收藏提示词"}
            className={cn(
              "rounded p-0.5 transition-colors hover:bg-surface",
              prompt.isFavorite
                ? "text-amber"
                : "text-ink-faint opacity-50 hover:text-ink group-hover:opacity-100",
            )}
          >
            <Star
              className="size-3"
              fill={prompt.isFavorite ? "currentColor" : "none"}
            />
          </button>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={onCopy}
              aria-label={`复制 ${label}`}
              title="复制完整提示词"
              className="rounded p-0.5 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
            >
              <Copy className="size-3" />
            </button>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`编辑 ${label}`}
              title="编辑"
              className="rounded p-0.5 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
            >
              <Pencil className="size-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-1 flex min-w-0 items-center gap-1">
        <span
          className="flex max-w-[130px] min-w-0 items-center gap-0.5 text-[9px] text-ink-faint"
          title={categoryPath ?? prompt.categoryName ?? "默认"}
        >
          <CategoryIcon
            iconName={prompt.categoryIconName}
            color={prompt.categoryColor}
            size={9}
          />
          <span className="truncate">
            {categoryPath ?? prompt.categoryName ?? "默认"}
          </span>
        </span>
        {prompt.useCount > 0 ? (
          <span className="shrink-0 text-[8.5px] text-ink-faint">
            · {prompt.useCount} 次
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {copying ? (
            <span className="text-[8.5px] text-ink-faint">复制中…</span>
          ) : null}
          {canExpand ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
              className="flex items-center gap-0.5 rounded px-0.5 text-[9px] text-ink-faint transition-colors hover:bg-surface hover:text-ink"
            >
              {expanded ? (
                <>
                  <ChevronUp className="size-2.5" />
                  收起
                </>
              ) : (
                <>
                  <ChevronDown className="size-2.5" />
                  展开
                </>
              )}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
