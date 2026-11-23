import {
  Clock3,
  Copy,
  Hash,
  Pencil,
  Star,
  Tag,
  Terminal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AiAnnotationSection } from "@/features/ai/AiAnnotationSection";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import { ShellBadge } from "@/features/command-display/ShellBadge";
import {
  getCommandAnnotation,
  hasManualAnnotation,
} from "@/features/command-display/commandDisplay";
import { getShellLabel } from "@/features/command-display/shellDisplay";
import { DEFAULT_CATEGORY_NAME } from "@/features/command-manager/categoryUtils";
import type { Command } from "@/types/app";
import { cn } from "@/utils/cn";
import { formatRelativeTime } from "@/utils/time";

const SOURCE_LABELS: Record<Command["sourceType"], string> = {
  manual: "手动添加",
  clipboard_current: "当前剪贴板",
  clipboard_history: "剪贴板历史",
  import: "导入",
};

interface CommandDetailPanelProps {
  command: Command | null;
  categoryPath?: string | null;
  width: number;
  onCopy: (command: Command) => void;
  onEdit: (command: Command) => void;
  onToggleFavorite: (command: Command) => void;
  onDelete: (command: Command) => void;
  onTagClick: (tagId: string) => void;
  onCommandUpdated?: (command: Command) => void;
}

export function CommandDetailPanel({
  command,
  categoryPath,
  width,
  onCopy,
  onEdit,
  onToggleFavorite,
  onDelete,
  onTagClick,
  onCommandUpdated,
}: CommandDetailPanelProps) {
  const lines = command?.command.split(/\r?\n/) ?? [];
  const showLineNumbers = lines.length > 1;
  const annotation = command ? getCommandAnnotation(command) : null;
  const shellLabel = command ? getShellLabel(command.shell) : null;
  // Replace mode copies the AI text into the command fields. Do not render the
  // same annotation twice; the AI section below already owns it.
  const shortAnnotationMirrorsAi =
    command !== null &&
    command.aiAnnotation !== null &&
    annotation === command.aiAnnotation.shortDescription;
  const descriptionMirrorsAi =
    command !== null &&
    command.aiAnnotation !== null &&
    command.description.trim() ===
      command.aiAnnotation.detailedDescription.trim();
  const fullCategory =
    categoryPath ?? command?.categoryName ?? DEFAULT_CATEGORY_NAME;

  return (
    <aside
      aria-label="命令详情"
      className="hidden h-full min-h-0 shrink-0 flex-col border-l border-line bg-canvas-deep/35 min-[860px]:flex"
      style={{ width }}
    >
      {!command ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl border border-line bg-surface text-ink-faint shadow-sm">
            <Terminal className="size-4" />
          </div>
          <p className="mt-3 text-[12px] font-medium text-ink">选择一条命令</p>
          <p className="mt-1 max-w-[210px] text-[10.5px] leading-4 text-ink-faint">
            悬停或点击命令列表，在这里查看完整命令、简短注释、目录和元数据。
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-line/70 px-3.5 pb-3 pt-3">
            <div className="overflow-hidden rounded-[10px] border border-line bg-canvas">
              <div className="flex h-7 items-center border-b border-line/80 px-2.5">
                <Terminal className="size-3 text-ink-faint" />
                <span className="ml-1.5 text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  命令原文
                </span>
                {showLineNumbers ? (
                  <span className="ml-auto text-[9px] text-ink-faint">
                    {lines.length} 行
                  </span>
                ) : null}
              </div>
              <div className="p-2.5">
                <pre className="selectable whitespace-pre-wrap break-all font-mono text-[14px] leading-[1.6] text-ink">
                  {showLineNumbers
                    ? lines.map((line, index) => (
                        <div key={index} className="flex min-w-0">
                          <span className="mr-2.5 w-5 shrink-0 select-none text-right text-ink-faint/70">
                            {index + 1}
                          </span>
                          <code
                            className={cn(
                              "min-w-0 flex-1",
                              line.trimStart().startsWith("#") &&
                                !line.trimStart().startsWith("#!") &&
                                "text-ink-faint",
                            )}
                          >
                            {line || " "}
                          </code>
                        </div>
                      ))
                    : command.command}
                </pre>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                className="h-7 px-2.5 text-[10.5px]"
                onClick={() => onCopy(command)}
              >
                <Copy />
                复制命令
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2.5 text-[10.5px]"
                onClick={() => onEdit(command)}
              >
                <Pencil />
                编辑
              </Button>
              <button
                type="button"
                onClick={() => onToggleFavorite(command)}
                aria-label={command.isFavorite ? "取消收藏" : "收藏命令"}
                className={cn(
                  "ml-auto rounded-md p-1 transition-colors hover:bg-muted",
                  command.isFavorite
                    ? "text-amber"
                    : "text-ink-faint hover:text-ink",
                )}
              >
                <Star
                  className="size-3.5"
                  fill={command.isFavorite ? "currentColor" : "none"}
                />
              </button>
              <button
                type="button"
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                onClick={() => onDelete(command)}
                aria-label="删除命令"
                title="删除命令"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {annotation && !shortAnnotationMirrorsAi ? (
              <section className="mt-3">
                <p className="ui-eyebrow mb-1">简短注释</p>
                <p className="text-[12px] leading-[1.55] text-ink-muted">
                  {annotation}
                </p>
              </section>
            ) : null}

            {command.description && !descriptionMirrorsAi ? (
              <section className="mt-3">
                <p className="ui-eyebrow mb-1">详细说明</p>
                <p className="selectable whitespace-pre-wrap break-words text-[11.5px] leading-[1.55] text-ink-muted">
                  {command.description}
                </p>
              </section>
            ) : null}

            <AiAnnotationSection
              command={command}
              hasManualAnnotation={hasManualAnnotation(command)}
              onSaved={(updated) => onCommandUpdated?.(updated)}
            />

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[9.5px] text-ink-muted">
                <CategoryIcon
                  iconName={command.categoryIconName}
                  color={command.categoryColor}
                  size={10}
                  className={
                    command.categoryColor ? undefined : "text-ink-faint"
                  }
                />
                <span className="truncate" title={fullCategory}>
                  {fullCategory}
                </span>
              </span>
              {command.tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => onTagClick(tag.id)}
                  className="inline-flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] text-ink-muted transition-colors hover:text-ink"
                >
                  <Hash className="size-2.5 text-ink-faint" />
                  {tag.name}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3.5 py-3">
            <p className="ui-eyebrow mb-1.5">元数据</p>
            <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[10.5px] leading-4">
              {shellLabel ? (
                <>
                  <dt className="flex items-center gap-1 text-ink-faint">
                    <Terminal className="size-2.5" />
                    Shell
                  </dt>
                  <dd className="text-ink-muted">
                    <ShellBadge shell={command.shell} />
                  </dd>
                </>
              ) : null}
              <dt className="flex items-center gap-1 text-ink-faint">
                <Tag className="size-2.5" />
                来源
              </dt>
              <dd className="text-ink-muted">
                {SOURCE_LABELS[command.sourceType] ?? command.sourceType}
              </dd>
              <dt className="flex items-center gap-1 text-ink-faint">
                <Clock3 className="size-2.5" />
                使用
              </dt>
              <dd className="text-ink-muted">
                {command.useCount} 次
                {command.lastUsedAt
                  ? ` · 最近 ${formatRelativeTime(command.lastUsedAt)}`
                  : ""}
              </dd>
              <dt className="flex items-center gap-1 text-ink-faint">
                <Clock3 className="size-2.5" />
                更新
              </dt>
              <dd
                className="text-ink-muted"
                title={new Date(command.updatedAt).toLocaleString("zh-CN")}
              >
                {formatRelativeTime(command.updatedAt)}
              </dd>
            </dl>
          </div>
        </div>
      )}
    </aside>
  );
}
