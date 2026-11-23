import {
  ArrowDown,
  ArrowUp,
  FolderPlus,
  Palette,
  Pencil,
  Trash2,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { CategoryNode } from "@/types/app";
import { cn } from "@/utils/cn";

export interface CategoryMenuPosition {
  x: number;
  y: number;
}

interface CategoryContextMenuProps {
  category: CategoryNode | null;
  position: CategoryMenuPosition;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onCreateChild: (category: CategoryNode) => void;
  onRename: (category: CategoryNode) => void;
  onEditAppearance: (category: CategoryNode) => void;
  onMoveUp: (category: CategoryNode) => void;
  onMoveDown: (category: CategoryNode) => void;
  onDelete: (category: CategoryNode) => void;
}

export function CategoryContextMenu({
  category,
  position,
  canMoveUp,
  canMoveDown,
  onClose,
  onCreateChild,
  onRename,
  onEditAppearance,
  onMoveUp,
  onMoveDown,
  onDelete,
}: CategoryContextMenuProps) {
  const [coords, setCoords] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!category) {
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : 190;
    const height = rect && rect.height > 0 ? rect.height : 190;
    const margin = 8;
    setCoords({
      x: Math.max(
        margin,
        Math.min(position.x, window.innerWidth - width - margin),
      ),
      y: Math.max(
        margin,
        Math.min(position.y, window.innerHeight - height - margin),
      ),
    });
  }, [category, position]);

  useEffect(() => {
    if (!category) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [category]);

  useEffect(() => {
    if (!category) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [category, onClose]);

  if (!category) {
    return null;
  }

  const run = (action: () => void) => {
    onClose();
    action();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? []),
    ];
    if (items.length === 0) {
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next =
      index < 0
        ? delta > 0
          ? 0
          : items.length - 1
        : (index + delta + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="目录操作菜单"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: coords.x, top: coords.y }}
      className="fixed z-[80] w-[190px] rounded-lg border border-line bg-surface p-1 shadow-window"
    >
      <Item
        icon={<FolderPlus />}
        label="新建子目录"
        onClick={() => run(() => onCreateChild(category))}
      />
      <Item
        icon={<Pencil />}
        label="重命名"
        onClick={() => run(() => onRename(category))}
      />
      <Item
        icon={<Palette />}
        label="自定义外观"
        onClick={() => run(() => onEditAppearance(category))}
      />
      <div className="my-1 h-px bg-line" />
      <Item
        icon={<ArrowUp />}
        label="上移"
        disabled={!canMoveUp}
        onClick={() => run(() => onMoveUp(category))}
      />
      <Item
        icon={<ArrowDown />}
        label="下移"
        disabled={!canMoveDown}
        onClick={() => run(() => onMoveDown(category))}
      />
      <div className="my-1 h-px bg-line" />
      <Item
        icon={<Trash2 />}
        label="删除目录"
        danger
        onClick={() => run(() => onDelete(category))}
      />
    </div>,
    document.body,
  );
}

function Item({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] transition-colors disabled:pointer-events-none disabled:opacity-40",
        danger
          ? "text-danger hover:bg-danger-soft"
          : "text-ink-muted hover:bg-muted hover:text-ink",
      )}
    >
      <span className={cn(danger ? "text-danger" : "text-ink-faint", "[&_svg]:size-3.5")}>
        {icon}
      </span>
      {label}
    </button>
  );
}
