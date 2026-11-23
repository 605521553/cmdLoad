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
  FolderPlus,
  FolderSymlink,
  LoaderCircle,
  Palette,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
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
import type { CategoryNode, Command } from "@/types/app";
import { cn } from "@/utils/cn";

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

export interface MenuPosition {
  x: number;
  y: number;
}

export interface CommandAiAction {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onSelect: () => void;
}

interface CommandContextMenuProps {
  context: "quick" | "manager";
  command: Command | null;
  position: MenuPosition;
  categories: CategoryNode[];
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  sortHint?: string | null;
  /** Size of the current multi-selection when appearance actions are shown. */
  selectionCount?: number;
  /** True when every command in the selection follows its category color. */
  allFollowCategoryColor?: boolean;
  /** One-click AI generation for the command that opened the menu. */
  aiAction?: CommandAiAction;
  onClose: () => void;
  onCopy: (command: Command) => void | Promise<void>;
  onEdit: (command: Command) => void;
  onToggleFavorite: (command: Command) => void | Promise<void>;
  onSetColor?: (command: Command) => void;
  onToggleCategoryColor?: (command: Command) => void | Promise<void>;
  onMoveUp?: (command: Command) => void | Promise<void>;
  onMoveDown?: (command: Command) => void | Promise<void>;
  onMove: (
    command: Command,
    categoryId: string | null,
    categoryLabel: string,
  ) => void | Promise<void>;
  onView: (command: Command) => void;
  onDelete: (command: Command) => void;
  onCreateCategory?: (
    parentId: string | null,
    name: string,
  ) => Promise<string | null>;
}

export function CommandContextMenu({
  context,
  command,
  position,
  categories,
  canMoveUp = false,
  canMoveDown = false,
  sortHint = null,
  selectionCount = 1,
  allFollowCategoryColor = false,
  aiAction,
  onClose,
  onCopy,
  onEdit,
  onToggleFavorite,
  onSetColor,
  onToggleCategoryColor,
  onMoveUp,
  onMoveDown,
  onMove,
  onView,
  onDelete,
  onCreateCategory,
}: CommandContextMenuProps) {
  const [panel, setPanel] = useState<"root" | "category">("root");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [creatingParent, setCreatingParent] = useState<
    string | null | undefined
  >(undefined);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryError, setNewCategoryError] = useState<string | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [coords, setCoords] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  const flatCategories = useMemo(
    () => flattenCategories(categories),
    [categories],
  );
  const filteredCategories = useMemo(() => {
    const query = categoryQuery.trim().toLocaleLowerCase();
    if (!query) {
      return flatCategories;
    }
    return flatCategories.filter((category) =>
      category.name.toLocaleLowerCase().includes(query),
    );
  }, [categoryQuery, flatCategories]);

  useEffect(() => {
    setPanel("root");
    setCategoryQuery("");
    setCreatingParent(undefined);
    setNewCategoryName("");
    setNewCategoryError(null);
    setCreating(false);
  }, [command, position]);

  useEffect(() => {
    if (creatingParent === undefined) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      newNameRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [creatingParent]);

  useLayoutEffect(() => {
    if (!command) {
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : 228;
    const height =
      rect && rect.height > 0
        ? rect.height
        : panel === "root"
          ? 300
          : 360;
    const margin = 8;
    const x = Math.max(
      margin,
      Math.min(position.x, window.innerWidth - width - margin),
    );
    const y = Math.max(
      margin,
      Math.min(position.y, window.innerHeight - height - margin),
    );
    setCoords((current) =>
      current.x === x && current.y === y ? current : { x, y },
    );
  }, [
    command,
    position,
    panel,
    categoryQuery,
    filteredCategories.length,
    creatingParent,
    newCategoryError,
  ]);

  useEffect(() => {
    if (!command) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLElement>(
        panel === "category"
          ? "input"
          : '[role="menuitem"]',
      );
      first?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [command, panel]);

  useEffect(() => {
    if (!command) {
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
  }, [command, onClose]);

  if (!command) {
    return null;
  }

  const closeAndRun = (action: () => void | Promise<void>) => {
    onClose();
    void action();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (creatingParent !== undefined) {
        setCreatingParent(undefined);
        setNewCategoryName("");
      } else if (panel === "category") {
        setPanel("root");
        setCategoryQuery("");
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

  const beginCreateCategory = (parentId: string | null) => {
    if (!onCreateCategory || creating) {
      return;
    }
    setCreatingParent(parentId);
    setNewCategoryName("");
    setNewCategoryError(null);
  };

  const cancelCreateCategory = () => {
    if (creating) {
      return;
    }
    setCreatingParent(undefined);
    setNewCategoryName("");
    setNewCategoryError(null);
  };

  const submitCreateCategory = async () => {
    if (
      creatingParent === undefined ||
      !onCreateCategory ||
      creating
    ) {
      return;
    }
    const name = newCategoryName.trim();
    if (!name) {
      setNewCategoryError("目录名称不能为空。");
      return;
    }
    setCreating(true);
    setNewCategoryError(null);
    try {
      const id = await onCreateCategory(creatingParent, name);
      if (!id) {
        setNewCategoryError("创建失败，请检查目录名称。");
        return;
      }
      onClose();
      await onMove(command, id, name);
    } catch {
      setNewCategoryError("创建失败，请检查目录名称。");
    } finally {
      setCreating(false);
    }
  };

  const renderCategoryCreator = (
    parentId: string | null,
    depth: number,
  ) => (
    <div
      className="px-1 pb-1"
      style={{ paddingLeft: 4 + depth * 12 }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={newNameRef}
          value={newCategoryName}
          maxLength={80}
          onChange={(event) => {
            setNewCategoryName(event.target.value);
            setNewCategoryError(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              event.stopPropagation();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              void submitCreateCategory();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelCreateCategory();
            }
          }}
          placeholder={
            parentId ? "子目录名称…" : "一级目录名称…"
          }
          aria-label="新目录名称"
          className="h-6 min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 text-[11px] text-ink outline-none focus:border-ink-faint"
        />
        <button
          type="button"
          onClick={() => void submitCreateCategory()}
          disabled={creating}
          className="rounded p-1 text-ink-muted hover:bg-muted hover:text-ink disabled:opacity-45"
          aria-label="创建并移动"
          title="创建并移动"
        >
          {creating ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
        </button>
        <button
          type="button"
          onClick={cancelCreateCategory}
          disabled={creating}
          className="rounded p-1 text-ink-faint hover:bg-muted hover:text-ink disabled:opacity-45"
          aria-label="取消新建目录"
          title="取消"
        >
          <X className="size-3" />
        </button>
      </div>
      {newCategoryError ? (
        <p className="mt-1 text-[9.5px] leading-3.5 text-danger">
          {newCategoryError}
        </p>
      ) : (
        <p className="mt-1 text-[9px] leading-3.5 text-ink-faint">
          回车创建并移动，Esc 取消
        </p>
      )}
    </div>
  );

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label="命令操作菜单"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onMenuKeyDown}
      style={{ left: coords.x, top: coords.y }}
      className="fixed z-[80] w-[228px] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-window"
    >
      {panel === "root" ? (
        <>
          <MenuButton
            icon={<Copy />}
            label="复制命令"
            onClick={() => closeAndRun(() => onCopy(command))}
          />
          <MenuButton
            icon={<Pencil />}
            label="编辑命令"
            onClick={() => {
              onClose();
              onEdit(command);
            }}
          />
          {aiAction ? (
            <MenuButton
              icon={
                aiAction.busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Sparkles />
                )
              }
              label={aiAction.label}
              disabled={aiAction.disabled}
              onClick={() => closeAndRun(aiAction.onSelect)}
            />
          ) : null}
          <MenuButton
            icon={
              <Star
                className={command.isFavorite ? "text-amber" : undefined}
                fill={command.isFavorite ? "currentColor" : "none"}
              />
            }
            label={command.isFavorite ? "取消收藏" : "收藏命令"}
            onClick={() => closeAndRun(() => onToggleFavorite(command))}
          />
          {onSetColor || onToggleCategoryColor ? (
            <>
              <div className="my-1 h-px bg-line" />
              {onSetColor ? (
                <MenuButton
                  icon={<Palette />}
                  label={
                    selectionCount > 1
                      ? `设置颜色（${selectionCount} 条）`
                      : "设置颜色"
                  }
                  onClick={() => {
                    onClose();
                    onSetColor(command);
                  }}
                />
              ) : null}
              {onToggleCategoryColor ? (
                <MenuButton
                  icon={<FolderSymlink />}
                  label={
                    allFollowCategoryColor
                      ? "取消跟随目录颜色"
                      : selectionCount > 1
                        ? `使用所在目录颜色（${selectionCount} 条）`
                        : "使用所在目录颜色"
                  }
                  trailing={
                    allFollowCategoryColor ? (
                      <Check className="size-3 shrink-0 text-success" />
                    ) : undefined
                  }
                  onClick={() =>
                    closeAndRun(() => onToggleCategoryColor(command))
                  }
                />
              ) : null}
              <div className="my-1 h-px bg-line" />
            </>
          ) : null}
          {context === "manager" ? (
            <>
              <MenuButton
                icon={<ArrowUp />}
                label="上移"
                disabled={!canMoveUp || !onMoveUp}
                onClick={() =>
                  closeAndRun(() => onMoveUp?.(command))
                }
              />
              <MenuButton
                icon={<ArrowDown />}
                label="下移"
                disabled={!canMoveDown || !onMoveDown}
                onClick={() =>
                  closeAndRun(() => onMoveDown?.(command))
                }
              />
              {sortHint ? (
                <p className="px-2 pb-1 pt-0.5 text-[9.5px] leading-3.5 text-ink-faint">
                  {sortHint}
                </p>
              ) : null}
              <div className="my-1 h-px bg-line" />
            </>
          ) : null}
          <MenuButton
            icon={<FolderInput />}
            label="移动到目录"
            trailing={<ChevronRight className="size-3" />}
            onClick={() => setPanel("category")}
          />
          {context === "quick" ? (
            <MenuButton
              icon={<ExternalLink />}
              label="在完整管理界面中查看"
              onClick={() => {
                onClose();
                onView(command);
              }}
            />
          ) : null}
          <div className="my-1 h-px bg-line" />
          <MenuButton
            icon={<Trash2 />}
            label="删除命令"
            danger
            onClick={() => {
              onClose();
              onDelete(command);
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
                setCategoryQuery("");
              }}
              className="rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink"
              aria-label="返回命令菜单"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="text-[11px] font-medium text-ink">
              移动到目录
            </span>
          </div>
          <div className="relative px-1 pb-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              value={categoryQuery}
              onChange={(event) => setCategoryQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const first = filteredCategories[0];
                  if (first) {
                    event.preventDefault();
                    closeAndRun(() =>
                      onMove(command, first.id, first.name),
                    );
                  }
                }
              }}
              placeholder="搜索目录…"
              aria-label="搜索目录"
              className="h-7 w-full rounded border border-line bg-canvas pl-7 pr-2 text-[11px] text-ink outline-none focus:border-ink-faint"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <MenuButton
              icon={<Folder />}
              label="默认"
              disabled={command.categoryId === null}
              trailing={
                command.categoryId === null ? (
                  <Check className="size-3 text-success" />
                ) : undefined
              }
              onClick={() =>
                closeAndRun(() => onMove(command, null, "默认"))
              }
            />
            {filteredCategories.length === 0 ? (
              <p className="px-2 py-3 text-center text-[10.5px] text-ink-faint">
                没有匹配的目录
              </p>
            ) : (
              filteredCategories.map((category) => (
                <div key={category.id}>
                  <div className="group flex items-center">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={command.categoryId === category.id}
                      onClick={() =>
                        closeAndRun(() =>
                          onMove(command, category.id, category.name),
                        )
                      }
                      style={{ paddingLeft: 8 + category.depth * 12 }}
                      className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left text-[11.5px] text-ink-muted transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-45"
                    >
                      <CategoryIcon
                        iconName={category.iconName}
                        color={category.color}
                        size={13}
                        className={
                          category.color ? undefined : "text-ink-faint"
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {category.name}
                      </span>
                      {command.categoryId === category.id ? (
                        <Check className="size-3 shrink-0 text-success" />
                      ) : null}
                    </button>
                    {onCreateCategory ? (
                      <button
                        type="button"
                        onClick={() => beginCreateCategory(category.id)}
                        disabled={creating}
                        className="mr-0.5 rounded p-1 text-ink-faint opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100 focus:opacity-100 disabled:opacity-45"
                        aria-label={`在 ${category.name} 下新建子目录`}
                        title="新建子目录"
                      >
                        <FolderPlus className="size-3" />
                      </button>
                    ) : null}
                  </div>
                  {creatingParent === category.id
                    ? renderCategoryCreator(category.id, category.depth + 1)
                    : null}
                </div>
              ))
            )}
          </div>
          {onCreateCategory ? (
            <div className="mt-1 border-t border-line pt-1">
              {creatingParent === null ? (
                renderCategoryCreator(null, 0)
              ) : (
                <button
                  type="button"
                  onClick={() => beginCreateCategory(null)}
                  disabled={creating}
                  className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-ink-muted transition-colors hover:bg-muted hover:text-ink disabled:opacity-45"
                >
                  <Plus className="size-3.5 text-ink-faint" />
                  新建一级目录
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  return createPortal(menu, document.body);
}

function MenuButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  indent = 0,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  indent?: number;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{ paddingLeft: 8 + indent * 12 }}
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
