import { Folder, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import type { CategoryNode } from "@/types/app";
import { cn } from "@/utils/cn";
import {
  countSubtreeCommands,
  flattenCategoryOptions,
} from "./categoryUtils";

interface MoveToCategoryDialogProps {
  open: boolean;
  count: number;
  categories: CategoryNode[];
  /** Noun shown in the title, e.g. "命令" or "提示词". */
  itemLabel?: string;
  onClose: () => void;
  onMove: (categoryId: string | null, categoryLabel: string) => Promise<void>;
}

export function MoveToCategoryDialog({
  open,
  count,
  categories,
  itemLabel = "命令",
  onClose,
  onMove,
}: MoveToCategoryDialogProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const flat = useMemo(() => flattenCategoryOptions(categories), [categories]);
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    if (!value) {
      return flat;
    }
    return flat.filter((category) =>
      category.name.toLocaleLowerCase().includes(value),
    );
  }, [flat, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setBusy(false);
      window.setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, busy, onClose]);

  if (!open) {
    return null;
  }

  const choose = async (categoryId: string | null, label: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onMove(categoryId, label);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/35 px-4 py-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-category-title"
        className="w-full max-w-[390px] rounded-lg border border-line bg-surface shadow-window"
      >
        <div className="flex h-10 items-center border-b border-line px-3.5">
          <h2
            id="move-category-title"
            className="text-[13px] font-semibold text-ink"
          >
            移动 {count} 条{itemLabel}到目录
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-50"
            aria-label="关闭目录选择"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="border-b border-line px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索目录…"
              aria-label="搜索目录"
              className="h-7 w-full rounded border border-line bg-canvas pl-7 pr-2 text-[11.5px] text-ink outline-none focus:border-ink-faint"
            />
          </div>
        </div>

        <div className="max-h-[300px] overflow-y-auto p-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose(null, "默认")}
            className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12px] text-ink-muted transition-colors hover:bg-muted hover:text-ink disabled:opacity-50"
          >
            <Folder className="size-3.5 text-ink-faint" />
            默认
          </button>
          {filtered.length === 0 ? (
            <p className="px-2 py-5 text-center text-[11px] text-ink-faint">
              没有匹配的目录
            </p>
          ) : (
            filtered.map((category) => (
              <button
                key={category.id}
                type="button"
                disabled={busy}
                onClick={() => void choose(category.id, category.name)}
                style={{ paddingLeft: 8 + category.depth * 14 }}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12px] text-ink-muted transition-colors hover:bg-muted hover:text-ink disabled:opacity-50",
                )}
              >
                <CategoryIcon
                  iconName={category.node.iconName}
                  color={category.node.color}
                  size={13}
                  className={category.node.color ? undefined : "text-ink-faint"}
                />
                <span className="truncate">{category.name}</span>
                <span className="ml-auto text-[9.5px] text-ink-faint">
                  {countSubtreeCommands(category.node)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
