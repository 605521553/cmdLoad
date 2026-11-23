import {
  ArrowUpDown,
  ChevronDown,
  Command as CommandIcon,
  Copy,
  FilterX,
  GripVertical,
  List,
  LoaderCircle,
  Network,
  Palette,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { AiBatchDialog } from "@/features/ai/AiBatchDialog";
import { AiQuickConfirmDialog } from "@/features/ai/AiQuickConfirmDialog";
import { partitionBatchCandidates } from "@/features/ai/batch";
import { useCommandAiAction } from "@/features/ai/useCommandAiAction";
import { CategoryAppearancePopover } from "@/features/appearance/CategoryAppearancePopover";
import {
  ColorPickerPopover,
  type PopoverAnchor,
} from "@/features/appearance/ColorPickerPopover";
import {
  CommandContextMenu,
  type MenuPosition,
} from "@/features/command-actions/CommandContextMenu";
import { useCommandActions } from "@/features/command-actions/useCommandActions";
import { commandLabel } from "@/features/command-display/commandDisplay";
import { CategoryContextMenu } from "@/features/command-manager/CategoryContextMenu";
import {
  CommandTreeView,
  type TreeDropPosition,
} from "@/features/command-manager/CommandTreeView";
import { CommandDetailPanel } from "@/features/command-manager/CommandDetailPanel";
import { CommandEditor } from "@/features/command-manager/CommandEditor";
import { createCommandDragPreview } from "@/features/command-manager/CommandDragPreview";
import {
  beginDragSession,
  cancelDragSession,
  endDragSession,
  isDragSessionCancelled,
} from "@/features/command-manager/dragSession";
import { CommandRow } from "@/features/command-manager/CommandRow";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { MoveToCategoryDialog } from "@/features/command-manager/MoveToCategoryDialog";
import {
  buildCategoryPathMap,
  DEFAULT_CATEGORY_NAME,
  findCategoryNode,
} from "@/features/command-manager/categoryUtils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  CategoryAppearanceInput,
  CategoryNode,
  Command,
  CommandFilter,
  CommandInput,
  CommandSort,
  Tag,
} from "@/types/app";
import { UNCLASSIFIED_CATEGORY_ID } from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage } from "@/utils/errors";

const FILTERS: { value: CommandFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "recent", label: "最近使用" },
  { value: "favorites", label: "收藏" },
];

type LibrarySortMode = "custom" | "recent" | "name";
type LibraryView = "list" | "tree";

const SORT_OPTIONS: { value: LibrarySortMode; label: string }[] = [
  { value: "custom", label: "自定义排序" },
  { value: "recent", label: "最近使用" },
  { value: "name", label: "名称排序" },
];

const LIBRARY_SORT_KEY = "pata-commands.library-sort";
const LIBRARY_VIEW_KEY = "pata-commands.library-view";
const TREE_EXPANDED_KEY = "pata-commands.library-tree-expanded";
const DETAIL_WIDTH_KEY = "pata-commands.library-detail-width";
const DEFAULT_DETAIL_WIDTH = 300;
const MIN_DETAIL_WIDTH = 248;
const MAX_DETAIL_WIDTH = 400;

function loadDetailWidth(): number {
  try {
    const value = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
    if (Number.isFinite(value)) {
      return Math.min(
        MAX_DETAIL_WIDTH,
        Math.max(MIN_DETAIL_WIDTH, value),
      );
    }
  } catch {
    // Best effort persistence.
  }
  return DEFAULT_DETAIL_WIDTH;
}

function querySort(mode: LibrarySortMode): CommandSort {
  if (mode === "recent") {
    return "recent";
  }
  if (mode === "name") {
    return "title";
  }
  return "manual";
}

function loadSortMode(): LibrarySortMode {
  try {
    const value = localStorage.getItem(LIBRARY_SORT_KEY);
    return value === "recent" || value === "name" ? value : "custom";
  } catch {
    return "custom";
  }
}

function loadView(): LibraryView {
  try {
    return localStorage.getItem(LIBRARY_VIEW_KEY) === "tree"
      ? "tree"
      : "list";
  } catch {
    return "list";
  }
}

function loadExpandedTree(): Set<string> {
  try {
    const raw = localStorage.getItem(TREE_EXPANDED_KEY);
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

function collectCategoryIds(node: CategoryNode, output: Set<string>) {
  output.add(node.id);
  for (const child of node.children) {
    collectCategoryIds(child, output);
  }
}

function flattenTreeOrder(
  nodes: CategoryNode[],
  commandsByCategory: Map<string | null, Command[]>,
  includeUnclassified: boolean,
): string[] {
  const output: string[] = [];
  const visit = (node: CategoryNode) => {
    for (const child of node.children) {
      visit(child);
    }
    for (const command of commandsByCategory.get(node.id) ?? []) {
      output.push(command.id);
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  if (includeUnclassified) {
    for (const command of commandsByCategory.get(null) ?? []) {
      output.push(command.id);
    }
  }
  return output;
}

export function LibraryPage() {
  const dataRevision = useAppStore((state) => state.dataRevision);
  const categoryFilterId = useAppStore((state) => state.categoryFilterId);
  const tagFilterId = useAppStore((state) => state.tagFilterId);
  const setCategoryFilter = useAppStore((state) => state.setCategoryFilter);
  const setTagFilter = useAppStore((state) => state.setTagFilter);
  const showNotice = useAppStore((state) => state.showNotice);
  const commandDetailRequest = useAppStore(
    (state) => state.commandDetailRequest,
  );
  const clearCommandDetailRequest = useAppStore(
    (state) => state.clearCommandDetailRequest,
  );
  const commandDrag = useAppStore((state) => state.commandDrag);
  const startCommandDrag = useAppStore((state) => state.startCommandDrag);
  const endCommandDrag = useAppStore((state) => state.endCommandDrag);
  const openCategoryManager = useAppStore(
    (state) => state.openCategoryManager,
  );
  const { copyCommands, toggleFavorite, moveToCategory, deleteCommand } =
    useCommandActions();
  const ai = useCommandAiAction();

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 150);
  const [filter, setFilter] = useState<CommandFilter>("all");
  const [sortMode, setSortMode] = useState<LibrarySortMode>(loadSortMode);
  const [viewMode, setViewMode] = useState<LibraryView>(loadView);
  const [commands, setCommands] = useState<Command[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCommand, setEditingCommand] = useState<Command | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Command | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyingIds, setCopyingIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const [commandMenu, setCommandMenu] = useState<{
    command: Command;
    position: MenuPosition;
  } | null>(null);
  const [categoryMenu, setCategoryMenu] = useState<{
    category: CategoryNode;
    position: MenuPosition;
  } | null>(null);
  const [colorTarget, setColorTarget] = useState<{
    ids: string[];
    anchor: PopoverAnchor;
  } | null>(null);
  const [appearanceTarget, setAppearanceTarget] = useState<{
    id: string;
    anchor: PopoverAnchor;
  } | null>(null);
  const [moveDialogIds, setMoveDialogIds] = useState<string[] | null>(null);
  const [aiBatchOpen, setAiBatchOpen] = useState(false);
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(
    loadExpandedTree,
  );
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [suppressClick, setSuppressClick] = useState(false);
  const [detailCommandId, setDetailCommandId] = useState<string | null>(
    null,
  );
  const [detailWidth, setDetailWidth] = useState(loadDetailWidth);
  const [detailResizing, setDetailResizing] = useState(false);
  const detailResizeStart = useRef({ x: 0, width: 0 });
  const requestSeq = useRef(0);

  const refresh = useCallback(() => {
    setLocalRefresh((value) => value + 1);
  }, []);

  const isUnclassifiedFilter = categoryFilterId === UNCLASSIFIED_CATEGORY_ID;
  const hasQuery = debouncedQuery.trim().length > 0;

  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_SORT_KEY, sortMode);
    } catch {
      // Best effort persistence.
    }
  }, [sortMode]);

  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_VIEW_KEY, viewMode);
    } catch {
      // Best effort persistence.
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TREE_EXPANDED_KEY,
        JSON.stringify([...treeExpanded]),
      );
    } catch {
      // Best effort persistence.
    }
  }, [treeExpanded]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++requestSeq.current;
    setLoading(true);
    setError(null);
    appApi
      .listCommands({
        search: debouncedQuery,
        filter,
        categoryId:
          viewMode === "tree" || isUnclassifiedFilter
            ? undefined
            : categoryFilterId,
        unclassifiedOnly: viewMode === "list" && isUnclassifiedFilter,
        tagId: tagFilterId,
        sort: querySort(sortMode),
        limit: 500,
      })
      .then((result) => {
        if (cancelled || sequence !== requestSeq.current) {
          return;
        }
        setCommands(result);
        setActiveIndex((current) =>
          result.length === 0 ? 0 : Math.min(current, result.length - 1),
        );
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(getUserErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    debouncedQuery,
    filter,
    categoryFilterId,
    isUnclassifiedFilter,
    tagFilterId,
    sortMode,
    viewMode,
    dataRevision,
    localRefresh,
  ]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([appApi.listCategories(), appApi.listTags()])
      .then(([nextCategories, nextTags]) => {
        if (!cancelled) {
          setCategories(nextCategories);
          setTags(nextTags);
        }
      })
      .catch((metaError) => {
        if (!cancelled) {
          showNotice({
            kind: "error",
            message: getUserErrorMessage(metaError),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataRevision, localRefresh, showNotice]);

  useEffect(() => {
    if (!commandDetailRequest) {
      return;
    }
    let cancelled = false;
    appApi
      .getCommand(commandDetailRequest.id)
      .then((command) => {
        if (!cancelled) {
          setEditingCommand(command);
          setEditorOpen(true);
          clearCommandDetailRequest();
        }
      })
      .catch((detailError) => {
        if (!cancelled) {
          showNotice({
            kind: "error",
            message: getUserErrorMessage(detailError),
          });
          clearCommandDetailRequest();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [commandDetailRequest, clearCommandDetailRequest, showNotice]);

  useEffect(() => {
    setActiveIndex(0);
    setDropTarget(null);
  }, [
    debouncedQuery,
    filter,
    categoryFilterId,
    tagFilterId,
    sortMode,
    viewMode,
  ]);

  const selectedNode =
    categoryFilterId && !isUnclassifiedFilter
      ? findCategoryNode(categories, categoryFilterId)
      : null;

  const treeRoots = useMemo(() => {
    if (viewMode !== "tree") {
      return [];
    }
    if (isUnclassifiedFilter) {
      return [];
    }
    return selectedNode ? [selectedNode] : categories;
  }, [viewMode, isUnclassifiedFilter, selectedNode, categories]);

  const treeCommandIds = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    const ids = new Set<string>();
    collectCategoryIds(selectedNode, ids);
    return ids;
  }, [selectedNode]);

  const treeCommands = useMemo(() => {
    if (viewMode !== "tree") {
      return [];
    }
    if (isUnclassifiedFilter) {
      return commands.filter((command) => command.categoryId === null);
    }
    if (treeCommandIds) {
      return commands.filter(
        (command) =>
          command.categoryId !== null &&
          treeCommandIds.has(command.categoryId),
      );
    }
    return commands;
  }, [viewMode, isUnclassifiedFilter, commands, treeCommandIds]);

  const treeShowUnclassified =
    viewMode === "tree" && !selectedNode;
  const treeForceExpanded =
    viewMode === "tree" &&
    (hasQuery || filter !== "all" || tagFilterId !== null || categoryFilterId !== null);

  const commandsByCategory = useMemo(() => {
    const map = new Map<string | null, Command[]>();
    for (const command of treeCommands) {
      const list = map.get(command.categoryId);
      if (list) {
        list.push(command);
      } else {
        map.set(command.categoryId, [command]);
      }
    }
    return map;
  }, [treeCommands]);

  const visibleOrderIds = useMemo(() => {
    if (viewMode === "list") {
      return commands.map((command) => command.id);
    }
    return flattenTreeOrder(
      treeRoots,
      commandsByCategory,
      treeShowUnclassified,
    );
  }, [viewMode, commands, treeRoots, commandsByCategory, treeShowUnclassified]);

  useEffect(() => {
    const visible = new Set(visibleOrderIds);
    setSelectedIds((current) => {
      const next = current.filter((id) => visible.has(id));
      if (
        next.length === current.length &&
        next.every((id, index) => id === current[index])
      ) {
        return current;
      }
      return next;
    });
    setLastSelectedId((current) =>
      current && visible.has(current) ? current : null,
    );
  }, [visibleOrderIds]);

  const visibleCommands = viewMode === "list" ? commands : treeCommands;
  const categoryFilterName = isUnclassifiedFilter
    ? DEFAULT_CATEGORY_NAME
    : findCategoryNode(categories, categoryFilterId)?.name ?? null;
  const tagFilterName = tags.find((tag) => tag.id === tagFilterId)?.name ?? null;
  const categoryPathMap = useMemo(
    () => buildCategoryPathMap(categories),
    [categories],
  );
  const detailCommand = useMemo(
    () =>
      commands.find((command) => command.id === detailCommandId) ??
      commands[activeIndex] ??
      null,
    [commands, detailCommandId, activeIndex],
  );
  const detailCategoryPath = detailCommand?.categoryId
    ? categoryPathMap.get(detailCommand.categoryId) ?? detailCommand.categoryName
    : null;

  useEffect(() => {
    if (viewMode !== "list") {
      return;
    }
    const command = commands[activeIndex];
    if (command) {
      setDetailCommandId(command.id);
    }
  }, [activeIndex, commands, viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
    } catch {
      // Best effort persistence.
    }
  }, [detailWidth]);

  const canReorder =
    sortMode === "custom" &&
    filter === "all" &&
    !hasQuery &&
    !tagFilterId;
  const canDrag = visibleCommands.length > 0;
  const commandMenuScope = commandMenu
    ? viewMode === "tree"
      ? commands.filter(
          (command) =>
            command.categoryId === commandMenu.command.categoryId,
        )
      : commands
    : [];
  const commandMenuIndex = commandMenu
    ? commandMenuScope.findIndex(
        (command) => command.id === commandMenu.command.id,
      )
    : -1;
  const canMoveUp = canReorder && commandMenuIndex > 0;
  const canMoveDown =
    canReorder &&
    commandMenuIndex >= 0 &&
    commandMenuIndex < commandMenuScope.length - 1;
  const moveSortHint = !canReorder
    ? "仅自定义排序可上移、下移"
    : null;
  const selectedCommands = selectedIds
    .map((id) => commands.find((command) => command.id === id))
    .filter((command): command is Command => Boolean(command));
  const batchEligibleCount = partitionBatchCandidates(selectedCommands)
    .eligible.length;
  const colorTargetCommands = (colorTarget?.ids ?? [])
    .map((id) => commands.find((command) => command.id === id))
    .filter((command): command is Command => Boolean(command));
  const appearanceCategory = appearanceTarget
    ? findCategoryNode(categories, appearanceTarget.id)
    : null;
  const appearanceIdsFor = (command: Command) =>
    selectedIds.includes(command.id) && selectedIds.length > 1
      ? selectedIds.filter((id) =>
          commands.some((item) => item.id === id),
        )
      : [command.id];
  const commandMenuTargets = commandMenu
    ? appearanceIdsFor(commandMenu.command)
        .map((id) => commands.find((command) => command.id === id))
        .filter((command): command is Command => Boolean(command))
    : [];
  const commandMenuAllFollow =
    commandMenuTargets.length > 0 &&
    commandMenuTargets.every((command) => command.useCategoryColor);
  const hasMixedSelection =
    new Set(selectedCommands.map((command) => command.shell)).size > 1;
  const hasMultilineSelection = selectedCommands.some((command) =>
    command.command.includes("\n"),
  );

  const selectionOrder = (id: string) => selectedIds.indexOf(id) + 1;

  const recordCopy = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      setCopyingIds(ids);
      try {
        const outcome = await copyCommands(ids);
        if (outcome) {
          setSelectedIds([]);
          setLastSelectedId(null);
          refresh();
        }
      } finally {
        setCopyingIds([]);
      }
    },
    [copyCommands, refresh],
  );

  const toggleSelected = (command: Command) => {
    if (selectedIds.includes(command.id)) {
      setSelectedIds((current) =>
        current.filter((id) => id !== command.id),
      );
      if (lastSelectedId === command.id) {
        setLastSelectedId(
          selectedIds.find((id) => id !== command.id) ?? null,
        );
      }
      return;
    }
    setSelectedIds((current) => [...current, command.id]);
    setLastSelectedId(command.id);
  };

  const selectRange = (command: Command) => {
    const anchor = lastSelectedId;
    const targetIndex = visibleOrderIds.indexOf(command.id);
    const anchorIndex = anchor ? visibleOrderIds.indexOf(anchor) : -1;
    if (targetIndex < 0) {
      return;
    }
    if (anchorIndex < 0) {
      setSelectedIds((current) =>
        current.includes(command.id) ? current : [...current, command.id],
      );
      setLastSelectedId(command.id);
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const range = visibleOrderIds.slice(start, end + 1);
    setSelectedIds((current) => {
      const next = [...current];
      for (const id of range) {
        if (!next.includes(id)) {
          next.push(id);
        }
      }
      return next;
    });
  };

  const handleCommandClick = (command: Command, event: MouseEvent) => {
    setDetailCommandId(command.id);
    const index = commands.findIndex((item) => item.id === command.id);
    if (index >= 0) {
      setActiveIndex(index);
    }
    if (suppressClick) {
      setSuppressClick(false);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      toggleSelected(command);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      selectRange(command);
      return;
    }
    void recordCopy([command.id]);
  };

  const copySelectionOrder = () => {
    if (selectedIds.length > 0) {
      void recordCopy(selectedIds);
    }
  };

  const copyListOrder = () => {
    const ordered = visibleOrderIds.filter((id) => selectedIds.includes(id));
    if (ordered.length > 0) {
      void recordCopy(ordered);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        editorOpen ||
        deleteTarget ||
        commandMenu ||
        categoryMenu ||
        colorTarget ||
        appearanceTarget ||
        moveDialogIds ||
        aiBatchOpen ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      if (tag === "input" && (target as HTMLInputElement).type !== "search") {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (visibleCommands.length === 0) {
          return;
        }
        event.preventDefault();
        setActiveIndex((current) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return Math.min(
            visibleCommands.length - 1,
            Math.max(0, current + delta),
          );
        });
        return;
      }
      if (event.key === "Enter" && viewMode === "list") {
        if (tag === "button" || tag === "a") {
          return;
        }
        const command = commands[activeIndex];
        if (command) {
          event.preventDefault();
          void recordCopy([command.id]);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeIndex,
    appearanceTarget,
    categoryMenu,
    colorTarget,
    commandMenu,
    commands,
    deleteTarget,
    editorOpen,
    moveDialogIds,
    aiBatchOpen,
    recordCopy,
    viewMode,
    visibleCommands.length,
  ]);

  useEffect(() => {
    const command = commands[activeIndex];
    if (!command || viewMode !== "list") {
      return;
    }
    const element = document.querySelector(
      `[data-command-id="${command.id}"]`,
    ) as HTMLElement | null;
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, commands, viewMode]);

  const openCreate = () => {
    setEditingCommand(null);
    setEditorOpen(true);
  };

  const saveCommand = async (input: CommandInput) => {
    if (editingCommand) {
      await appApi.updateCommand(editingCommand.id, input);
      showNotice({ kind: "success", message: "命令已更新" });
    } else {
      await appApi.createCommand(input);
      showNotice({ kind: "success", message: "命令已保存到本地数据库" });
    }
    setEditorOpen(false);
    setEditingCommand(null);
    refresh();
  };

  const favorite = async (command: Command) => {
    await toggleFavorite(command);
    refresh();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      const removed = await deleteCommand(deleteTarget);
      if (removed) {
        setDeleteTarget(null);
        setSelectedIds((current) =>
          current.filter((id) => id !== deleteTarget.id),
        );
        refresh();
      }
    } finally {
      setDeleting(false);
    }
  };

  const openMoveDialog = (ids: string[]) => {
    if (ids.length > 0) {
      setMoveDialogIds(ids);
    }
  };

  const performMove = async (
    ids: string[],
    categoryId: string | null,
    label: string,
  ) => {
    const result = await moveToCategory(ids, categoryId, label);
    if (result?.moved) {
      refresh();
    }
  };

  const openCommandMenu = (command: Command, position: MenuPosition) => {
    setDetailCommandId(command.id);
    const index = commands.findIndex((item) => item.id === command.id);
    if (index >= 0) {
      setActiveIndex(index);
    }
    setCommandMenu({ command, position });
  };

  const openCommandColor = (command: Command) => {
    setColorTarget({
      ids: appearanceIdsFor(command),
      anchor: commandMenu?.position ?? { x: 220, y: 200 },
    });
  };

  const openSelectionColor = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setColorTarget({
      ids: selectedCommands.map((command) => command.id),
      anchor: { x: rect.left, y: rect.bottom + 6 },
    });
  };

  const applyCommandColor = async (color: string | null) => {
    const target = colorTarget;
    if (!target) {
      return;
    }
    await appApi.setCommandsColor(target.ids, color);
    setColorTarget(null);
    refresh();
  };

  const applyCommandFollow = async (enabled: boolean) => {
    const target = colorTarget;
    if (!target) {
      return;
    }
    await appApi.setCommandsFollowCategoryColor(target.ids, enabled);
    refresh();
  };

  const toggleFollowCategoryColor = async (command: Command) => {
    const ids = appearanceIdsFor(command);
    const targets = ids
      .map((id) => commands.find((item) => item.id === id))
      .filter((item): item is Command => Boolean(item));
    const allFollow =
      targets.length > 0 &&
      targets.every((item) => item.useCategoryColor);
    try {
      await appApi.setCommandsFollowCategoryColor(ids, !allFollow);
      refresh();
    } catch (followError) {
      showNotice({
        kind: "error",
        message: getUserErrorMessage(followError),
      });
    }
  };

  const openCategoryAppearance = (category: CategoryNode) => {
    setAppearanceTarget({
      id: category.id,
      anchor: categoryMenu?.position ?? { x: 220, y: 200 },
    });
  };

  const applyCategoryAppearance = async (
    appearance: CategoryAppearanceInput,
  ) => {
    const target = appearanceTarget;
    if (!target) {
      return;
    }
    await appApi.setCategoryAppearance(target.id, appearance);
    refresh();
  };

  const moveCommandByOffset = async (
    command: Command,
    direction: -1 | 1,
  ) => {
    if (!canReorder) {
      return;
    }
    const scoped =
      viewMode === "tree"
        ? commands.filter(
            (item) => item.categoryId === command.categoryId,
          )
        : commands;
    const index = scoped.findIndex((item) => item.id === command.id);
    const targetIndex = index + direction;
    if (
      index < 0 ||
      targetIndex < 0 ||
      targetIndex >= scoped.length
    ) {
      return;
    }
    const nextScoped = [...scoped];
    [nextScoped[index], nextScoped[targetIndex]] = [
      nextScoped[targetIndex],
      nextScoped[index],
    ];
    const previous = commands;
    let next: Command[];
    if (viewMode === "tree") {
      next = [...commands];
      let cursor = 0;
      for (let position = 0; position < next.length; position += 1) {
        if (next[position].categoryId === command.categoryId) {
          next[position] = nextScoped[cursor];
          cursor += 1;
        }
      }
    } else {
      next = nextScoped;
    }
    setCommands(next);
    try {
      await appApi.reorderCommands(
        nextScoped.map((item) => item.id),
      );
      showNotice({
        kind: "success",
        message: direction < 0 ? "命令已上移" : "命令已下移",
      });
    } catch (moveError) {
      setCommands(previous);
      showNotice({
        kind: "error",
        message: getUserErrorMessage(moveError),
      });
    }
  };

  const createCategoryForMenu = async (
    parentId: string | null,
    name: string,
  ) => {
    try {
      const id = await appApi.createCategory({ name, parentId });
      refresh();
      return id;
    } catch (createError) {
      showNotice({
        kind: "error",
        message: getUserErrorMessage(createError),
      });
      return null;
    }
  };

  const viewCommand = (command: Command) => {
    const index = commands.findIndex((item) => item.id === command.id);
    if (index >= 0) {
      setActiveIndex(index);
    }
  };

  const beginCommandDrag = (
    event: DragEvent<HTMLButtonElement>,
    command: Command,
    source: "library" | "tree",
  ) => {
    const dragIds =
      selectedIds.includes(command.id) && selectedIds.length > 1
        ? selectedIds
            .slice()
            .sort(
              (left, right) =>
                visibleOrderIds.indexOf(left) -
                visibleOrderIds.indexOf(right),
            )
        : [command.id];
    beginDragSession();
    startCommandDrag(dragIds, source);
    setDraggingId(command.id);
    setSuppressClick(true);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-pata-commands",
      JSON.stringify(dragIds),
    );
    event.dataTransfer.setData("text/plain", commandLabel(command));

    const preview = createCommandDragPreview(command, dragIds.length);
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 14, 14);
    window.setTimeout(() => preview.remove(), 0);
  };

  const endDrag = () => {
    endDragSession();
    setDraggingId(null);
    setDropTarget(null);
    endCommandDrag();
    window.setTimeout(() => {
      setSuppressClick(false);
    }, 0);
  };

  useEffect(() => {
    if (!commandDrag) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      cancelDragSession();
      setDraggingId(null);
      setDropTarget(null);
      endCommandDrag();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [commandDrag, endCommandDrag]);

  const handleRowDragOver = (
    event: DragEvent<HTMLDivElement>,
    target: Command,
  ) => {
    if (
      !canReorder ||
      viewMode !== "list" ||
      !commandDrag ||
      commandDrag.source !== "library" ||
      commandDrag.ids.includes(target.id) ||
      isDragSessionCancelled()
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({
      id: target.id,
      position:
        event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };

  const handleRowDrop = async (
    event: DragEvent<HTMLDivElement>,
    target: Command,
  ) => {
    event.preventDefault();
    if (
      !canReorder ||
      viewMode !== "list" ||
      !commandDrag ||
      commandDrag.source !== "library" ||
      isDragSessionCancelled()
    ) {
      return;
    }
    const position =
      dropTarget?.id === target.id ? dropTarget.position : "after";
    const dragged = commandDrag.ids;
    setDropTarget(null);
    endCommandDrag();
    const remaining = commands.filter(
      (command) => !dragged.includes(command.id),
    );
    const targetIndex = remaining.findIndex(
      (command) => command.id === target.id,
    );
    if (targetIndex < 0) {
      return;
    }
    const draggedCommands = commands.filter((command) =>
      dragged.includes(command.id),
    );
    const next = [...remaining];
    next.splice(
      targetIndex + (position === "after" ? 1 : 0),
      0,
      ...draggedCommands,
    );
    const previous = commands;
    setCommands(next);
    try {
      await appApi.reorderCommands(next.map((command) => command.id));
      showNotice({ kind: "success", message: "命令顺序已保存" });
    } catch (reorderError) {
      setCommands(previous);
      showNotice({
        kind: "error",
        message: getUserErrorMessage(reorderError),
      });
    }
  };

  const reorderTreeCommands = async (
    draggingIds: string[],
    target: Command,
    position: TreeDropPosition,
  ) => {
    if (!canReorder || draggingIds.length === 0) {
      return;
    }
    const targetCategory = target.categoryId;
    const dragged = commands.filter((command) =>
      draggingIds.includes(command.id),
    );
    if (
      dragged.length !== draggingIds.length ||
      dragged.some((command) => command.categoryId !== targetCategory)
    ) {
      return;
    }
    const group = commands.filter(
      (command) => command.categoryId === targetCategory,
    );
    const remaining = group.filter(
      (command) => !draggingIds.includes(command.id),
    );
    const targetIndex = remaining.findIndex(
      (command) => command.id === target.id,
    );
    if (targetIndex < 0) {
      return;
    }
    const nextGroup = [...remaining];
    nextGroup.splice(
      targetIndex + (position === "after" ? 1 : 0),
      0,
      ...dragged,
    );
    const previous = commands;
    const next = commands.map((command) => command);
    const groupIds = nextGroup.map((command) => command.id);
    let groupCursor = 0;
    for (let index = 0; index < next.length; index += 1) {
      if (next[index].categoryId === targetCategory) {
        const replacement = nextGroup[groupCursor];
        if (replacement) {
          next[index] = replacement;
        }
        groupCursor += 1;
      }
    }
    if (groupIds.length === 0) {
      return;
    }
    setCommands(next);
    try {
      await appApi.reorderCommands(groupIds);
      showNotice({ kind: "success", message: "目录内命令顺序已保存" });
    } catch (reorderError) {
      setCommands(previous);
      showNotice({
        kind: "error",
        message: getUserErrorMessage(reorderError),
      });
    }
  };

  const dropCommandsOnCategory = async (
    ids: string[],
    categoryId: string | null,
    label: string,
  ) => {
    endDrag();
    await performMove(ids, categoryId, label);
  };

  const toggleCategory = (id: string) => {
    setTreeExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandCategory = (id: string) => {
    setTreeExpanded((current) => new Set(current).add(id));
  };

  const openCategoryContextMenu = (
    category: CategoryNode,
    position: MenuPosition,
  ) => {
    setCategoryMenu({ category, position });
  };

  const siblingsFor = (category: CategoryNode) => {
    if (!category.parentId) {
      return categories;
    }
    return (
      findCategoryNode(categories, category.parentId)?.children ?? []
    );
  };

  const moveCategory = async (
    category: CategoryNode,
    direction: -1 | 1,
  ) => {
    const siblings = siblingsFor(category);
    const index = siblings.findIndex((node) => node.id === category.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) {
      return;
    }
    const next = [...siblings];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await appApi.reorderCategories(
        category.parentId,
        next.map((node) => node.id),
      );
      showNotice({ kind: "success", message: "目录顺序已保存" });
    } catch (sortError) {
      showNotice({
        kind: "error",
        message: getUserErrorMessage(sortError),
      });
    }
  };

  const clearFilters = () => {
    setQuery("");
    setFilter("all");
    setCategoryFilter(null);
    setTagFilter(null);
  };

  const hasFilters = hasQuery || filter !== "all" || !!categoryFilterId || !!tagFilterId;
  const categoryMenuSiblings = categoryMenu
    ? siblingsFor(categoryMenu.category)
    : [];
  const categoryMenuIndex = categoryMenu
    ? categoryMenuSiblings.findIndex(
        (node) => node.id === categoryMenu.category.id,
      )
    : -1;

  const beginDetailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    detailResizeStart.current = {
      x: event.clientX,
      width: detailWidth,
    };
    setDetailResizing(true);
  };

  const resizeDetail = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!detailResizing) {
      return;
    }
    const next = Math.min(
      MAX_DETAIL_WIDTH,
      Math.max(
        MIN_DETAIL_WIDTH,
        detailResizeStart.current.width +
          (detailResizeStart.current.x - event.clientX),
      ),
    );
    setDetailWidth(next);
  };

  const finishDetailResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!detailResizing) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDetailResizing(false);
  };

  const renderList = () => (
    <div role="listbox" aria-label="命令列表">
      {commands.map((command, index) => (
        <CommandRow
          key={command.id}
          command={command}
          active={index === activeIndex}
          selected={selectedIds.includes(command.id)}
          selectionOrder={selectionOrder(command.id)}
          dragging={draggingId === command.id}
          canDrag={canDrag}
          dropPosition={
            dropTarget?.id === command.id ? dropTarget.position : null
          }
          onActivate={() => setActiveIndex(index)}
          onRowClick={(event) => handleCommandClick(command, event)}
          onCopy={() => void recordCopy([command.id])}
          onToggleFavorite={() => void favorite(command)}
          onToggleSelected={() => toggleSelected(command)}
          onEdit={() => {
            setEditingCommand(command);
            setEditorOpen(true);
          }}
          onDelete={() => setDeleteTarget(command)}
          onContextMenu={(event) => {
            event.preventDefault();
            openCommandMenu(command, {
              x: event.clientX,
              y: event.clientY,
            });
          }}
          onContextMenuKeyboard={(target) => {
            const rect = target.getBoundingClientRect();
            openCommandMenu(command, {
              x: rect.right - 8,
              y: rect.bottom + 2,
            });
          }}
          dragHint={
            canReorder
              ? "拖动排序，或拖到左侧目录"
              : "拖动到左侧目录"
          }
          onTagClick={(tagId) => setTagFilter(tagId)}
          onDragStart={(event) => beginCommandDrag(event, command, "library")}
          onDragOver={(event) => handleRowDragOver(event, command)}
          onDrop={(event) => void handleRowDrop(event, command)}
          onDragEnd={endDrag}
        />
      ))}
    </div>
  );

  return (
    <section
      aria-labelledby="library-heading"
      className="flex h-full min-h-0 overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h1 id="library-heading" className="sr-only">
          命令库
        </h1>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              placeholder="搜索命令、注释或标签"
              aria-label="搜索命令"
              className="h-8"
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            aria-label="添加命令"
            className="shrink-0"
          >
            <Plus />
            添加命令
          </Button>
        </div>

        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
          <div
            className="flex items-center rounded-[8px] border border-line/80 bg-muted/55 p-0.5"
            aria-label="命令筛选"
            role="group"
          >
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={cn(
                  "h-5 rounded-[6px] px-1.5 text-[10px] transition-colors",
                  filter === item.value
                    ? "bg-surface font-medium text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="tabular-nums">
            {loading ? "加载中…" : `${visibleCommands.length} 条`}
          </span>
        <label className="relative ml-auto flex items-center gap-1">
          <ArrowUpDown className="size-2.5" />
          <span className="sr-only">排序方式</span>
          <select
            value={sortMode}
            onChange={(event) =>
              setSortMode(event.target.value as LibrarySortMode)
            }
            aria-label="排序方式"
            className="h-5 appearance-none rounded border border-line bg-surface pl-1.5 pr-5 text-[10px] text-ink-muted outline-none hover:border-line-strong"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 size-2.5" />
        </label>
        <div
          className="flex items-center rounded border border-line bg-surface p-0.5"
          role="group"
          aria-label="命令库视图"
        >
          <button
            type="button"
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode("list")}
            className={cn(
              "flex h-5 items-center gap-1 rounded px-1.5 text-[10px]",
              viewMode === "list"
                ? "bg-muted text-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <List className="size-2.5" />
            列表
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "tree"}
            onClick={() => setViewMode("tree")}
            className={cn(
              "flex h-5 items-center gap-1 rounded px-1.5 text-[10px]",
              viewMode === "tree"
                ? "bg-muted text-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <Network className="size-2.5" />
            树状
          </button>
        </div>
        {tags.length > 0 ? (
          <label className="relative flex items-center gap-1">
            <span className="sr-only">按标签筛选</span>
            <select
              value={tagFilterId ?? ""}
              onChange={(event) => setTagFilter(event.target.value || null)}
              className="h-5 appearance-none rounded border border-line bg-surface pl-1.5 pr-5 text-[10px] text-ink-muted outline-none hover:border-line-strong"
            >
              <option value="">所有标签</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  #{tag.name} ({tag.commandCount})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1 size-2.5" />
          </label>
        ) : null}
        {tagFilterName ? (
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-px text-[10px] text-ink-muted hover:text-ink"
          >
            #{tagFilterName}
            <X className="size-2.5" />
          </button>
        ) : null}
        {categoryFilterName ? (
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-px text-[10px] text-ink-muted hover:text-ink"
          >
            目录：{categoryFilterName}
            <X className="size-2.5" />
          </button>
        ) : null}
        {hasFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-0.5 text-[10px] text-ink-faint hover:text-ink"
          >
            <FilterX className="size-2.5" />
            清除筛选
          </button>
        ) : null}
      </div>

      {selectedIds.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-muted">
          <span className="shrink-0">已选择 {selectedIds.length} 条</span>
          <Button
            variant="primary"
            size="sm"
            className="h-6 px-2 text-[10.5px]"
            onClick={copySelectionOrder}
            disabled={copyingIds.length > 0}
          >
            <Copy />
            按选择顺序复制
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-[10.5px]"
            onClick={copyListOrder}
            disabled={copyingIds.length > 0}
          >
            按列表顺序复制
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10.5px]"
            onClick={(event) => openSelectionColor(event.currentTarget)}
            disabled={copyingIds.length > 0}
          >
            <Palette />
            设置颜色
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10.5px]"
            onClick={() => openMoveDialog(selectedIds)}
            disabled={copyingIds.length > 0}
          >
            移动到目录
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10.5px]"
            onClick={() => setAiBatchOpen(true)}
            disabled={copyingIds.length > 0 || batchEligibleCount === 0}
            title={
              batchEligibleCount === 0
                ? "所选命令都已有注释或正在生成"
                : `只为 ${batchEligibleCount} 条没有注释的命令生成`
            }
          >
            <Sparkles />
            批量 AI 注释
            {batchEligibleCount > 0 ? ` (${batchEligibleCount})` : ""}
          </Button>
          {hasMixedSelection || hasMultilineSelection ? (
            <span className="text-[9.5px] text-amber">
              混合 Shell 或多行命令将按换行拼接，可能不能作为一个脚本连续执行。
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSelectedIds([]);
              setLastSelectedId(null);
            }}
            className="ml-auto text-[10px] text-ink-faint hover:text-ink"
          >
            取消选择
          </button>
        </div>
      ) : null}

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface shadow-sm">
        {error ? (
          <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <p className="text-[12px] text-danger">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => refresh()}>
              重试
            </Button>
          </div>
        ) : loading && commands.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center gap-2 text-[12px] text-ink-faint">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在读取命令库…
          </div>
        ) : viewMode === "tree" ? (
          treeCommands.length === 0 && treeRoots.length === 0 ? (
            <EmptyState
              compact
              icon={<CommandIcon className="size-4" />}
              title={hasQuery ? "未找到命令" : "暂无命令"}
              description={
                hasQuery
                  ? "尝试其他关键词，或清除筛选条件。"
                  : "添加命令后，会在这里按目录展示。"
              }
            />
          ) : (
            <CommandTreeView
              commands={treeCommands}
              categories={treeRoots}
              expanded={treeExpanded}
              forceExpanded={treeForceExpanded}
              selectedIds={selectedIds}
              canReorder={canReorder}
              draggingIds={commandDrag?.ids ?? []}
              onToggleCategory={toggleCategory}
              onExpandCategory={expandCategory}
              onCommandClick={handleCommandClick}
              onActivateCommand={(command) =>
                setDetailCommandId(command.id)
              }
              onToggleSelected={toggleSelected}
              onToggleFavorite={(command) => void favorite(command)}
              onContextCommand={openCommandMenu}
              onContextCategory={openCategoryContextMenu}
              onDragStartCommand={(event, command) =>
                beginCommandDrag(event, command, "tree")
              }
              onDragEnd={endDrag}
              onReorderCommand={(ids, target, position) =>
                void reorderTreeCommands(ids, target, position)
              }
              onMoveToCategory={(ids, categoryId, label) => {
                void dropCommandsOnCategory(ids, categoryId, label);
              }}
            />
          )
        ) : commands.length === 0 ? (
          <EmptyState
            compact
            icon={<CommandIcon className="size-4" />}
            title={
              hasQuery
                ? "未找到命令"
                : filter === "favorites"
                  ? "暂无收藏命令"
                  : filter === "recent"
                    ? "还没有使用记录"
                    : categoryFilterId
                      ? "此目录暂无命令"
                      : "暂无命令"
            }
            description={
              hasQuery
                ? "尝试其他关键词，或清除筛选条件。"
                : filter === "favorites"
                  ? "在命令卡片上点击星标即可收藏。"
                  : filter === "recent"
                    ? "复制命令后会自动记录最近使用。"
                    : categoryFilterId
                      ? "可以把命令移动到这个目录。"
                      : "添加第一条命令，开始建立本地命令库。"
            }
            action={
              hasFilters && !hasQuery ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  清除筛选
                </Button>
              ) : !hasQuery ? (
                <Button variant="primary" size="sm" onClick={openCreate}>
                  <Plus />
                  添加命令
                </Button>
              ) : null
            }
          />
        ) : (
          renderList()
        )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整命令详情宽度"
        aria-valuemin={MIN_DETAIL_WIDTH}
        aria-valuemax={MAX_DETAIL_WIDTH}
        aria-valuenow={detailWidth}
        title="拖动调整详情宽度"
        onPointerDown={beginDetailResize}
        onPointerMove={resizeDetail}
        onPointerUp={finishDetailResize}
        onPointerCancel={finishDetailResize}
        onDoubleClick={() => setDetailWidth(DEFAULT_DETAIL_WIDTH)}
        className={cn(
          "group relative z-10 -ml-px hidden w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-line-strong/70 min-[860px]:block",
          detailResizing && "bg-brand/40",
        )}
      >
        <span className="pointer-events-none absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-line" />
        <span className="pointer-events-none absolute left-1/2 top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink-faint opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          <GripVertical className="size-2.5" />
        </span>
      </div>

      <CommandDetailPanel
        command={detailCommand}
        categoryPath={detailCategoryPath}
        width={detailWidth}
        onCopy={(command) => void recordCopy([command.id])}
        onEdit={(command) => {
          setEditingCommand(command);
          setEditorOpen(true);
        }}
        onToggleFavorite={(command) => void favorite(command)}
        onDelete={(command) => setDeleteTarget(command)}
        onTagClick={(tagId) => setTagFilter(tagId)}
        onCommandUpdated={() => refresh()}
      />

      <CommandEditor
        open={editorOpen}
        command={editingCommand}
        categories={categories}
        defaultCategoryId={
          categoryFilterId === UNCLASSIFIED_CATEGORY_ID
            ? null
            : categoryFilterId
        }
        onClose={() => {
          setEditorOpen(false);
          setEditingCommand(null);
        }}
        onSave={saveCommand}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除命令"
        description={
          deleteTarget ? (
            <>
              确认删除「{commandLabel(deleteTarget)}」？删除后该命令会从命令库隐藏，但数据库保留原始记录，后续可通过备份或恢复流程找回。
            </>
          ) : null
        }
        confirmLabel="删除命令"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
      />

      <CommandContextMenu
        context="manager"
        command={commandMenu?.command ?? null}
        position={commandMenu?.position ?? { x: 0, y: 0 }}
        categories={categories}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        sortHint={moveSortHint}
        selectionCount={Math.max(1, commandMenuTargets.length)}
        allFollowCategoryColor={commandMenuAllFollow}
        aiAction={
          commandMenu && commandMenuTargets.length <= 1
            ? ai.menuAction(commandMenu.command)
            : undefined
        }
        onClose={() => setCommandMenu(null)}
        onCopy={(command) => void recordCopy([command.id])}
        onEdit={(command) => {
          setEditingCommand(command);
          setEditorOpen(true);
        }}
        onToggleFavorite={(command) => void favorite(command)}
        onSetColor={openCommandColor}
        onToggleCategoryColor={(command) =>
          void toggleFollowCategoryColor(command)
        }
        onMoveUp={(command) => void moveCommandByOffset(command, -1)}
        onMoveDown={(command) => void moveCommandByOffset(command, 1)}
        onMove={(command, categoryId, label) =>
          performMove([command.id], categoryId, label)
        }
        onView={viewCommand}
        onDelete={(command) => setDeleteTarget(command)}
        onCreateCategory={createCategoryForMenu}
      />

      <AiQuickConfirmDialog
        open={ai.confirmation !== null}
        command={ai.confirmation?.command ?? null}
        sensitive={ai.confirmation?.sensitive ?? false}
        hasManual={ai.confirmation?.hasManual ?? false}
        hasAi={ai.confirmation?.hasAi ?? false}
        onConfirm={() => void ai.confirm()}
        onClose={ai.cancel}
      />

      <CategoryContextMenu
        category={categoryMenu?.category ?? null}
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
        onRename={(category) =>
          openCategoryManager({ editId: category.id })
        }
        onEditAppearance={openCategoryAppearance}
        onMoveUp={(category) => void moveCategory(category, -1)}
        onMoveDown={(category) => void moveCategory(category, 1)}
        onDelete={(category) =>
          openCategoryManager({ deleteId: category.id })
        }
      />

      <MoveToCategoryDialog
        open={moveDialogIds !== null}
        count={moveDialogIds?.length ?? 0}
        categories={categories}
        onClose={() => setMoveDialogIds(null)}
        onMove={(categoryId, label) =>
          performMove(moveDialogIds ?? [], categoryId, label)
        }
      />

      <AiBatchDialog
        open={aiBatchOpen}
        commands={selectedCommands}
        onClose={() => setAiBatchOpen(false)}
      />

      <ColorPickerPopover
        open={colorTarget !== null}
        anchor={colorTarget?.anchor ?? { x: 0, y: 0 }}
        commands={colorTargetCommands}
        onClose={() => setColorTarget(null)}
        onApplyColor={applyCommandColor}
        onFollowCategoryColor={applyCommandFollow}
      />

      {appearanceCategory ? (
        <CategoryAppearancePopover
          open
          anchor={appearanceTarget?.anchor ?? { x: 0, y: 0 }}
          category={appearanceCategory}
          onClose={() => setAppearanceTarget(null)}
          onApplyAppearance={applyCategoryAppearance}
        />
      ) : null}
    </section>
  );
}
