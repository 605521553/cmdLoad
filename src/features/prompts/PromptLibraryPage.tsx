import {
  ArrowUpDown,
  ChevronDown,
  Copy,
  FileText,
  FilterX,
  GripVertical,
  LoaderCircle,
  Plus,
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
import type { PopoverAnchor } from "@/features/appearance/ColorPickerPopover";
import {
  buildCategoryPathMap,
  findCategoryNode,
  promptCategoriesAsCategoryNodes,
} from "@/features/command-manager/categoryUtils";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { MoveToCategoryDialog } from "@/features/command-manager/MoveToCategoryDialog";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  Prompt,
  PromptCategoryNode,
  PromptFilter,
  PromptInput,
  PromptSort,
  Tag,
} from "@/types/app";
import { UNCLASSIFIED_CATEGORY_ID } from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage } from "@/utils/errors";
import { PromptColorPopover } from "./PromptColorPopover";
import {
  PromptContextMenu,
  type PromptMenuPosition,
} from "./PromptContextMenu";
import { PromptDetailPanel } from "./PromptDetailPanel";
import { PromptEditor } from "./PromptEditor";
import { PromptListItem } from "./PromptListItem";
import { promptDisplayTitle } from "./promptAppearance";
import { usePromptActions } from "./usePromptActions";

const FILTERS: { value: PromptFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "recent", label: "最近使用" },
  { value: "favorites", label: "收藏" },
];

type PromptSortMode = "custom" | "recent" | "name" | "mostUsed";

const SORT_OPTIONS: { value: PromptSortMode; label: string }[] = [
  { value: "custom", label: "自定义排序" },
  { value: "recent", label: "最近使用" },
  { value: "name", label: "名称排序" },
  { value: "mostUsed", label: "使用次数" },
];

const PROMPT_SORT_KEY = "pata-commands.prompt-sort";
const PROMPT_DETAIL_WIDTH_KEY = "pata-commands.prompt-detail-width";
const DEFAULT_DETAIL_WIDTH = 330;
const MIN_DETAIL_WIDTH = 260;
const MAX_DETAIL_WIDTH = 460;

function loadSortMode(): PromptSortMode {
  try {
    const value = localStorage.getItem(PROMPT_SORT_KEY);
    return value === "recent" || value === "name" || value === "mostUsed"
      ? value
      : "custom";
  } catch {
    return "custom";
  }
}

function loadDetailWidth(): number {
  try {
    const value = Number(localStorage.getItem(PROMPT_DETAIL_WIDTH_KEY));
    if (Number.isFinite(value)) {
      return Math.min(MAX_DETAIL_WIDTH, Math.max(MIN_DETAIL_WIDTH, value));
    }
  } catch {
    // Best effort persistence.
  }
  return DEFAULT_DETAIL_WIDTH;
}

function querySort(mode: PromptSortMode): PromptSort {
  if (mode === "recent") {
    return "recent";
  }
  if (mode === "name") {
    return "title";
  }
  if (mode === "mostUsed") {
    return "mostUsed";
  }
  return "manual";
}

export function PromptLibraryPage() {
  const promptRevision = useAppStore((state) => state.promptRevision);
  const promptCategoryFilterId = useAppStore(
    (state) => state.promptCategoryFilterId,
  );
  const promptDetailRequest = useAppStore((state) => state.promptDetailRequest);
  const clearPromptDetailRequest = useAppStore(
    (state) => state.clearPromptDetailRequest,
  );
  const promptDrag = useAppStore((state) => state.promptDrag);
  const startPromptDrag = useAppStore((state) => state.startPromptDrag);
  const endPromptDrag = useAppStore((state) => state.endPromptDrag);
  const setTagFilter = useAppStore((state) => state.setTagFilter);
  const tagFilterId = useAppStore((state) => state.tagFilterId);
  const showNotice = useAppStore((state) => state.showNotice);
  const { copyPrompts, toggleFavorite, moveToCategory, deletePrompt } =
    usePromptActions();

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 150);
  const [filter, setFilter] = useState<PromptFilter>("all");
  const [sortMode, setSortMode] = useState<PromptSortMode>(loadSortMode);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [categories, setCategories] = useState<PromptCategoryNode[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [detailPromptId, setDetailPromptId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyingIds, setCopyingIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const [promptMenu, setPromptMenu] = useState<{
    prompt: Prompt;
    position: PromptMenuPosition;
  } | null>(null);
  const [colorTarget, setColorTarget] = useState<{
    ids: string[];
    anchor: PopoverAnchor;
  } | null>(null);
  const [moveDialogIds, setMoveDialogIds] = useState<string[] | null>(null);
  const [detailWidth, setDetailWidth] = useState(loadDetailWidth);
  const [detailResizing, setDetailResizing] = useState(false);
  const detailResizeStart = useRef({ x: 0, width: 0 });
  const requestSeq = useRef(0);

  const refresh = useCallback(() => {
    setLocalRefresh((value) => value + 1);
  }, []);

  const isUnclassifiedFilter =
    promptCategoryFilterId === UNCLASSIFIED_CATEGORY_ID;
  const hasQuery = debouncedQuery.trim().length > 0;

  useEffect(() => {
    try {
      localStorage.setItem(PROMPT_SORT_KEY, sortMode);
    } catch {
      // Best effort.
    }
  }, [sortMode]);

  useEffect(() => {
    try {
      localStorage.setItem(PROMPT_DETAIL_WIDTH_KEY, String(detailWidth));
    } catch {
      // Best effort.
    }
  }, [detailWidth]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++requestSeq.current;
    setLoading(true);
    setError(null);
    appApi
      .listPrompts({
        search: debouncedQuery,
        filter,
        categoryId: isUnclassifiedFilter ? undefined : promptCategoryFilterId,
        unclassifiedOnly: isUnclassifiedFilter,
        tagId: tagFilterId,
        sort: querySort(sortMode),
        limit: 500,
      })
      .then((result) => {
        if (cancelled || sequence !== requestSeq.current) {
          return;
        }
        setPrompts(result);
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
    promptCategoryFilterId,
    isUnclassifiedFilter,
    tagFilterId,
    sortMode,
    promptRevision,
    localRefresh,
  ]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([appApi.listPromptCategories(), appApi.listPromptTags()])
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
  }, [promptRevision, localRefresh, showNotice]);

  useEffect(() => {
    if (!promptDetailRequest) {
      return;
    }
    let cancelled = false;
    appApi
      .getPrompt(promptDetailRequest.id)
      .then((prompt) => {
        if (cancelled) {
          return;
        }
        setQuery("");
        setFilter("all");
        setTagFilter(null);
        setDetailPromptId(prompt.id);
        if (promptDetailRequest.openEditor) {
          setEditingPrompt(prompt);
          setEditorOpen(true);
        }
        clearPromptDetailRequest();
      })
      .catch((detailError) => {
        if (!cancelled) {
          showNotice({
            kind: "error",
            message: getUserErrorMessage(detailError),
          });
          clearPromptDetailRequest();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [promptDetailRequest, clearPromptDetailRequest, setTagFilter, showNotice]);

  useEffect(() => {
    setActiveIndex(0);
    setDropTarget(null);
  }, [
    debouncedQuery,
    filter,
    promptCategoryFilterId,
    tagFilterId,
    sortMode,
  ]);

  useEffect(() => {
    const visible = new Set(prompts.map((prompt) => prompt.id));
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
  }, [prompts]);

  const categoryNodes = useMemo(
    () => promptCategoriesAsCategoryNodes(categories),
    [categories],
  );
  const categoryPathMap = useMemo(
    () => buildCategoryPathMap(categoryNodes),
    [categoryNodes],
  );
  const detailPrompt = useMemo(
    () =>
      prompts.find((prompt) => prompt.id === detailPromptId) ??
      prompts[activeIndex] ??
      null,
    [prompts, detailPromptId, activeIndex],
  );
  const detailCategoryPath = detailPrompt?.categoryId
    ? categoryPathMap.get(detailPrompt.categoryId) ??
      detailPrompt.categoryName
    : null;

  useEffect(() => {
    const prompt = prompts[activeIndex];
    if (prompt) {
      setDetailPromptId(prompt.id);
    }
  }, [activeIndex, prompts]);

  const canReorder =
    sortMode === "custom" && filter === "all" && !hasQuery && !tagFilterId;
  const canDrag = prompts.length > 0;
  const promptMenuScope = prompts;
  const promptMenuIndex = promptMenu
    ? promptMenuScope.findIndex((item) => item.id === promptMenu.prompt.id)
    : -1;
  const canMoveUp = canReorder && promptMenuIndex > 0;
  const canMoveDown =
    canReorder &&
    promptMenuIndex >= 0 &&
    promptMenuIndex < promptMenuScope.length - 1;
  const selectedPrompts = selectedIds
    .map((id) => prompts.find((prompt) => prompt.id === id))
    .filter((prompt): prompt is Prompt => Boolean(prompt));
  const promptMenuSelectionCount = promptMenu
    ? selectedIds.includes(promptMenu.prompt.id) && selectedIds.length > 1
      ? selectedIds.length
      : 1
    : 1;
  const colorTargetPrompts = (colorTarget?.ids ?? [])
    .map((id) => prompts.find((prompt) => prompt.id === id))
    .filter((prompt): prompt is Prompt => Boolean(prompt));
  const categoryFilterName = isUnclassifiedFilter
    ? "默认"
    : findCategoryNode(categoryNodes, promptCategoryFilterId)?.name ?? null;
  const tagFilterName = tags.find((tag) => tag.id === tagFilterId)?.name ?? null;
  const hasFilters =
    hasQuery || filter !== "all" || !!promptCategoryFilterId || !!tagFilterId;
  const selectionOrder = (id: string) => selectedIds.indexOf(id) + 1;

  const recordCopy = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      setCopyingIds(ids);
      try {
        const outcome = await copyPrompts(ids);
        if (outcome) {
          setSelectedIds([]);
          setLastSelectedId(null);
          refresh();
        }
      } finally {
        setCopyingIds([]);
      }
    },
    [copyPrompts, refresh],
  );

  const toggleSelected = (prompt: Prompt) => {
    if (selectedIds.includes(prompt.id)) {
      setSelectedIds((current) => current.filter((id) => id !== prompt.id));
      if (lastSelectedId === prompt.id) {
        setLastSelectedId(selectedIds.find((id) => id !== prompt.id) ?? null);
      }
      return;
    }
    setSelectedIds((current) => [...current, prompt.id]);
    setLastSelectedId(prompt.id);
  };

  const selectRange = (prompt: Prompt) => {
    const targetIndex = prompts.findIndex((item) => item.id === prompt.id);
    const anchorIndex = lastSelectedId
      ? prompts.findIndex((item) => item.id === lastSelectedId)
      : -1;
    if (targetIndex < 0) {
      return;
    }
    if (anchorIndex < 0) {
      if (!selectedIds.includes(prompt.id)) {
        setSelectedIds((current) => [...current, prompt.id]);
      }
      setLastSelectedId(prompt.id);
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const range = prompts.slice(start, end + 1).map((item) => item.id);
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

  const handleSelect = (prompt: Prompt, event: MouseEvent<HTMLButtonElement>) => {
    setDetailPromptId(prompt.id);
    const index = prompts.findIndex((item) => item.id === prompt.id);
    if (index >= 0) {
      setActiveIndex(index);
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      toggleSelected(prompt);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      selectRange(prompt);
    }
  };

  const copySelectionOrder = () => {
    if (selectedIds.length > 0) {
      void recordCopy(selectedIds);
    }
  };

  const copyListOrder = () => {
    const ordered = prompts
      .map((prompt) => prompt.id)
      .filter((id) => selectedIds.includes(id));
    if (ordered.length > 0) {
      void recordCopy(ordered);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        editorOpen ||
        deleteTarget ||
        promptMenu ||
        colorTarget ||
        moveDialogIds ||
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
        if (prompts.length === 0) {
          return;
        }
        event.preventDefault();
        setActiveIndex((current) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return Math.min(
            prompts.length - 1,
            Math.max(0, current + delta),
          );
        });
        return;
      }
      if (event.key === "Enter") {
        if (tag === "button" || tag === "a") {
          return;
        }
        const prompt = prompts[activeIndex];
        if (prompt) {
          event.preventDefault();
          void recordCopy([prompt.id]);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeIndex,
    colorTarget,
    deleteTarget,
    editorOpen,
    moveDialogIds,
    promptMenu,
    prompts,
    recordCopy,
  ]);

  useEffect(() => {
    const prompt = prompts[activeIndex];
    if (!prompt) {
      return;
    }
    const element = document.querySelector(
      `[data-prompt-id="${prompt.id}"]`,
    ) as HTMLElement | null;
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, prompts]);

  const openCreate = () => {
    setEditingPrompt(null);
    setEditorOpen(true);
  };

  const savePrompt = async (input: PromptInput) => {
    if (editingPrompt) {
      await appApi.updatePrompt(editingPrompt.id, input);
      showNotice({ kind: "success", message: "提示词已更新" });
    } else {
      await appApi.createPrompt(input);
      showNotice({ kind: "success", message: "提示词已保存到本地数据库" });
    }
    setEditorOpen(false);
    setEditingPrompt(null);
    refresh();
  };

  const favorite = async (prompt: Prompt) => {
    await toggleFavorite(prompt);
    refresh();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      const removed = await deletePrompt(deleteTarget);
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

  const openPromptMenu = (prompt: Prompt, position: PromptMenuPosition) => {
    setDetailPromptId(prompt.id);
    const index = prompts.findIndex((item) => item.id === prompt.id);
    if (index >= 0) {
      setActiveIndex(index);
    }
    setPromptMenu({ prompt, position });
  };

  const openPromptColor = (prompt: Prompt) => {
    const ids =
      selectedIds.includes(prompt.id) && selectedIds.length > 1
        ? selectedIds.filter((id) => prompts.some((item) => item.id === id))
        : [prompt.id];
    setColorTarget({
      ids,
      anchor: promptMenu?.position ?? { x: 220, y: 200 },
    });
  };

  const applyPromptColor = async (color: string | null) => {
    const target = colorTarget;
    if (!target) {
      return;
    }
    await appApi.setPromptsColor(target.ids, color);
    setColorTarget(null);
    refresh();
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

  const movePromptByOffset = async (prompt: Prompt, direction: -1 | 1) => {
    if (!canReorder) {
      return;
    }
    const index = prompts.findIndex((item) => item.id === prompt.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= prompts.length) {
      return;
    }
    const next = [...prompts];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const previous = prompts;
    setPrompts(next);
    try {
      await appApi.reorderPrompts(next.map((item) => item.id));
      showNotice({
        kind: "success",
        message: direction < 0 ? "提示词已上移" : "提示词已下移",
      });
    } catch (moveError) {
      setPrompts(previous);
      showNotice({
        kind: "error",
        message: getUserErrorMessage(moveError),
      });
    }
  };

  const beginPromptDrag = (
    event: DragEvent<HTMLButtonElement>,
    prompt: Prompt,
  ) => {
    const dragIds =
      selectedIds.includes(prompt.id) && selectedIds.length > 1
        ? selectedIds
        : [prompt.id];
    startPromptDrag(dragIds);
    setDraggingId(prompt.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-pata-prompts",
      JSON.stringify(dragIds),
    );
    event.dataTransfer.setData("text/plain", promptDisplayTitle(prompt));

    const preview = document.createElement("div");
    preview.className =
      "fixed left-[-9999px] top-0 max-w-[240px] truncate rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink shadow-window";
    preview.textContent =
      dragIds.length > 1
        ? `${promptDisplayTitle(prompt)} 等 ${dragIds.length} 条`
        : promptDisplayTitle(prompt);
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 14, 14);
    window.setTimeout(() => preview.remove(), 0);
  };

  const endDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
    endPromptDrag();
  };

  const handleRowDragOver = (
    event: DragEvent<HTMLDivElement>,
    target: Prompt,
  ) => {
    if (
      !canReorder ||
      !promptDrag ||
      promptDrag.ids.includes(target.id)
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
    target: Prompt,
  ) => {
    event.preventDefault();
    if (!canReorder || !promptDrag) {
      return;
    }
    const position =
      dropTarget?.id === target.id ? dropTarget.position : "after";
    const dragged = promptDrag.ids;
    setDropTarget(null);
    endDrag();
    const remaining = prompts.filter(
      (prompt) => !dragged.includes(prompt.id),
    );
    const targetIndex = remaining.findIndex(
      (prompt) => prompt.id === target.id,
    );
    if (targetIndex < 0) {
      return;
    }
    const draggedPrompts = prompts.filter((prompt) =>
      dragged.includes(prompt.id),
    );
    const next = [...remaining];
    next.splice(
      targetIndex + (position === "after" ? 1 : 0),
      0,
      ...draggedPrompts,
    );
    const previous = prompts;
    setPrompts(next);
    try {
      await appApi.reorderPrompts(next.map((prompt) => prompt.id));
      showNotice({ kind: "success", message: "提示词顺序已保存" });
    } catch (reorderError) {
      setPrompts(previous);
      showNotice({
        kind: "error",
        message: getUserErrorMessage(reorderError),
      });
    }
  };

  const clearFilters = () => {
    setQuery("");
    setFilter("all");
    useAppStore.getState().setPromptCategoryFilter(null);
    setTagFilter(null);
  };

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

  const finishDetailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!detailResizing) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDetailResizing(false);
  };

  return (
    <section
      aria-labelledby="prompt-library-heading"
      className="flex h-full min-h-0 overflow-hidden"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h1 id="prompt-library-heading" className="sr-only">
          提示词库
        </h1>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              placeholder="搜索提示词正文、标题或标签"
              aria-label="搜索提示词"
              className="h-8"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            aria-label="添加提示词"
            className="shrink-0"
          >
            <Plus />
            添加提示词
          </Button>
        </div>

        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
          <div
            className="flex items-center rounded-[8px] border border-line/80 bg-muted/55 p-0.5"
            aria-label="提示词筛选"
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
            {loading ? "加载中…" : `${prompts.length} 条`}
          </span>
          <label className="relative ml-auto flex items-center gap-1">
            <ArrowUpDown className="size-2.5" />
            <span className="sr-only">排序方式</span>
            <select
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.target.value as PromptSortMode)
              }
              aria-label="提示词排序方式"
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
              onClick={() => useAppStore.getState().setPromptCategoryFilter(null)}
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
              onClick={() => setMoveDialogIds(selectedIds)}
              disabled={copyingIds.length > 0}
            >
              移动到目录
            </Button>
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
          ) : loading && prompts.length === 0 ? (
            <div className="flex min-h-[120px] items-center justify-center gap-2 text-[12px] text-ink-faint">
              <LoaderCircle className="size-3.5 animate-spin" />
              正在读取提示词库…
            </div>
          ) : prompts.length === 0 ? (
            <EmptyState
              compact
              icon={<FileText className="size-4" />}
              title={
                hasQuery
                  ? "未找到提示词"
                  : filter === "favorites"
                    ? "暂无收藏提示词"
                    : filter === "recent"
                      ? "还没有使用记录"
                      : categoryFilterName
                        ? "此目录暂无提示词"
                        : "提示词库还是空的"
              }
              description={
                hasQuery
                  ? "尝试其他关键词，或清除筛选条件。"
                  : filter === "favorites"
                    ? "在提示词卡片上点击星标即可收藏。"
                    : filter === "recent"
                      ? "复制提示词后会自动记录最近使用。"
                      : categoryFilterName
                        ? "可以把提示词移动到这个目录。"
                        : "保存一段常用提示词，之后可在快捷面板中搜索和复制。"
              }
              action={
                hasFilters && !hasQuery ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    清除筛选
                  </Button>
                ) : !hasQuery ? (
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    <Plus />
                    添加提示词
                  </Button>
                ) : null
              }
            />
          ) : (
            <div role="listbox" aria-label="提示词列表">
              {prompts.map((prompt, index) => (
                <PromptListItem
                  key={prompt.id}
                  prompt={prompt}
                  categoryPath={
                    prompt.categoryId
                      ? categoryPathMap.get(prompt.categoryId)
                      : undefined
                  }
                  active={index === activeIndex}
                  selected={selectedIds.includes(prompt.id)}
                  selectionOrder={selectionOrder(prompt.id)}
                  dragging={draggingId === prompt.id}
                  canDrag={canDrag}
                  dropPosition={
                    dropTarget?.id === prompt.id ? dropTarget.position : null
                  }
                  onActivate={() => setActiveIndex(index)}
                  onSelect={(event) => handleSelect(prompt, event)}
                  onCopy={() => void recordCopy([prompt.id])}
                  onToggleFavorite={() => void favorite(prompt)}
                  onToggleSelected={() => toggleSelected(prompt)}
                  onEdit={() => {
                    setEditingPrompt(prompt);
                    setEditorOpen(true);
                  }}
                  onDelete={() => setDeleteTarget(prompt)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openPromptMenu(prompt, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onContextMenuKeyboard={(target) => {
                    const rect = target.getBoundingClientRect();
                    openPromptMenu(prompt, {
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
                  onDragStart={(event) => beginPromptDrag(event, prompt)}
                  onDragOver={(event) => handleRowDragOver(event, prompt)}
                  onDrop={(event) => void handleRowDrop(event, prompt)}
                  onDragEnd={endDrag}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整提示词预览宽度"
        aria-valuemin={MIN_DETAIL_WIDTH}
        aria-valuemax={MAX_DETAIL_WIDTH}
        aria-valuenow={detailWidth}
        title="拖动调整预览宽度"
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

      <PromptDetailPanel
        prompt={detailPrompt}
        categoryPath={detailCategoryPath}
        width={detailWidth}
        onCopy={(prompt) => void recordCopy([prompt.id])}
        onEdit={(prompt) => {
          setEditingPrompt(prompt);
          setEditorOpen(true);
        }}
        onToggleFavorite={(prompt) => void favorite(prompt)}
        onDelete={(prompt) => setDeleteTarget(prompt)}
        onTagClick={(tagId) => setTagFilter(tagId)}
      />

      <PromptEditor
        open={editorOpen}
        prompt={editingPrompt}
        categories={categoryNodes}
        defaultCategoryId={
          promptCategoryFilterId === UNCLASSIFIED_CATEGORY_ID
            ? null
            : promptCategoryFilterId
        }
        onClose={() => {
          setEditorOpen(false);
          setEditingPrompt(null);
        }}
        onSave={savePrompt}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除提示词"
        description={
          deleteTarget ? (
            <>
              确认删除「{promptDisplayTitle(deleteTarget)}」？删除后该提示词会从提示词库和快捷面板隐藏，数据库保留原始记录。
            </>
          ) : null
        }
        confirmLabel="删除提示词"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
      />

      <PromptContextMenu
        context="manager"
        prompt={promptMenu?.prompt ?? null}
        position={promptMenu?.position ?? { x: 0, y: 0 }}
        categories={categoryNodes}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        selectionCount={promptMenuSelectionCount}
        onClose={() => setPromptMenu(null)}
        onCopy={(prompt) => void recordCopy([prompt.id])}
        onEdit={(prompt) => {
          setEditingPrompt(prompt);
          setEditorOpen(true);
        }}
        onToggleFavorite={(prompt) => void favorite(prompt)}
        onSetColor={openPromptColor}
        onMoveUp={(prompt) => void movePromptByOffset(prompt, -1)}
        onMoveDown={(prompt) => void movePromptByOffset(prompt, 1)}
        onMove={(prompt, categoryId, label) =>
          performMove([prompt.id], categoryId, label)
        }
        onView={(prompt) => setDetailPromptId(prompt.id)}
        onDelete={(prompt) => setDeleteTarget(prompt)}
      />

      <MoveToCategoryDialog
        open={moveDialogIds !== null}
        count={moveDialogIds?.length ?? 0}
        categories={categoryNodes}
        itemLabel="提示词"
        onClose={() => setMoveDialogIds(null)}
        onMove={(categoryId, label) =>
          performMove(moveDialogIds ?? [], categoryId, label)
        }
      />

      <PromptColorPopover
        open={colorTarget !== null}
        anchor={colorTarget?.anchor ?? { x: 0, y: 0 }}
        prompts={colorTargetPrompts}
        onClose={() => setColorTarget(null)}
        onApplyColor={applyPromptColor}
      />

      {selectedPrompts.length > 0 ? (
        <span className="sr-only" aria-live="polite">
          已选择 {selectedPrompts.length} 条提示词
        </span>
      ) : null}
    </section>
  );
}
