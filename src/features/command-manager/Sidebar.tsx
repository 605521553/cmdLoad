import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LayoutDashboard,
  LibraryBig,
  MessageSquareText,
  Settings2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import { CategoryAppearancePopover } from "@/features/appearance/CategoryAppearancePopover";
import { useCommandActions } from "@/features/command-actions/useCommandActions";
import {
  CategoryContextMenu,
  type CategoryMenuPosition,
} from "@/features/command-manager/CategoryContextMenu";
import { CategoryManager } from "@/features/command-manager/CategoryManager";
import {
  CATEGORY_MODULE_NAME,
  DEFAULT_CATEGORY_NAME,
  promptCategoriesAsCategoryNodes,
} from "@/features/command-manager/categoryUtils";
import { usePromptActions } from "@/features/prompts/usePromptActions";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  CategoryAppearanceInput,
  CategoryNode,
  ManagerView,
  PromptCategoryNode,
} from "@/types/app";
import { UNCLASSIFIED_CATEGORY_ID } from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage } from "@/utils/errors";
import { isDragSessionCancelled } from "./dragSession";

const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 260;
const DEFAULT_SIDEBAR_WIDTH = 172;
const EXPANDED_CATEGORIES_KEY = "pata-commands.category-expanded";
const PROMPT_EXPANDED_CATEGORIES_KEY = "pata-commands.prompt-category-expanded";

type CategoryScope = "command" | "prompt";

function categorySubtreeCount(node: CategoryNode): number {
  return (
    node.commandCount +
    node.children.reduce(
      (total, child) => total + categorySubtreeCount(child),
      0,
    )
  );
}

function findCategoryById(
  nodes: CategoryNode[],
  id: string,
): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findCategoryById(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function loadExpandedCategories(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

const PRIMARY_NAV = [
  { view: "library", label: "命令库", icon: LibraryBig },
  { view: "prompts", label: "提示词库", icon: MessageSquareText },
  { view: "workflows", label: "工作流", icon: GitBranch },
  { view: "clipboard", label: "剪贴板", icon: ClipboardList },
  { view: "overview", label: "概览", icon: LayoutDashboard },
] as const;

interface NavButtonProps {
  view: ManagerView;
  label: string;
  icon: typeof LibraryBig;
  active: boolean;
  onSelect: (view: ManagerView) => void;
}

interface CategoryTreeProps {
  nodes: CategoryNode[];
  depth?: number;
  expanded: Set<string>;
  selectedId: string | null;
  dropCategoryId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContextCategory: (node: CategoryNode, position: CategoryMenuPosition) => void;
  onContextCategoryKeyboard: (node: CategoryNode, target: HTMLElement) => void;
  onCategoryDragOver: (
    node: CategoryNode,
    event: DragEvent<HTMLDivElement>,
  ) => void;
  onCategoryDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onCategoryDrop: (node: CategoryNode, event: DragEvent<HTMLDivElement>) => void;
}

function CategoryTree({
  nodes,
  depth = 0,
  expanded,
  selectedId,
  dropCategoryId,
  onToggle,
  onSelect,
  onContextCategory,
  onContextCategoryKeyboard,
  onCategoryDragOver,
  onCategoryDragLeave,
  onCategoryDrop,
}: CategoryTreeProps) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(node.id);
        const active = selectedId === node.id;
        return (
          <div key={node.id}>
            <div
              data-sidebar-category-id={node.id}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextCategory(node, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onDragEnter={(event) => onCategoryDragOver(node, event)}
              onDragOver={(event) => onCategoryDragOver(node, event)}
              onDragLeave={onCategoryDragLeave}
              onDrop={(event) => onCategoryDrop(node, event)}
              className={cn(
                "flex h-7 items-center rounded-md pr-1 text-[13px] transition-colors",
                active
                  ? "bg-muted font-medium text-ink"
                  : "text-ink-muted hover:bg-muted/60 hover:text-ink",
                dropCategoryId === node.id &&
                  "bg-brand/10 text-ink ring-1 ring-brand/40",
              )}
              style={{ paddingLeft: 4 + depth * 10 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.id)}
                  aria-label={`${isExpanded ? "折叠" : "展开"}目录 ${node.name}`}
                  aria-expanded={isExpanded}
                  className="flex size-4 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
                >
                  {isExpanded ? (
                    <ChevronDown className="size-2.5" />
                  ) : (
                    <ChevronRight className="size-2.5" />
                  )}
                </button>
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    onContextCategoryKeyboard(node, event.currentTarget);
                  }
                }}
                aria-pressed={active}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title={node.name}
              >
                {dropCategoryId === node.id ? (
                  <FolderOpen className="size-3.5 shrink-0 text-brand" />
                ) : (
                  <CategoryIcon
                    iconName={node.iconName}
                    color={node.color}
                    size={13}
                    className={node.color ? undefined : "text-ink-faint"}
                  />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              <span className="shrink-0 px-1 text-[10px] text-ink-faint">
                {categorySubtreeCount(node)}
              </span>
            </div>
            {hasChildren && isExpanded ? (
              <CategoryTree
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selectedId={selectedId}
                dropCategoryId={dropCategoryId}
                onToggle={onToggle}
                onSelect={onSelect}
                onContextCategory={onContextCategory}
                onContextCategoryKeyboard={onContextCategoryKeyboard}
                onCategoryDragOver={onCategoryDragOver}
                onCategoryDragLeave={onCategoryDragLeave}
                onCategoryDrop={onCategoryDrop}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function NavButton({ view, label, icon: Icon, active, onSelect }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(view)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors",
        active
          ? "bg-muted font-medium text-ink"
          : "text-ink-muted hover:bg-muted/70 hover:text-ink",
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          active ? "text-ink" : "text-ink-faint",
        )}
        strokeWidth={1.8}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function Sidebar() {
  const snapshot = useAppStore((state) => state.snapshot);
  const managerView = useAppStore((state) => state.managerView);
  const setManagerView = useAppStore((state) => state.setManagerView);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const showNotice = useAppStore((state) => state.showNotice);
  const dataRevision = useAppStore((state) => state.dataRevision);
  const promptRevision = useAppStore((state) => state.promptRevision);
  const categoryFilterId = useAppStore((state) => state.categoryFilterId);
  const promptCategoryFilterId = useAppStore(
    (state) => state.promptCategoryFilterId,
  );
  const setCategoryFilter = useAppStore((state) => state.setCategoryFilter);
  const setPromptCategoryFilter = useAppStore(
    (state) => state.setPromptCategoryFilter,
  );
  const categoryManagerRequest = useAppStore(
    (state) => state.categoryManagerRequest,
  );
  const clearCategoryManagerRequest = useAppStore(
    (state) => state.clearCategoryManagerRequest,
  );
  const commandDrag = useAppStore((state) => state.commandDrag);
  const promptDrag = useAppStore((state) => state.promptDrag);
  const endCommandDrag = useAppStore((state) => state.endCommandDrag);
  const endPromptDrag = useAppStore((state) => state.endPromptDrag);
  const openCategoryManager = useAppStore(
    (state) => state.openCategoryManager,
  );
  const { moveToCategory } = useCommandActions();
  const { moveToCategory: movePromptsToCategory } = usePromptActions();

  const scope: CategoryScope = managerView === "prompts" ? "prompt" : "command";
  const [resizing, setResizing] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_SIDEBAR_WIDTH);
  const latestWidth = useRef(DEFAULT_SIDEBAR_WIDTH);
  const [commandCategories, setCommandCategories] = useState<CategoryNode[]>(
    [],
  );
  const [promptCategories, setPromptCategories] = useState<CategoryNode[]>([]);
  const [categoryRefresh, setCategoryRefresh] = useState(0);
  const [promptCategoryRefresh, setPromptCategoryRefresh] = useState(0);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [expandedCommands, setExpandedCommands] = useState<Set<string>>(() =>
    loadExpandedCategories(EXPANDED_CATEGORIES_KEY),
  );
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(() =>
    loadExpandedCategories(PROMPT_EXPANDED_CATEGORIES_KEY),
  );
  const [dropCategoryId, setDropCategoryId] = useState<string | null>(null);
  const [categoryMenu, setCategoryMenu] = useState<{
    category: CategoryNode;
    position: CategoryMenuPosition;
  } | null>(null);
  const [appearanceCategory, setAppearanceCategory] =
    useState<CategoryNode | null>(null);
  const [appearanceAnchor, setAppearanceAnchor] =
    useState<CategoryMenuPosition>({ x: 0, y: 0 });
  const autoExpandTimer = useRef<number | null>(null);
  const autoExpandId = useRef<string | null>(null);

  const categories = scope === "prompt" ? promptCategories : commandCategories;
  const selectedCategoryId =
    scope === "prompt" ? promptCategoryFilterId : categoryFilterId;
  const expandedCategories =
    scope === "prompt" ? expandedPrompts : expandedCommands;
  const activeDrag = commandDrag ?? promptDrag;

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimer.current !== null) {
      window.clearTimeout(autoExpandTimer.current);
      autoExpandTimer.current = null;
    }
    autoExpandId.current = null;
  }, []);

  const setExpanded = (updater: (current: Set<string>) => Set<string>) => {
    if (scope === "prompt") {
      setExpandedPrompts(updater);
    } else {
      setExpandedCommands(updater);
    }
  };

  useEffect(() => {
    let cancelled = false;
    appApi
      .listCategories()
      .then((result) => {
        if (!cancelled) {
          setCommandCategories(result);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showNotice({ kind: "error", message: getUserErrorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataRevision, categoryRefresh, showNotice]);

  useEffect(() => {
    let cancelled = false;
    appApi
      .listPromptCategories()
      .then((result: PromptCategoryNode[]) => {
        if (!cancelled) {
          setPromptCategories(promptCategoriesAsCategoryNodes(result));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showNotice({ kind: "error", message: getUserErrorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [promptRevision, promptCategoryRefresh, showNotice]);

  useEffect(() => {
    if (
      categoryFilterId &&
      categoryFilterId !== UNCLASSIFIED_CATEGORY_ID &&
      !findCategoryById(commandCategories, categoryFilterId)
    ) {
      setCategoryFilter(null);
    }
  }, [commandCategories, categoryFilterId, setCategoryFilter]);

  useEffect(() => {
    if (
      promptCategoryFilterId &&
      promptCategoryFilterId !== UNCLASSIFIED_CATEGORY_ID &&
      !findCategoryById(promptCategories, promptCategoryFilterId)
    ) {
      setPromptCategoryFilter(null);
    }
  }, [promptCategories, promptCategoryFilterId, setPromptCategoryFilter]);

  useEffect(() => {
    if (categoryManagerRequest) {
      setCategoryManagerOpen(true);
    }
  }, [categoryManagerRequest]);

  useEffect(() => {
    if (!activeDrag) {
      setDropCategoryId(null);
      clearAutoExpandTimer();
    }
  }, [activeDrag, clearAutoExpandTimer]);

  useEffect(
    () => () => {
      clearAutoExpandTimer();
    },
    [clearAutoExpandTimer],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        EXPANDED_CATEGORIES_KEY,
        JSON.stringify([...expandedCommands]),
      );
    } catch {
      // Best effort persistence.
    }
  }, [expandedCommands]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PROMPT_EXPANDED_CATEGORIES_KEY,
        JSON.stringify([...expandedPrompts]),
      );
    } catch {
      // Best effort persistence.
    }
  }, [expandedPrompts]);

  if (!snapshot) {
    return null;
  }

  const width = previewWidth ?? snapshot.settings.sidebarWidth;

  const handleCategoryDragOver = (
    node: CategoryNode,
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (!activeDrag || isDragSessionCancelled()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropCategoryId(node.id);
    if (node.children.length > 0 && !expandedCategories.has(node.id)) {
      if (autoExpandId.current !== node.id) {
        clearAutoExpandTimer();
        autoExpandId.current = node.id;
        autoExpandTimer.current = window.setTimeout(() => {
          setExpanded((current) => new Set(current).add(node.id));
          autoExpandId.current = null;
          autoExpandTimer.current = null;
        }, 600);
      }
    } else {
      clearAutoExpandTimer();
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
    clearAutoExpandTimer();
  };

  const dropOnCategory = (
    node: CategoryNode | null,
    event: DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const drag = activeDrag;
    const isPromptDrag = promptDrag !== null;
    setDropCategoryId(null);
    clearAutoExpandTimer();
    if (!drag) {
      return;
    }
    if (isDragSessionCancelled()) {
      if (isPromptDrag) {
        endPromptDrag();
      } else {
        endCommandDrag();
      }
      return;
    }
    if (isPromptDrag) {
      endPromptDrag();
      void movePromptsToCategory(
        drag.ids,
        node?.id ?? null,
        node?.name ?? DEFAULT_CATEGORY_NAME,
      );
    } else {
      endCommandDrag();
      void moveToCategory(
        drag.ids,
        node?.id ?? null,
        node?.name ?? DEFAULT_CATEGORY_NAME,
      );
    }
  };

  const selectView = (view: ManagerView) => {
    if (view === "library") {
      setCategoryFilter(null);
    }
    if (view === "prompts") {
      setPromptCategoryFilter(null);
    }
    setManagerView(view);
  };

  const toggleCategory = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectCategory = (id: string) => {
    if (scope === "prompt") {
      setPromptCategoryFilter(promptCategoryFilterId === id ? null : id);
      setManagerView("prompts");
      return;
    }
    setCategoryFilter(categoryFilterId === id ? null : id);
    setManagerView("library");
  };

  const openCategoryMenu = (
    category: CategoryNode,
    position: CategoryMenuPosition,
  ) => {
    setCategoryMenu({ category, position });
  };

  const siblingsFor = (category: CategoryNode) => {
    if (!category.parentId) {
      return categories;
    }
    return findCategoryById(categories, category.parentId)?.children ?? [];
  };

  const moveCategory = async (category: CategoryNode, direction: -1 | 1) => {
    const siblings = siblingsFor(category);
    const index = siblings.findIndex((node) => node.id === category.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) {
      return;
    }
    const next = [...siblings];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      if (scope === "prompt") {
        await appApi.reorderPromptCategories(
          category.parentId,
          next.map((node) => node.id),
        );
        setPromptCategoryRefresh((value) => value + 1);
      } else {
        await appApi.reorderCategories(
          category.parentId,
          next.map((node) => node.id),
        );
        setCategoryRefresh((value) => value + 1);
      }
      showNotice({ kind: "success", message: "目录顺序已保存" });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    }
  };

  const openAppearance = (
    category: CategoryNode,
    position: CategoryMenuPosition,
  ) => {
    setAppearanceCategory(category);
    setAppearanceAnchor(position);
  };

  const applyAppearance = async (
    category: CategoryNode,
    appearance: CategoryAppearanceInput,
  ) => {
    if (scope === "prompt") {
      await appApi.setPromptCategoryAppearance(category.id, appearance);
      setPromptCategoryRefresh((value) => value + 1);
    } else {
      await appApi.setCategoryAppearance(category.id, appearance);
      setCategoryRefresh((value) => value + 1);
    }
  };

  const categoryMenuNode = categoryMenu
    ? findCategoryById(categories, categoryMenu.category.id)
    : null;
  const categoryMenuSiblings = categoryMenuNode
    ? siblingsFor(categoryMenuNode)
    : [];
  const categoryMenuIndex = categoryMenuNode
    ? categoryMenuSiblings.findIndex((node) => node.id === categoryMenuNode.id)
    : -1;
  const appearanceNode = appearanceCategory
    ? findCategoryById(categories, appearanceCategory.id)
    : null;

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartX.current = event.clientX;
    dragStartWidth.current = width;
    latestWidth.current = width;
    setResizing(true);
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing) {
      return;
    }
    const next = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth.current + event.clientX - dragStartX.current),
    );
    latestWidth.current = next;
    setPreviewWidth(next);
  };

  const finishResize = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
    setPreviewWidth(latestWidth.current);
    try {
      await updateSettings({ sidebarWidth: latestWidth.current });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setPreviewWidth(null);
    }
  };

  const isPromptScope = scope === "prompt";

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-canvas-deep/55"
      style={{ width }}
    >
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pt-2.5" aria-label="主导航">
        {PRIMARY_NAV.slice(0, 3).map((item) => (
          <NavButton
            key={item.view}
            {...item}
            active={managerView === item.view}
            onSelect={selectView}
          />
        ))}

        <div className="my-2 h-px bg-line" />

        {PRIMARY_NAV.slice(3).map((item) => (
          <NavButton
            key={item.view}
            {...item}
            active={managerView === item.view}
            onSelect={selectView}
          />
        ))}

        <div className="my-2 h-px bg-line" />

        <div className="flex h-6 items-center gap-1 px-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">
            {CATEGORY_MODULE_NAME}
          </span>
          <span className="text-[9px] text-ink-faint/80">
            {isPromptScope ? "提示词" : "命令"}
          </span>
          <button
            type="button"
            onClick={() => {
              clearCategoryManagerRequest();
              setCategoryManagerOpen(true);
            }}
            className="ml-auto rounded p-0.5 text-ink-faint transition-colors hover:bg-muted hover:text-ink"
            aria-label="管理目录结构"
            title="管理目录结构"
          >
            <FolderPlus className="size-3" />
          </button>
        </div>

        {categories.length > 0 ? (
          <div className="pb-2">
            <CategoryTree
              nodes={categories}
              expanded={expandedCategories}
              selectedId={selectedCategoryId}
              dropCategoryId={dropCategoryId}
              onToggle={toggleCategory}
              onSelect={selectCategory}
              onContextCategory={openCategoryMenu}
              onContextCategoryKeyboard={(node, target) => {
                const rect = target.getBoundingClientRect();
                openCategoryMenu(node, {
                  x: rect.right - 8,
                  y: rect.bottom + 2,
                });
              }}
              onCategoryDragOver={handleCategoryDragOver}
              onCategoryDragLeave={handleCategoryDragLeave}
              onCategoryDrop={(node, event) => dropOnCategory(node, event)}
            />
          </div>
        ) : (
          <p className="px-2 pb-2 text-[10.5px] leading-4 text-ink-faint">
            暂无目录
          </p>
        )}

        <div
          data-sidebar-category-id={UNCLASSIFIED_CATEGORY_ID}
          onDragEnter={(event) => {
            if (!activeDrag || isDragSessionCancelled()) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropCategoryId(UNCLASSIFIED_CATEGORY_ID);
          }}
          onDragOver={(event) => {
            if (!activeDrag || isDragSessionCancelled()) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropCategoryId(UNCLASSIFIED_CATEGORY_ID);
          }}
          onDragLeave={handleCategoryDragLeave}
          onDrop={(event) => dropOnCategory(null, event)}
          onClick={() => selectCategory(UNCLASSIFIED_CATEGORY_ID)}
          className={cn(
            "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors",
            selectedCategoryId === UNCLASSIFIED_CATEGORY_ID
              ? "bg-muted font-medium text-ink"
              : "text-ink-muted hover:bg-muted/60 hover:text-ink",
            dropCategoryId === UNCLASSIFIED_CATEGORY_ID &&
              "bg-brand/10 text-ink ring-1 ring-brand/40",
          )}
          title={
            activeDrag
              ? "拖到这里移入默认目录"
              : isPromptScope
                ? "查看默认目录中的提示词"
                : "查看默认目录中的命令"
          }
          aria-label="默认目录"
        >
          {dropCategoryId === UNCLASSIFIED_CATEGORY_ID ? (
            <FolderOpen className="size-3.5 shrink-0 text-brand" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-ink-faint" />
          )}
          {DEFAULT_CATEGORY_NAME}
          <span className="ml-auto text-[9.5px] text-ink-faint">
            {activeDrag ? "拖入" : ""}
          </span>
        </div>
      </nav>

      <div className="px-2 pb-2">
        <div className="mb-1 h-px bg-line" />
        <NavButton
          view="settings"
          label="设置"
          icon={Settings2}
          active={managerView === "settings"}
          onSelect={selectView}
        />
      </div>

      <div className="flex h-8 items-center gap-1.5 border-t border-line px-3 text-[10px] text-ink-faint">
        <StatusDot />
        <span>后台运行</span>
        <span className="ml-auto font-mono">v{snapshot.version}</span>
      </div>

      <CategoryContextMenu
        category={categoryMenuNode}
        position={categoryMenu?.position ?? { x: 0, y: 0 }}
        canMoveUp={categoryMenuIndex > 0}
        canMoveDown={
          categoryMenuIndex >= 0 &&
          categoryMenuIndex < categoryMenuSiblings.length - 1
        }
        onClose={() => setCategoryMenu(null)}
        onCreateChild={(category) =>
          openCategoryManager({ parentId: category.id })
        }
        onRename={(category) => openCategoryManager({ editId: category.id })}
        onEditAppearance={(category) =>
          openAppearance(
            category,
            categoryMenu?.position ?? { x: 180, y: 160 },
          )
        }
        onMoveUp={(category) => void moveCategory(category, -1)}
        onMoveDown={(category) => void moveCategory(category, 1)}
        onDelete={(category) =>
          openCategoryManager({ deleteId: category.id })
        }
      />

      {appearanceCategory && appearanceNode ? (
        <CategoryAppearancePopover
          open
          anchor={appearanceAnchor}
          category={appearanceNode}
          onClose={() => setAppearanceCategory(null)}
          onApplyAppearance={(appearance) =>
            applyAppearance(appearanceNode, appearance)
          }
        />
      ) : null}

      <CategoryManager
        key={`${scope}-${categoryManagerRequest?.revision ?? "manual"}`}
        open={categoryManagerOpen}
        scope={scope}
        categories={categories}
        initialParentId={categoryManagerRequest?.parentId ?? null}
        initialEditId={categoryManagerRequest?.editId ?? null}
        initialDeleteId={categoryManagerRequest?.deleteId ?? null}
        onClose={() => {
          setCategoryManagerOpen(false);
          clearCategoryManagerRequest();
        }}
        onChanged={() => {
          if (isPromptScope) {
            setPromptCategoryRefresh((value) => value + 1);
          } else {
            setCategoryRefresh((value) => value + 1);
          }
        }}
      />

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        title="拖动调整侧栏宽度"
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={(event) => void finishResize(event)}
        onPointerCancel={(event) => void finishResize(event)}
        onDoubleClick={() => {
          if (snapshot.settings.sidebarWidth !== DEFAULT_SIDEBAR_WIDTH) {
            void updateSettings({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH }).catch((error) => {
              showNotice({ kind: "error", message: getUserErrorMessage(error) });
            });
          }
        }}
        className={cn(
          "absolute inset-y-0 right-[-2px] z-10 w-1 cursor-col-resize transition-colors hover:bg-line-strong",
          resizing && "bg-line-strong",
        )}
      />
    </aside>
  );
}
