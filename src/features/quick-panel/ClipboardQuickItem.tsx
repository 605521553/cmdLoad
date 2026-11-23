import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Monitor,
  ShieldAlert,
} from "lucide-react";
import { ClipboardItemActions } from "@/features/clipboard/ClipboardItemActions";
import type { ClipboardItem, ClipboardSource } from "@/types/app";
import { cn } from "@/utils/cn";
import { formatRelativeTime } from "@/utils/time";

const SOURCE_LABELS: Record<ClipboardSource, string> = {
  current: "当前剪贴板",
  system_history: "Windows 历史",
  local_monitor: "本地记录",
};

function SourceIcon({ source }: { source: ClipboardSource }) {
  if (source === "current") {
    return <Clipboard className="size-2.5" />;
  }
  if (source === "system_history") {
    return <Monitor className="size-2.5" />;
  }
  return <Clipboard className="size-2.5" />;
}

interface ClipboardQuickItemProps {
  item: ClipboardItem;
  selected: boolean;
  expanded: boolean;
  saving: boolean;
  savingPrompt: boolean;
  copying: boolean;
  onSelect: () => void;
  onSave: () => void;
  onSaveAsPrompt: () => void;
  onCopy: () => void;
  onOpenSaved: () => void;
  onToggleExpanded: () => void;
}

export function ClipboardQuickItem({
  item,
  selected,
  expanded,
  saving,
  savingPrompt,
  copying,
  onSelect,
  onSave,
  onSaveAsPrompt,
  onCopy,
  onOpenSaved,
  onToggleExpanded,
}: ClipboardQuickItemProps) {
  const lineCount = item.content.split(/\r?\n/).length;
  const canExpand = lineCount > 3 || item.content.length > 220;

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-quick-clipboard-key={item.key}
      onMouseEnter={onSelect}
      onClick={onSelect}
      className={cn(
        "group relative flex w-full flex-col rounded-[10px] border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow]",
        selected
          ? "border-line-strong bg-surface shadow-sm before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-brand"
          : "border-transparent hover:bg-surface/70",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-surface px-1 py-px text-[8.5px] text-ink-faint">
          <SourceIcon source={item.source} />
          {SOURCE_LABELS[item.source]}
        </span>
        {item.isSensitive ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-danger/20 bg-danger-soft px-1 py-px text-[8.5px] text-danger">
            <ShieldAlert className="size-2.5" />
            敏感
          </span>
        ) : null}
        <span className="truncate text-[9.5px] text-ink-faint">
          {item.isCurrent ? "刚刚复制" : formatRelativeTime(item.copiedAt)}
        </span>
        <div
          className="ml-auto"
          onClick={(event) => event.stopPropagation()}
        >
          <ClipboardItemActions
            item={item}
            saving={saving}
            savingPrompt={savingPrompt}
            copying={copying}
            onSave={onSave}
            onSaveAsPrompt={onSaveAsPrompt}
            onCopy={onCopy}
            onOpenSaved={onOpenSaved}
          />
        </div>
      </div>

      <pre
        className={cn(
          "mt-1 whitespace-pre-wrap break-all font-mono text-[10.5px] leading-4 text-ink-muted",
          expanded ? "max-h-44 overflow-y-auto" : "line-clamp-2",
        )}
      >
        {item.content}
      </pre>

      {canExpand ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded();
          }}
          className="mt-0.5 flex w-fit items-center gap-0.5 text-[9.5px] text-ink-faint transition-colors hover:text-ink"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-2.5" />
              收起预览
            </>
          ) : (
            <>
              <ChevronDown className="size-2.5" />
              展开全文
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
