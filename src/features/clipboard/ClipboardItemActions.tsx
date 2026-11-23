import {
  BookmarkPlus,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ClipboardItem } from "@/types/app";
import { cn } from "@/utils/cn";

interface ClipboardItemActionsProps {
  item: ClipboardItem;
  saving: boolean;
  copying: boolean;
  /** Optional. When provided, saving can target either the command or prompt library. */
  savingPrompt?: boolean;
  onSave: () => void;
  onSaveAsPrompt?: () => void;
  onCopy: () => void;
  onOpenSaved: () => void;
}

/**
 * Shared clipboard actions so the quick panel and the manager clipboard page
 * expose the same save / saved / copy behavior. The primary button keeps the
 * one-click "save as command" flow; the small chevron only adds the prompt
 * destination.
 */
export function ClipboardItemActions({
  item,
  saving,
  copying,
  savingPrompt = false,
  onSave,
  onSaveAsPrompt,
  onCopy,
  onOpenSaved,
}: ClipboardItemActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const busy = saving || copying || savingPrompt;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen]);

  return (
    <div ref={containerRef} className="flex shrink-0 items-center gap-1">
      {item.savedCommandId ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[10.5px] text-success hover:bg-success-soft"
          onClick={onOpenSaved}
          title="查看已保存的命令"
        >
          <Check className="size-3" />
          已保存
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          className="h-6 px-1.5 text-[10.5px]"
          onClick={onSave}
          disabled={busy}
        >
          <BookmarkPlus className="size-3" />
          {saving ? "保存中" : "保存"}
        </Button>
      )}

      {onSaveAsPrompt ? (
        <div className="relative">
          <button
            type="button"
            aria-label="更多保存方式"
            title="更多保存方式"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
            className={cn(
              "flex h-6 items-center rounded-md border border-line bg-surface px-0.5 text-ink-faint transition-colors hover:border-line-strong hover:text-ink disabled:opacity-45",
              menuOpen && "border-line-strong text-ink",
            )}
          >
            <ChevronDown className="size-3" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              aria-label="保存方式"
              className="absolute right-0 top-full z-50 mt-1 w-[148px] rounded-lg border border-line bg-surface p-1 shadow-window"
            >
              <button
                type="button"
                role="menuitem"
                disabled={Boolean(item.savedCommandId) || busy}
                onClick={() => {
                  setMenuOpen(false);
                  if (!item.savedCommandId) {
                    onSave();
                  }
                }}
                className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-ink-muted transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-45"
              >
                <Terminal className="size-3.5 shrink-0" />
                {item.savedCommandId ? "已在命令库" : "保存为命令"}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onSaveAsPrompt();
                }}
                className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-ink-muted transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-45"
              >
                <FileText className="size-3.5 shrink-0" />
                {savingPrompt ? "保存中…" : "保存为提示词"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-[10.5px]"
        onClick={onCopy}
        disabled={busy}
        title="复制原始内容"
      >
        <Copy className="size-3" />
        {copying ? "复制中" : "复制"}
      </Button>
    </div>
  );
}
