import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ColorPaletteEditor } from "@/features/appearance/ColorPaletteEditor";
import { useCustomColors } from "@/features/appearance/useCustomColors";
import {
  usePopoverPosition,
  type PopoverAnchor,
} from "@/features/appearance/usePopoverPosition";
import { colorsEqual } from "@/features/appearance/palette";

const POPOVER_WIDTH = 268;

interface PromptColorPopoverProps {
  open: boolean;
  anchor: PopoverAnchor;
  prompts: Array<{ backgroundColor: string | null }>;
  onClose: () => void;
  onApplyColor: (color: string | null) => Promise<void> | void;
}

/** Macaron background picker for prompts; no category-follow mode. */
export function PromptColorPopover({
  open,
  anchor,
  prompts,
  onClose,
  onApplyColor,
}: PromptColorPopoverProps) {
  const { colors, add, remove, move } = useCustomColors();
  const panelRef = useRef<HTMLDivElement>(null);
  const coords = usePopoverPosition({
    open,
    anchor,
    panelRef,
    fallbackWidth: POPOVER_WIDTH,
    fallbackHeight: 420,
  });

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

  if (!open || prompts.length === 0) {
    return null;
  }

  const allSame =
    prompts.length > 0 &&
    prompts.every((prompt) =>
      colorsEqual(prompt.backgroundColor, prompts[0].backgroundColor),
    );
  const value = allSame ? prompts[0]?.backgroundColor ?? null : null;
  const mixed = !allSame;
  const header =
    prompts.length > 1 ? `设置 ${prompts.length} 条提示词背景` : "设置提示词背景";

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
          Prompt
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

      <p className="mb-2 rounded border border-line bg-canvas px-2 py-1 text-[9px] leading-3.5 text-ink-faint">
        提示词默认使用中性表面；只有选择颜色后才显示淡马卡龙背景，避免长文本阅读时被色彩干扰。
      </p>

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
        previewLabel="提示词背景预览"
      />
    </div>,
    document.body,
  );
}
