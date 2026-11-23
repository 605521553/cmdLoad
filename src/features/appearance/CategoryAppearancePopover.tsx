import { RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CategoryAppearanceInput, CategoryNode } from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage } from "@/utils/errors";
import { CategoryIcon } from "./CategoryIcon";
import { searchCategoryIcons } from "./categoryIcons";
import { ColorPaletteEditor } from "./ColorPaletteEditor";
import { useCustomColors } from "./useCustomColors";
import {
  usePopoverPosition,
  type PopoverAnchor,
} from "./usePopoverPosition";

interface CategoryAppearancePopoverProps {
  open: boolean;
  anchor: PopoverAnchor;
  category: CategoryNode | null;
  onClose: () => void;
  onApplyAppearance: (appearance: CategoryAppearanceInput) => Promise<void>;
}

const POPOVER_WIDTH = 286;

/**
 * Combined color + icon editor for categories. Selecting an icon or a color
 * persists immediately, matching the "click to apply" requirement. Nested
 * categories edit independently.
 */
export function CategoryAppearancePopover({
  open,
  anchor,
  category,
  onClose,
  onApplyAppearance,
}: CategoryAppearancePopoverProps) {
  const { colors, add, remove, move } = useCustomColors();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const coords = usePopoverPosition({
    open,
    anchor,
    panelRef,
    fallbackWidth: POPOVER_WIDTH,
    fallbackHeight: 470,
  });
  const [color, setColor] = useState<string | null>(category?.color ?? null);
  const [iconName, setIconName] = useState<string | null>(
    category?.iconName ?? null,
  );
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredIcons = useMemo(() => searchCategoryIcons(query), [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        panelRef.current &&
        event.target instanceof Node &&
        !panelRef.current.contains(event.target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  if (!open || !category) {
    return null;
  }

  const apply = async (nextColor: string | null, nextIcon: string | null) => {
    if (pending) {
      return;
    }
    const previousColor = color;
    const previousIcon = iconName;
    setColor(nextColor);
    setIconName(nextIcon);
    setPending(true);
    setError(null);
    try {
      await onApplyAppearance({ color: nextColor, iconName: nextIcon });
    } catch (applyError) {
      setColor(previousColor);
      setIconName(previousIcon);
      setError(getUserErrorMessage(applyError));
    } finally {
      setPending(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`自定义外观 ${category.name}`}
      style={{ left: coords.x, top: coords.y, width: POPOVER_WIDTH }}
      className="fixed z-[90] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 shadow-window"
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="min-w-0 truncate text-[11.5px] font-semibold text-ink">
          自定义外观
        </h2>
        <span className="ml-auto shrink-0 rounded bg-muted px-1 py-px text-[8.5px] uppercase tracking-wide text-ink-faint">
          Folder
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭外观面板"
          className="rounded p-0.5 text-ink-faint transition-colors hover:bg-muted hover:text-ink"
        >
          <X className="size-3" />
        </button>
      </div>

      <div className="mb-2.5 flex items-center gap-2 rounded-md border border-line bg-canvas/70 px-2 py-1.5">
        <span className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface">
          <CategoryIcon
            iconName={iconName}
            color={color}
            size={17}
            strokeWidth={1.9}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-ink">
            {category.name}
          </p>
          <p className="truncate text-[9px] text-ink-faint">
            {iconName ?? "默认文件夹图标"} · {color ?? "主题默认色"}
          </p>
        </div>
        <button
          type="button"
          disabled={pending || (!color && !iconName)}
          onClick={() => void apply(null, null)}
          className="flex shrink-0 items-center gap-1 rounded border border-line bg-surface px-1.5 py-1 text-[9px] text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          title="恢复默认颜色和图标"
          aria-label="恢复默认颜色和图标"
        >
          <RotateCcw className="size-2.5" />
          恢复默认
        </button>
      </div>

      <section className="mb-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="ui-eyebrow">图标</span>
          <button
            type="button"
            disabled={pending || !iconName}
            onClick={() => void apply(color, null)}
            className="rounded px-1 py-0.5 text-[9px] text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-40"
          >
            默认图标
          </button>
        </div>
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索图标名称…"
            aria-label="搜索图标"
            className="h-6 w-full rounded border border-line bg-canvas pl-7 pr-2 text-[10.5px] text-ink outline-none focus:border-ink-faint"
          />
        </div>
        {filteredIcons.length === 0 ? (
          <p className="rounded border border-dashed border-line px-2 py-2 text-center text-[9.5px] text-ink-faint">
            没有匹配的图标
          </p>
        ) : (
          <div className="grid max-h-[96px] grid-cols-8 gap-1 overflow-y-auto rounded-md border border-line bg-canvas/60 p-1.5">
            {filteredIcons.map((option) => {
              const Icon = option.icon;
              const active = (iconName ?? "folder") === option.name;
              return (
                <button
                  key={option.name}
                  type="button"
                  disabled={pending}
                  onClick={() => void apply(color, option.name)}
                  aria-pressed={active}
                  aria-label={`选择图标 ${option.label}`}
                  title={`${option.label} · ${option.name}`}
                  className={cn(
                    "flex size-6 items-center justify-center rounded transition-colors disabled:opacity-45",
                    active
                      ? "bg-brand text-brand-contrast"
                      : "text-ink-faint hover:bg-muted hover:text-ink",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.8} />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="border-t border-line pt-2">
        <ColorPaletteEditor
          value={color}
          customColors={colors}
          onPick={(nextColor) => apply(nextColor, iconName)}
          onCustomApply={(nextColor) => apply(nextColor, iconName)}
          onSaveToPalette={async (nextColor) => {
            await add(nextColor);
          }}
          onRemoveFromPalette={async (nextColor) => {
            await remove(nextColor);
          }}
          onReorderPalette={async (from, to) => {
            await move(from, to);
          }}
          previewLabel="目录颜色预览"
          disabled={pending}
        />
      </div>

      {error ? (
        <p className="mt-2 rounded border border-danger/20 bg-danger-soft px-2 py-1 text-[9.5px] leading-4 text-danger">
          {error}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
