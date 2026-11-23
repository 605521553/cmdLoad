import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  FolderInput,
  Palette,
  Pencil,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import type { CategoryNode, Prompt } from "@/types/app";
import { cn } from "@/utils/cn";
import { promptDisplayTitle } from "./promptAppearance";

export interface PromptMenuPosition {
  x: number;
  y: number;
}

interface FlatCategory {
  id: string;
  name: string;
  depth: number;
  color: string | null;
  iconName: string | null;
}

function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
  output: FlatCategory[] = [],
): FlatCategory[] {
  for (const node of nodes) {
    output.push({
      id: node.id,
      name: node.name,
      depth,
      color: node.color,
      iconName: node.iconName,
    });
    flattenCategories(node.children, depth + 1, output);
  }
  return output;
}

interface PromptContextMenuProps {
  context: "quick" | "manager";
  prompt: Prompt | null;
  position: PromptMenuPosition;
  categories: CategoryNode[];
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  selectionCount?: number;
  onClose: () => void;
  onCopy: (prompt: Prompt) => void | Promise<void>;
  onEdit: (prompt: Prompt) => void;
  onToggleFavorite: (prompt: Prompt) => void | Promise<void>;
  onSetColor: (prompt: Prompt) => void;
  onMoveUp?: (prompt: Prompt) => void | Promise<void>;
  onMoveDown?: (prompt: Prompt) => void | Promise<void>;
  onMove: (
    prompt: Prompt,
    categoryId: string | null,
    categoryLabel: string,
  ) => void | Promise<void>;
  onView: (prompt: Prompt) => void;
  onDelete: (prompt: Prompt) => void;
}

export function PromptContextMenu({
  context,
  prompt,
  position,
  categories,
  canMoveUp = false,
  canMoveDown = false,
  selectionCount = 1,
  onClose,
  onCopy,
  onEdit,
  onToggleFavorite,
  onSetColor,
  onMoveUp,
  onMoveDown,
  onMove,
  onView,
  onDelete,
}: PromptContextMenuProps) {
  const [panel, setPanel] = useState<"root" | "category">("root");
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);

  const flatCategories = useMemo(
    () => flattenCategories(categories),
    [categories],
  );
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    if (!value) {
      return flatCategories;
    }
    return flatCategories.filter((category) =>
      category.name.toLocaleLowerCase().includes(value),
    );
  }, [flatCategories, query]);

  useEffect(() => {
    setPanel("root");
    setQuery("");
  }, [prompt, position]);

  useLayoutEffect(() => {
    if (!prompt) {
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : 224;
    const height =
      rect && rect.height > 0 ? rect.height : panel === "root" ? 300 : 360;
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
  }, [prompt, position, panel, query, filtered.length]);

  useEffect(() => {
    if (!prompt) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLElement>(
        panel === "category" ? "input" : '[role="menuitem"]',
      );
      first?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [prompt, panel]);

  useEffect(() => {
    if (!prompt) {
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
  }, [prompt, onClose]);

  if (!prompt) {
    return null;
  }

  const run = (action: () => void | Promise<void>) => {
    onClose();
    void action();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (panel === "category") {
        setPanel("root");
        setQuery("");
      } else {
        onClose();
      }
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
      aria-label="提示词操作菜单"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
      style={{ left: coords.x, top: coords.y }}
      className="fixed z-[80] w-[224px] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-window"
    >
      {panel === "root" ? (
        <>
          <MenuButton
            icon={<Copy />}
            label="复制提示词"
            onClick={() => run(() => onCopy(prompt))}
          />
          <MenuButton
            icon={<Pencil />}
            label="编辑提示词"
            onClick={() => {
              onClose();
              onEdit(prompt);
            }}
          />
          <MenuButton
            icon={
              <Star
                className={prompt.isFavorite ? "text-amber" : undefined}
                fill={prompt.isFavorite ? "currentColor" : "none"}
              />
            }
            label={prompt.isFavorite ? "取消收藏" : "收藏提示词"}
            onClick={() => run(() => onToggleFavorite(prompt))}
          />
          <MenuButton
            icon={<Palette />}
            label={
              selectionCount > 1
                ? `设置背景颜色（${selectionCount} 条）`
                : "设置背景颜色"
            }
            onClick={() => {
              onClose();
              onSetColor(prompt);
            }}
          />
          {context === "manager" ? (
            <>
              <div className="my-1 h-px bg-line" />
              <MenuButton
                icon={<ArrowUp />}
                label="上移"
                disabled={!canMoveUp || !onMoveUp}
                onClick={() => run(() => onMoveUp?.(prompt))}
              />
              <MenuButton
                icon={<ArrowDown />}
                label="下移"
                disabled={!canMoveDown || !onMoveDown}
                onClick={() => run(() => onMoveDown?.(prompt))}
              />
            </>
          ) : null}
          <div className="my-1 h-px bg-line" />
          <MenuButton
            icon={<FolderInput />}
            label="移动到目录"
            trailing={<ChevronRight className="size-3" />}
            onClick={() => setPanel("category")}
          />
          {context === "quick" ? (
            <MenuButton
              icon={<ExternalLink />}
              label="在提示词库中查看"
              onClick={() => {
                onClose();
                onView(prompt);
              }}
            />
          ) : null}
          <div className="my-1 h-px bg-line" />
          <MenuButton
            icon={<Trash2 />}
            label="删除提示词"
            danger
            onClick={() => {
              onClose();
              onDelete(prompt);
            }}
          />
        </>
      ) : (
        <>
          <div className="flex items-center gap-1 px-1 pb-1">
            <button
              type="button"
              onClick={() => {
                setPanel("root");
                setQuery("");
              }}
              className="rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink"
              aria-label="返回提示词菜单"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
              移动「{promptDisplayTitle(prompt, 22)}」
            </span>
          </div>
          <div className="relative px-1 pb-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const first = filtered[0];
                  if (first) {
                    event.preventDefault();
                    run(() => onMove(prompt, first.id, first.name));
                  }
                }
              }}
              placeholder="搜索目录…"
              aria-label="搜索提示词目录"
              className="h-7 w-full rounded border border-line bg-canvas pl-7 pr-2 text-[11px] text-ink outline-none focus:border-ink-faint"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <MenuButton
              icon={<Folder />}
              label="默认"
              disabled={prompt.categoryId === null}
              trailing={
                prompt.categoryId === null ? (
                  <Check className="size-3 text-success" />
                ) : undefined
              }
              onClick={() => run(() => onMove(prompt, null, "默认"))}
            />
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-[10.5px] text-ink-faint">
                没有匹配的目录
              </p>
            ) : (
              filtered.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  role="menuitem"
                  disabled={prompt.categoryId === category.id}
                  onClick={() =>
                    run(() => onMove(prompt, category.id, category.name))
                  }
                  style={{ paddingLeft: 8 + category.depth * 12 }}
                  className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] text-ink-muted transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-45"
                >
                  <CategoryIcon
                    iconName={category.iconName}
                    color={category.color}
                    size={13}
                    className={category.color ? undefined : "text-ink-faint"}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {category.name}
                  </span>
                  {prompt.categoryId === category.id ? (
                    <Check className="size-3 shrink-0 text-success" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11.5px] transition-colors disabled:pointer-events-none disabled:opacity-45",
        danger
          ? "text-danger hover:bg-danger-soft"
          : "text-ink-muted hover:bg-muted hover:text-ink",
      )}
    >
      <span
        className={cn(
          "shrink-0 [&_svg]:size-3.5",
          danger ? "text-danger" : "text-ink-faint",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
