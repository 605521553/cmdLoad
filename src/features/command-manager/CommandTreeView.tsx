import {
  ChevronDown,
  ChevronRight,
  Folder,
  GripVertical,
  MoreHorizontal,
  Star,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import { resolveCommandTint } from "@/features/appearance/commandAppearance";
import { CommandPrimary } from "@/features/command-display/CommandPrimary";
import { ShellBadge } from "@/features/command-display/ShellBadge";
import { commandLabel } from "@/features/command-display/commandDisplay";
import { getShellLabel } from "@/features/command-display/shellDisplay";
import type { CategoryNode, Command } from "@/types/app";
import { UNCLASSIFIED_CATEGORY_ID } from "@/types/app";
import { cn } from "@/utils/cn";
import { isDragSessionCancelled } from "./dragSession";

export type TreeDropPosition = "before" | "after";

interface CommandTreeViewProps {
  commands: Command[];
  categories: CategoryNode[];
  expanded: Set<string>;
  forceExpanded: boolean;
  selectedIds: string[];
  canReorder: boolean;
  draggingIds: string[];
  onToggleCategory: (id: string) => void;
  onExpandCategory: (id: string) => void;
  onCommandClick: (command: Command, event: MouseEvent) => void;
  onActivateCommand: (command: Command) => void;
  onToggleSelected: (command: Command) => void;
  onToggleFavorite: (command: Command) => void;
  onContextCommand: (command: Command, position: { x: number; y: number }) => void;
  onContextCategory: (
    category: CategoryNode,
    position: { x: number; y: number },
  ) => void;
  onDragStartCommand: (
    event: DragEvent<HTMLButtonElement>,
    command: Command,
  ) => void;
  onDragEnd: () => void;
  onReorderCommand: (
    draggingIds: string[],
    target: Command,
    position: TreeDropPosition,
  ) => void;
  onMoveToCategory: (
    ids: string[],
    categoryId: string | null,
    label: string,
  ) => void;
}

export function CommandTreeView({
  commands,
  categories,
  expanded,
  forceExpanded,
  selectedIds,
  canReorder,
  draggingIds,
  onToggleCategory,
  onExpandCategory,
  onCommandClick,
  onActivateCommand,
  onToggleSelected,
  onToggleFavorite,
  onContextCommand,
  onContextCategory,
  onDragStartCommand,
  onDragEnd,
  onReorderCommand,
  onMoveToCategory,
}: CommandTreeViewProps) {
  const [dropCategoryId, setDropCategoryId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: TreeDropPosition;
  } | null>(null);
  const autoExpandTimer = useRef<number | null>(null);
  const autoExpandId = useRef<string | null>(null);

  const commandsByCategory = useMemo(() => {
    const map = new Map<string | null, Command[]>();
    for (const command of commands) {
      const key = command.categoryId;
      const list = map.get(key);
      if (list) {
        list.push(command);
      } else {
        map.set(key, [command]);
      }
    }
    return map;
  }, [commands]);

  const clearAutoExpand = () => {
    if (autoExpandTimer.current !== null) {
      window.clearTimeout(autoExpandTimer.current);
      autoExpandTimer.current = null;
    }
    autoExpandId.current = null;
  };

  useEffect(
    () => () => {
      clearAutoExpand();
    },
    [],
  );

  useEffect(() => {
    if (draggingIds.length === 0) {
      setDropTarget(null);
      setDropCategoryId(null);
    }
  }, [draggingIds.length]);

  const finishDrag = () => {
    setDropTarget(null);
    setDropCategoryId(null);
    clearAutoExpand();
    onDragEnd();
  };

  const isExpanded = (id: string) =>
    forceExpanded || expanded.has(id);

  const subtreeCount = (node: CategoryNode): number => {
    const direct = commandsByCategory.get(node.id)?.length ?? 0;
    return (
      direct +
      node.children.reduce((total, child) => total + subtreeCount(child), 0)
    );
  };

  const handleCategoryDragOver = (
    node: CategoryNode | null,
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (
      draggingIds.length === 0 ||
      !node ||
      isDragSessionCancelled()
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropCategoryId(node.id);
    if (node.children.length > 0 && !isExpanded(node.id)) {
      if (autoExpandId.current !== node.id) {
        clearAutoExpand();
        autoExpandId.current = node.id;
        autoExpandTimer.current = window.setTimeout(() => {
          onExpandCategory(node.id);
          autoExpandId.current = null;
          autoExpandTimer.current = null;
        }, 600);
      }
    } else {
      clearAutoExpand();
    }
  };

  const handleCategoryDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setDropCategoryId(null);
    clearAutoExpand();
  };

  const dropOnCategory = (
    categoryId: string | null,
    label: string,
    event: DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    clearAutoExpand();
    setDropCategoryId(null);
    if (draggingIds.length > 0 && !isDragSessionCancelled()) {
      onMoveToCategory(draggingIds, categoryId, label);
    }
  };

  const openCategoryMenu = (
    category: CategoryNode,
    target: HTMLElement,
  ) => {
    const rect = target.getBoundingClientRect();
    onContextCategory(category, {
      x: rect.right - 8,
      y: rect.bottom + 2,
    });
  };

  const handleCommandDragTarget = (
    command: Command,
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (
      !canReorder ||
      draggingIds.length === 0 ||
      isDragSessionCancelled()
    ) {
      return;
    }
    if (draggingIds.includes(command.id)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({
      id: command.id,
      position:
        event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };

  const renderCommands = (categoryId: string | null, depth: number) => {
    const rows = commandsByCategory.get(categoryId) ?? [];
    return rows.map((command) => {
      const selectedIndex = selectedIds.indexOf(command.id) + 1;
      const isDropTarget = dropTarget?.id === command.id;
      const tint = resolveCommandTint(command);
      return (
        <div
          key={command.id}
          data-tree-command-id={command.id}
          data-command-id={command.id}
          data-tinted={tint.hasTint || undefined}
          className={cn(
            "group relative flex items-start gap-1.5 border-b border-line/60 py-1.5 pr-2 last:border-b-0",
            tint.hasTint && "command-tint",
            !tint.hasTint &&
              (selectedIndex > 0 ? "bg-muted/55" : "hover:bg-muted/35"),
            tint.hasTint &&
              (selectedIndex > 0
                ? "ring-1 ring-inset ring-brand/40"
                : "hover:ring-1 hover:ring-inset hover:ring-line-strong/60"),
            draggingIds.includes(command.id) && "opacity-45",
          )}
          style={{ paddingLeft: 10 + depth * 14, ...tint.style }}
          onMouseEnter={() => onActivateCommand(command)}
          onDragEnter={(event) =>
            handleCommandDragTarget(command, event)
          }
          onDragOver={(event) =>
            handleCommandDragTarget(command, event)
          }
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = dropTarget;
            setDropTarget(null);
            if (
              !target ||
              draggingIds.length === 0 ||
              isDragSessionCancelled()
            ) {
              return;
            }
            onReorderCommand(draggingIds, command, target.position);
          }}
          onDragLeave={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ) {
              return;
            }
            setDropTarget((current) =>
              current?.id === command.id ? null : current,
            );
          }}
        >
          {isDropTarget ? (
            <span
              className={cn(
                "pointer-events-none absolute inset-x-2 h-0.5 bg-brand",
                dropTarget?.position === "before" ? "top-0" : "bottom-0",
              )}
            />
          ) : null}

          <button
            type="button"
            draggable
            onDragStart={(event) => onDragStartCommand(event, command)}
            onDragEnd={finishDrag}
            className="mt-1 cursor-grab rounded p-0.5 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
            aria-label={`拖动命令 ${commandLabel(command)}`}
            title={
              canReorder
                ? "拖动到目录或调整顺序"
                : "拖动到目录"
            }
          >
            <GripVertical className="size-3" />
          </button>

          <label className="mt-1 flex shrink-0 items-center gap-1">
            <input
              type="checkbox"
              checked={selectedIndex > 0}
              onChange={() => onToggleSelected(command)}
              aria-label={`选择 ${commandLabel(command)}`}
              className="size-3.5 accent-[var(--brand)]"
            />
            {selectedIndex > 0 ? (
              <span
                className="flex size-4 items-center justify-center rounded-full bg-brand text-[9px] font-semibold text-brand-contrast"
                aria-label={`第 ${selectedIndex} 个选择`}
              >
                {selectedIndex}
              </span>
            ) : null}
          </label>

          <button
            type="button"
            onClick={() => onToggleFavorite(command)}
            aria-label={command.isFavorite ? "取消收藏" : "收藏命令"}
            className={cn(
              "mt-0.5 rounded p-0.5 transition-colors hover:bg-surface",
              command.isFavorite
                ? "text-amber"
                : "text-ink-faint opacity-40 group-hover:opacity-100",
            )}
          >
            <Star
              className="size-3"
              fill={command.isFavorite ? "currentColor" : "none"}
            />
          </button>

          <button
            type="button"
            onClick={(event) => onCommandClick(command, event)}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextCommand(command, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
              if (
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              ) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onContextCommand(command, {
                  x: rect.right - 8,
                  y: rect.bottom + 2,
                });
              }
            }}
            className="min-w-0 flex-1 text-left"
          >
            <CommandPrimary
              command={command}
              density="tree"
              lines={2}
              trailing={
                getShellLabel(command.shell) ? (
                  <ShellBadge shell={command.shell} compact />
                ) : undefined
              }
            />
          </button>
        </div>
      );
    });
  };

  const renderCategory = (node: CategoryNode, depth: number) => {
    const open = isExpanded(node.id);
    const count = subtreeCount(node);
    return (
      <div key={node.id}>
        <div
          data-tree-category-id={node.id}
          onDragEnter={(event) => handleCategoryDragOver(node, event)}
          onDragOver={(event) => handleCategoryDragOver(node, event)}
          onDragLeave={handleCategoryDragLeave}
          onDrop={(event) => dropOnCategory(node.id, node.name, event)}
          onContextMenu={(event) => {
            event.preventDefault();
            onContextCategory(node, {
              x: event.clientX,
              y: event.clientY,
            });
          }}
          className={cn(
            "group flex h-7 items-center rounded-md pr-1 text-[13px] transition-colors hover:bg-muted/45",
            dropCategoryId === node.id && "bg-brand/10 ring-1 ring-brand/40",
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <button
            type="button"
            onClick={() => onToggleCategory(node.id)}
            aria-label={`${open ? "折叠" : "展开"}目录 ${node.name}`}
            aria-expanded={open}
            className="flex size-4 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
          >
            {open ? (
              <ChevronDown className="size-2.5" />
            ) : (
              <ChevronRight className="size-2.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onToggleCategory(node.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <CategoryIcon
              iconName={node.iconName}
              color={node.color}
              size={13}
              className={node.color ? undefined : "text-ink-faint"}
            />
            <span className="truncate text-ink">{node.name}</span>
          </button>
          <span className="shrink-0 px-1 text-[10px] text-ink-faint">
            {count}
          </span>
          <button
            type="button"
            onClick={(event) =>
              openCategoryMenu(node, event.currentTarget)
            }
            className="rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100"
            aria-label={`目录操作 ${node.name}`}
            title="目录操作"
          >
            <MoreHorizontal className="size-3" />
          </button>
        </div>
        {open ? (
          <>
            {node.children.map((child) => renderCategory(child, depth + 1))}
            {renderCommands(node.id, depth + 1)}
          </>
        ) : null}
      </div>
    );
  };

  const unclassified = commandsByCategory.get(null) ?? [];
  const unclassifiedOpen = forceExpanded || expanded.has(UNCLASSIFIED_CATEGORY_ID);

  return (
    <div className="min-h-[120px]">
      {categories.map((node) => renderCategory(node, 0))}
      <div>
        <div
          data-tree-category-id={UNCLASSIFIED_CATEGORY_ID}
          onDragEnter={(event) => {
            if (
              draggingIds.length === 0 ||
              isDragSessionCancelled()
            ) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropCategoryId(UNCLASSIFIED_CATEGORY_ID);
          }}
          onDragOver={(event) => {
            if (
              draggingIds.length === 0 ||
              isDragSessionCancelled()
            ) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropCategoryId(UNCLASSIFIED_CATEGORY_ID);
          }}
          onDragLeave={handleCategoryDragLeave}
          onDrop={(event) => dropOnCategory(null, "默认", event)}
          className={cn(
            "flex h-7 items-center rounded-md px-1 text-[13px] text-ink-muted transition-colors hover:bg-muted/45",
            dropCategoryId === UNCLASSIFIED_CATEGORY_ID &&
              "bg-brand/10 ring-1 ring-brand/40",
          )}
        >
          <button
            type="button"
            onClick={() => onToggleCategory(UNCLASSIFIED_CATEGORY_ID)}
            aria-label={`${unclassifiedOpen ? "折叠" : "展开"}默认`}
            aria-expanded={unclassifiedOpen}
            className="flex size-4 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
          >
            {unclassifiedOpen ? (
              <ChevronDown className="size-2.5" />
            ) : (
              <ChevronRight className="size-2.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onToggleCategory(UNCLASSIFIED_CATEGORY_ID)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <Folder className="size-3.5 shrink-0 text-ink-faint" />
            <span className="truncate">默认</span>
          </button>
          <span className="shrink-0 px-1 text-[10px] text-ink-faint">
            {unclassified.length}
          </span>
        </div>
        {unclassifiedOpen ? renderCommands(null, 1) : null}
      </div>
      {unclassified.length === 0 &&
      categories.every((node) => subtreeCount(node) === 0) ? (
        <p className="px-3 py-6 text-center text-[11px] text-ink-faint">
          当前筛选下没有命令
        </p>
      ) : null}
    </div>
  );
}
