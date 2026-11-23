import { FolderSymlink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Command } from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage } from "@/utils/errors";
import { ColorPaletteEditor } from "./ColorPaletteEditor";
import { colorsEqual } from "./palette";
import { useCustomColors } from "./useCustomColors";
import {
  usePopoverPosition,
  type PopoverAnchor,
} from "./usePopoverPosition";

export type { PopoverAnchor } from "./usePopoverPosition";

interface ColorPickerPopoverProps {
  open: boolean;
  anchor: PopoverAnchor;
  commands: Command[];
  onClose: () => void;
  onApplyColor: (color: string | null) => Promise<void> | void;
  onFollowCategoryColor: (enabled: boolean) => Promise<void> | void;
}

const POPOVER_WIDTH = 268;

/**
 * Compact "set color" popover shared by the manager and the quick panel.
 * Preset clicks apply instantly; custom colors show a live preview first.
 */
export function ColorPickerPopover({
  open,
  anchor,
  commands,
  onClose,
  onApplyColor,
  onFollowCategoryColor,
}: ColorPickerPopoverProps) {
  const { colors, add, remove, move } = useCustomColors();
  const panelRef = useRef<HTMLDivElement>(null);
  const coords = usePopoverPosition({
    open,
    anchor,
    panelRef,
    fallbackWidth: POPOVER_WIDTH,
    fallbackHeight: 420,
  });
  const [followPending, setFollowPending] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  const count = commands.length;
  const allFollow =
    count > 0 && commands.every((command) => command.useCategoryColor);
  const someFollow = commands.some((command) => command.useCategoryColor);
  const allSameOwnColor =
    count > 0 &&
    commands.every((command) =>
      colorsEqual(command.backgroundColor, commands[0].backgroundColor),
    );
  const value = allSameOwnColor ? commands[0]?.backgroundColor ?? null : null;
  const mixed = count > 0 && !allSameOwnColor;
  const followedCategoryMissingColor =
    allFollow && commands.every((command) => !command.categoryColor);
  const mixedCategoryColorCount = new Set(
    commands.map((command) => command.categoryColor ?? ""),
  ).size;

  useEffect(() => {
    if (!open) {
      setFollowError(null);
      setFollowPending(false);
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

  if (!open || count === 0) {
    return null;
  }

  const toggleFollow = async () => {
    if (followPending) {
      return;
    }
    setFollowPending(true);
    setFollowError(null);
    try {
      await onFollowCategoryColor(!allFollow);
    } catch (error) {
      setFollowError(getUserErrorMessage(error));
    } finally {
      setFollowPending(false);
    }
  };

  const header = count > 1 ? `设置 ${count} 条命令颜色` : "设置颜色";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={header}
      style={{ left: coords.x, top: coords.y, width: POPOVER_WIDTH }}
      className="fixed z-[90] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 shadow-window"
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[11.5px] font-semibold text-ink">{header}</h2>
        <span className="ml-auto rounded bg-muted px-1 py-px text-[8.5px] uppercase tracking-wide text-ink-faint">
          Appearance
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭颜色面板"
          className="rounded p-0.5 text-ink-faint transition-colors hover:bg-muted hover:text-ink"
        >
          <X className="size-3" />
        </button>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={allFollow}
        disabled={followPending}
        onClick={() => void toggleFollow()}
        className={cn(
          "mb-2.5 flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-60",
          allFollow
            ? "border-line-strong bg-muted/55"
            : "border-line bg-canvas hover:border-line-strong",
        )}
      >
        <FolderSymlink className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-ink">
            使用所在目录颜色
            {allFollow ? (
              <span className="rounded bg-brand px-1 py-px text-[8px] font-medium text-brand-contrast">
                已开启
              </span>
            ) : someFollow ? (
              <span className="rounded bg-muted px-1 py-px text-[8px] text-ink-faint">
                部分开启
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[9px] leading-3.5 text-ink-faint">
            目录颜色变化时自动同步；关闭后恢复这条命令自己的颜色。
          </span>
          {followedCategoryMissingColor ? (
            <span className="mt-0.5 block text-[9px] leading-3.5 text-amber">
              所选目录尚未设置颜色，当前仍使用主题默认背景。
            </span>
          ) : null}
          {allFollow && mixedCategoryColorCount > 1 ? (
            <span className="mt-0.5 block text-[9px] leading-3.5 text-ink-faint">
              这些命令分别跟随各自目录的颜色。
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex h-3.5 w-6 shrink-0 items-center rounded-full border p-0.5 transition-colors",
            allFollow
              ? "justify-end border-brand bg-brand"
              : "justify-start border-line-strong bg-canvas",
          )}
        >
          <span
            className={cn(
              "size-2.5 rounded-full",
              allFollow ? "bg-brand-contrast" : "bg-ink-faint",
            )}
          />
        </span>
      </button>

      {followError ? (
        <p className="mb-2 rounded border border-danger/20 bg-danger-soft px-2 py-1 text-[9.5px] leading-4 text-danger">
          {followError}
        </p>
      ) : null}

      <ColorPaletteEditor
        value={value}
        mixed={mixed}
        customColors={colors}
        onPick={(color) => onApplyColor(color)}
        onCustomApply={(color) => onApplyColor(color)}
        onSaveToPalette={async (color) => {
          await add(color);
        }}
        onRemoveFromPalette={async (color) => {
          await remove(color);
        }}
        onReorderPalette={async (from, to) => {
          await move(from, to);
        }}
        previewLabel="命令背景预览"
      />

      {count > 1 ? (
        <p className="mt-2 border-t border-line pt-1.5 text-[9px] leading-3.5 text-ink-faint">
          将一次性修改 {count} 条命令；数据库写入为单个事务，失败时不会部分生效。
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
