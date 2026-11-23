import { Clock3, Copy, FileText, Pencil, Star, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import { resolveCommandSurface } from "@/features/appearance/palette";
import { DEFAULT_CATEGORY_NAME } from "@/features/command-manager/categoryUtils";
import type { Prompt } from "@/types/app";
import { cn } from "@/utils/cn";
import { formatRelativeTime } from "@/utils/time";

interface PromptDetailPanelProps {
  prompt: Prompt | null;
  categoryPath?: string | null;
  width: number;
  onCopy: (prompt: Prompt) => void;
  onEdit: (prompt: Prompt) => void;
  onToggleFavorite: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
  onTagClick: (tagId: string) => void;
}

export function PromptDetailPanel({
  prompt,
  categoryPath,
  width,
  onCopy,
  onEdit,
  onToggleFavorite,
  onDelete,
  onTagClick,
}: PromptDetailPanelProps) {
  const surface = prompt ? resolveCommandSurface(prompt.backgroundColor) : null;
  const fullCategory =
    categoryPath ?? prompt?.categoryName ?? DEFAULT_CATEGORY_NAME;

  return (
    <aside
      aria-label="提示词预览"
      className="hidden h-full min-h-0 shrink-0 flex-col border-l border-line bg-canvas-deep/35 min-[860px]:flex"
      style={{ width }}
    >
      {!prompt ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl border border-line bg-surface text-ink-faint shadow-sm">
            <FileText className="size-4" />
          </div>
          <p className="mt-3 text-[12px] font-medium text-ink">选择一条提示词</p>
          <p className="mt-1 max-w-[210px] text-[10.5px] leading-4 text-ink-faint">
            在左侧选择提示词，这里会显示完整原文；支持选择、滚动和复制。
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-line/70 px-3.5 pb-3 pt-3">
            <div
              className={cn(
                "overflow-hidden rounded-[10px] border border-line",
                surface ? "prompt-tint" : "bg-canvas",
              )}
              style={
                surface
                  ? ({
                      "--prompt-tint-light": surface.light,
                      "--prompt-tint-dark": surface.dark,
                    } as CSSProperties)
                  : undefined
              }
            >
              <div className="flex h-7 items-center border-b border-line/70 px-2.5">
                <FileText className="size-3 text-ink-faint" />
                <span className="ml-1.5 text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  提示词原文
                </span>
                <span className="ml-auto text-[9px] tabular-nums text-ink-faint">
                  {prompt.content.length.toLocaleString("zh-CN")} 字符
                </span>
              </div>
              <div className="p-3">
                <pre className="selectable max-h-[46vh] overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-[13px] leading-[1.7] text-ink">
                  {prompt.content}
                </pre>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                className="h-7 px-2.5 text-[10.5px]"
                onClick={() => onCopy(prompt)}
              >
                <Copy />
                复制提示词
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2.5 text-[10.5px]"
                onClick={() => onEdit(prompt)}
              >
                <Pencil />
                编辑
              </Button>
              <button
                type="button"
                onClick={() => onToggleFavorite(prompt)}
                aria-label={prompt.isFavorite ? "取消收藏" : "收藏提示词"}
                className={cn(
                  "ml-auto rounded-md p-1 transition-colors hover:bg-muted",
                  prompt.isFavorite
                    ? "text-amber"
                    : "text-ink-faint hover:text-ink",
                )}
              >
                <Star
                  className="size-3.5"
                  fill={prompt.isFavorite ? "currentColor" : "none"}
                />
              </button>
              <button
                type="button"
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                onClick={() => onDelete(prompt)}
                aria-label="删除提示词"
                title="删除提示词"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {prompt.title.trim() ? (
              <section className="mt-3">
                <p className="ui-eyebrow mb-1">标题</p>
                <p className="selectable text-[12px] font-medium leading-[1.55] text-ink">
                  {prompt.title}
                </p>
              </section>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[9.5px] text-ink-muted">
                <CategoryIcon
                  iconName={prompt.categoryIconName}
                  color={prompt.categoryColor}
                  size={10}
                  className={prompt.categoryColor ? undefined : "text-ink-faint"}
                />
                <span className="truncate" title={fullCategory}>
                  {fullCategory}
                </span>
              </span>
              {prompt.tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => onTagClick(tag.id)}
                  className="rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] text-ink-muted transition-colors hover:text-ink"
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3.5 py-3">
            <p className="ui-eyebrow mb-1.5">使用记录</p>
            <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[10.5px] leading-4">
              <dt className="flex items-center gap-1 text-ink-faint">
                <Clock3 className="size-2.5" />
                使用
              </dt>
              <dd className="text-ink-muted">
                {prompt.useCount} 次
                {prompt.lastUsedAt
                  ? ` · 最近 ${formatRelativeTime(prompt.lastUsedAt)}`
                  : ""}
              </dd>
              <dt className="flex items-center gap-1 text-ink-faint">
                <Clock3 className="size-2.5" />
                更新
              </dt>
              <dd
                className="text-ink-muted"
                title={new Date(prompt.updatedAt).toLocaleString("zh-CN")}
              >
                {formatRelativeTime(prompt.updatedAt)}
              </dd>
            </dl>
          </div>
        </div>
      )}
    </aside>
  );
}
