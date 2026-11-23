import {
  Clipboard,
  Command as CommandIcon,
  GripHorizontal,
  LoaderCircle,
  MessageSquareText,
  PanelTopOpen,
  Settings2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { RuntimeWarnings } from "@/components/common/RuntimeWarnings";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import {
  CommandContextMenu,
  type MenuPosition,
} from "@/features/command-actions/CommandContextMenu";
import {
  ColorPickerPopover,
  type PopoverAnchor,
} from "@/features/appearance/ColorPickerPopover";
import {
  buildCategoryPathMap,
  findCategoryName,
  promptCategoriesAsCategoryNodes,
} from "@/features/command-manager/categoryUtils";
import { useCommandActions } from "@/features/command-actions/useCommandActions";
import { AiQuickConfirmDialog } from "@/features/ai/AiQuickConfirmDialog";
import { useCommandAiAction } from "@/features/ai/useCommandAiAction";
import { SensitiveClipboardDialog } from "@/features/clipboard/SensitiveClipboardDialog";
import { commandLabel } from "@/features/command-display/commandDisplay";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { PromptColorPopover } from "@/features/prompts/PromptColorPopover";
import { PromptContextMenu } from "@/features/prompts/PromptContextMenu";
import { promptDisplayTitle } from "@/features/prompts/promptAppearance";
import { usePromptActions } from "@/features/prompts/usePromptActions";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  CategoryNode,
  ClipboardItem,
  ClipboardState,
  Command,
  CommandFilter,
  Prompt,
  PromptCategoryNode,
  PromptFilter,
  SystemClipboardHistory,
} from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage, toAppCommandError } from "@/utils/errors";
import { ClipboardQuickItem } from "./ClipboardQuickItem";
import { QuickCommandItem } from "./QuickCommandItem";
import { QuickPromptItem } from "./QuickPromptItem";

type QuickContentType = "clipboard" | "library" | "prompts";

const CONTENT_TYPES: { value: QuickContentType; label: string }[] = [
  { value: "clipboard", label: "剪贴板" },
  { value: "library", label: "命令库" },
  { value: "prompts", label: "提示词库" },
];

const CONTENT_FILTERS: {
  value: "all" | "recent" | "favorites";
  label: string;
}[] = [
  { value: "all", label: "全部" },
  { value: "recent", label: "最近使用" },
  { value: "favorites", label: "收藏" },
];

function contentTypeIcon(type: QuickContentType) {
  if (type === "clipboard") {
    return <Clipboard className="size-3" />;
  }
  if (type === "prompts") {
    return <MessageSquareText className="size-3" />;
  }
  return <CommandIcon className="size-3" />;
}

export function QuickPanel() {
  const snapshot = useAppStore((state) => state.snapshot);
  const focusSearchRequest = useAppStore((state) => state.focusSearchRequest);
  const dataRevision = useAppStore((state) => state.dataRevision);
  const promptRevision = useAppStore((state) => state.promptRevision);
  const clipboardRevision = useAppStore((state) => state.clipboardRevision);
  const hideWindow = useAppStore((state) => state.hideWindow);
  const setUiMode = useAppStore((state) => state.setUiMode);
  const setManagerView = useAppStore((state) => state.setManagerView);
  const requestCommandDetail = useAppStore(
    (state) => state.requestCommandDetail,
  );
  const requestPromptDetail = useAppStore((state) => state.requestPromptDetail);
  const showNotice = useAppStore((state) => state.showNotice);
  const startWindowDrag = useWindowDrag();
  const { toggleFavorite, moveToCategory, deleteCommand } =
    useCommandActions();
  const {
    copyPrompts,
    toggleFavorite: togglePromptFavorite,
    moveToCategory: movePromptToCategory,
    deletePrompt,
  } = usePromptActions();
  const ai = useCommandAiAction();

  const [contentType, setContentType] =
    useState<QuickContentType>("clipboard");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 130);
  const [commandFilter, setCommandFilter] = useState<CommandFilter>("all");
  const [promptFilter, setPromptFilter] = useState<PromptFilter>("all");
  const [clipboardState, setClipboardState] = useState<ClipboardState | null>(
    null,
  );
  const [systemHistory, setSystemHistory] =
    useState<SystemClipboardHistory | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [clipboardLoading, setClipboardLoading] = useState(true);
  const [systemLoading, setSystemLoading] = useState(true);
  const [commandLoading, setCommandLoading] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingPromptKey, setSavingPromptKey] = useState<string | null>(null);
  const [copyingKey, setCopyingKey] = useState<string | null>(null);
  const [copyingCommandId, setCopyingCommandId] = useState<string | null>(null);
  const [copyingPromptId, setCopyingPromptId] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [expandedPromptKeys, setExpandedPromptKeys] = useState<Set<string>>(
    new Set(),
  );
  const [sensitiveItem, setSensitiveItem] = useState<ClipboardItem | null>(
    null,
  );
  const [sensitiveMode, setSensitiveMode] = useState<"command" | "prompt">(
    "command",
  );
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [promptCategories, setPromptCategories] = useState<CategoryNode[]>([]);
  const [commandMenu, setCommandMenu] = useState<{
    command: Command;
    position: MenuPosition;
  } | null>(null);
  const [promptMenu, setPromptMenu] = useState<{
    prompt: Prompt;
    position: MenuPosition;
  } | null>(null);
  const [colorTarget, setColorTarget] = useState<{
    id: string;
    anchor: PopoverAnchor;
  } | null>(null);
  const [promptColorTarget, setPromptColorTarget] = useState<{
    id: string;
    anchor: PopoverAnchor;
  } | null>(null);
  const [quickDeleteTarget, setQuickDeleteTarget] = useState<Command | null>(
    null,
  );
  const [promptDeleteTarget, setPromptDeleteTarget] = useState<Prompt | null>(
    null,
  );
  const [quickDeleting, setQuickDeleting] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  const commandSeq = useRef(0);
  const promptSeq = useRef(0);
  const systemSeq = useRef(0);

  useEffect(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusSearchRequest]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++requestSeq.current;
    setClipboardLoading(true);
    setClipboardError(null);
    appApi
      .getClipboardState()
      .then((result) => {
        if (!cancelled && sequence === requestSeq.current) {
          setClipboardState(result);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setClipboardError(getUserErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setClipboardLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clipboardRevision, dataRevision, focusSearchRequest, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++systemSeq.current;
    setSystemLoading(true);
    appApi
      .getSystemClipboardHistory()
      .then((result) => {
        if (!cancelled && sequence === systemSeq.current) {
          setSystemHistory(result);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setSystemHistory({
            status: "error",
            enabled: false,
            items: [],
            message: getUserErrorMessage(loadError),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSystemLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clipboardRevision, dataRevision, focusSearchRequest, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    appApi
      .listCategories()
      .then((result) => {
        if (!cancelled) {
          setCategories(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataRevision]);

  useEffect(() => {
    let cancelled = false;
    appApi
      .listPromptCategories()
      .then((result: PromptCategoryNode[]) => {
        if (!cancelled) {
          setPromptCategories(promptCategoriesAsCategoryNodes(result));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPromptCategories([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [promptRevision, refreshTick]);

  useEffect(() => {
    if (contentType !== "library") {
      return;
    }
    let cancelled = false;
    const sequence = ++commandSeq.current;
    setCommandLoading(true);
    setCommandError(null);
    appApi
      .listCommands({
        search: debouncedQuery,
        filter: commandFilter,
        sort: "updated",
        limit: 100,
      })
      .then((result) => {
        if (!cancelled && sequence === commandSeq.current) {
          setCommands(result);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setCommandError(getUserErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCommandLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contentType, debouncedQuery, commandFilter, dataRevision, refreshTick]);

  useEffect(() => {
    if (contentType !== "prompts") {
      return;
    }
    let cancelled = false;
    const sequence = ++promptSeq.current;
    setPromptLoading(true);
    setPromptError(null);
    appApi
      .listPrompts({
        search: debouncedQuery,
        filter: promptFilter,
        sort: "updated",
        limit: 100,
      })
      .then((result) => {
        if (!cancelled && sequence === promptSeq.current) {
          setPrompts(result);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setPromptError(getUserErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPromptLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contentType, debouncedQuery, promptFilter, promptRevision, refreshTick]);

  const allClipboardItems = useMemo(() => {
    const seen = new Set<string>();
    const items: ClipboardItem[] = [];
    const push = (item: ClipboardItem) => {
      if (seen.has(item.content)) {
        return;
      }
      seen.add(item.content);
      items.push(item);
    };
    if (clipboardState?.current) {
      push(clipboardState.current);
    }
    for (const item of systemHistory?.items ?? []) {
      push(item);
    }
    for (const item of clipboardState?.localItems ?? []) {
      push(item);
    }
    return items;
  }, [clipboardState, systemHistory]);

  const normalizedQuery = debouncedQuery.trim().toLocaleLowerCase();
  const filteredClipboardItems = useMemo(() => {
    if (!normalizedQuery) {
      return allClipboardItems;
    }
    return allClipboardItems.filter((item) =>
      item.content.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [allClipboardItems, normalizedQuery]);

  const activeItem =
    contentType === "clipboard"
      ? filteredClipboardItems[activeIndex]
      : undefined;
  const categoryPathMap = useMemo(
    () => buildCategoryPathMap(categories),
    [categories],
  );
  const promptCategoryPathMap = useMemo(
    () => buildCategoryPathMap(promptCategories),
    [promptCategories],
  );
  const activeCommand =
    contentType === "library" ? commands[activeIndex] : undefined;
  const activePrompt =
    contentType === "prompts" ? prompts[activeIndex] : undefined;
  const colorCommand = colorTarget
    ? commands.find((command) => command.id === colorTarget.id) ?? null
    : null;
  const colorPrompt = promptColorTarget
    ? prompts.find((prompt) => prompt.id === promptColorTarget.id) ?? null
    : null;
  const listLength =
    contentType === "clipboard"
      ? filteredClipboardItems.length
      : contentType === "library"
        ? commands.length
        : prompts.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [contentType, debouncedQuery, commandFilter, promptFilter]);

  useEffect(() => {
    setActiveIndex((current) =>
      listLength === 0 ? 0 : Math.min(current, listLength - 1),
    );
  }, [listLength]);

  useEffect(() => {
    const key =
      contentType === "clipboard"
        ? activeItem?.key
        : contentType === "library"
          ? activeCommand?.id
          : activePrompt?.id;
    if (!key) {
      return;
    }
    const selector =
      contentType === "clipboard"
        ? `[data-quick-clipboard-key="${key}"]`
        : contentType === "library"
          ? `[data-quick-command-id="${key}"]`
          : `[data-quick-prompt-id="${key}"]`;
    const element = document.querySelector(selector) as HTMLElement | null;
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, activeCommand, activeItem, activePrompt, contentType]);

  const openSavedCommand = useCallback(
    (id: string) => {
      requestCommandDetail(id);
      void setUiMode("manager");
    },
    [requestCommandDetail, setUiMode],
  );

  const openPromptInManager = useCallback(
    (id: string, openEditor = false) => {
      requestPromptDetail(id, openEditor);
      void setUiMode("manager");
    },
    [requestPromptDetail, setUiMode],
  );

  const openCommandMenu = useCallback(
    (command: Command, position: MenuPosition) => {
      setCommandMenu({ command, position });
    },
    [],
  );

  const openPromptMenu = useCallback(
    (prompt: Prompt, position: MenuPosition) => {
      setPromptMenu({ prompt, position });
    },
    [],
  );

  const openActiveMenu = useCallback(() => {
    if (contentType === "library" && activeCommand) {
      const element = document.querySelector(
        `[data-quick-command-id="${activeCommand.id}"]`,
      );
      const rect = element?.getBoundingClientRect() ?? null;
      openCommandMenu(activeCommand, {
        x: rect ? rect.right - 16 : window.innerWidth / 2,
        y: rect ? rect.bottom - 4 : 80,
      });
      return;
    }
    if (contentType === "prompts" && activePrompt) {
      const element = document.querySelector(
        `[data-quick-prompt-id="${activePrompt.id}"]`,
      );
      const rect = element?.getBoundingClientRect() ?? null;
      openPromptMenu(activePrompt, {
        x: rect ? rect.right - 16 : window.innerWidth / 2,
        y: rect ? rect.bottom - 4 : 80,
      });
    }
  }, [activeCommand, activePrompt, contentType, openCommandMenu, openPromptMenu]);

  const favoriteCommand = useCallback(
    async (command: Command) => {
      await toggleFavorite(command);
      setRefreshTick((value) => value + 1);
    },
    [toggleFavorite],
  );

  const favoritePrompt = useCallback(
    async (prompt: Prompt) => {
      await togglePromptFavorite(prompt);
      setRefreshTick((value) => value + 1);
    },
    [togglePromptFavorite],
  );

  const openCommandColor = useCallback(
    (command: Command) => {
      setColorTarget({
        id: command.id,
        anchor: commandMenu?.position ?? { x: 96, y: 120 },
      });
    },
    [commandMenu],
  );

  const applyCommandColor = useCallback(
    async (color: string | null) => {
      const target = colorTarget;
      if (!target) {
        return;
      }
      await appApi.setCommandsColor([target.id], color);
      setColorTarget(null);
      setRefreshTick((value) => value + 1);
    },
    [colorTarget],
  );

  const applyCommandFollow = useCallback(
    async (enabled: boolean) => {
      const target = colorTarget;
      if (!target) {
        return;
      }
      await appApi.setCommandsFollowCategoryColor([target.id], enabled);
      setRefreshTick((value) => value + 1);
    },
    [colorTarget],
  );

  const toggleFollowCategoryColor = useCallback(
    async (command: Command) => {
      try {
        await appApi.setCommandsFollowCategoryColor(
          [command.id],
          !command.useCategoryColor,
        );
        setRefreshTick((value) => value + 1);
      } catch (error) {
        showNotice({
          kind: "error",
          message: getUserErrorMessage(error),
        });
      }
    },
    [showNotice],
  );

  const openPromptColor = useCallback(
    (prompt: Prompt) => {
      setPromptColorTarget({
        id: prompt.id,
        anchor: promptMenu?.position ?? { x: 96, y: 120 },
      });
    },
    [promptMenu],
  );

  const applyPromptColor = useCallback(
    async (color: string | null) => {
      const target = promptColorTarget;
      if (!target) {
        return;
      }
      await appApi.setPromptsColor([target.id], color);
      setPromptColorTarget(null);
      setRefreshTick((value) => value + 1);
    },
    [promptColorTarget],
  );

  const moveCommand = useCallback(
    async (
      command: Command,
      categoryId: string | null,
      categoryLabel?: string,
    ) => {
      const label =
        categoryLabel ?? findCategoryName(categories, categoryId);
      await moveToCategory([command.id], categoryId, label);
      setRefreshTick((value) => value + 1);
    },
    [categories, moveToCategory],
  );

  const movePrompt = useCallback(
    async (
      prompt: Prompt,
      categoryId: string | null,
      categoryLabel?: string,
    ) => {
      const label =
        categoryLabel ?? findCategoryName(promptCategories, categoryId);
      await movePromptToCategory([prompt.id], categoryId, label);
      setRefreshTick((value) => value + 1);
    },
    [movePromptToCategory, promptCategories],
  );

  const createCategoryForMenu = useCallback(
    async (parentId: string | null, name: string) => {
      try {
        const id = await appApi.createCategory({ name, parentId });
        setRefreshTick((value) => value + 1);
        return id;
      } catch (error) {
        showNotice({
          kind: "error",
          message: getUserErrorMessage(error),
        });
        return null;
      }
    },
    [showNotice],
  );

  const confirmQuickDelete = useCallback(async () => {
    if (!quickDeleteTarget) {
      return;
    }
    setQuickDeleting(true);
    try {
      const removed = await deleteCommand(quickDeleteTarget);
      if (removed) {
        setQuickDeleteTarget(null);
        setRefreshTick((value) => value + 1);
      }
    } finally {
      setQuickDeleting(false);
    }
  }, [deleteCommand, quickDeleteTarget]);

  const confirmPromptDelete = useCallback(async () => {
    if (!promptDeleteTarget) {
      return;
    }
    setQuickDeleting(true);
    try {
      const removed = await deletePrompt(promptDeleteTarget);
      if (removed) {
        setPromptDeleteTarget(null);
        setRefreshTick((value) => value + 1);
      }
    } finally {
      setQuickDeleting(false);
    }
  }, [deletePrompt, promptDeleteTarget]);

  const saveItem = useCallback(
    async (item: ClipboardItem, allowSensitive = false) => {
      if (item.savedCommandId) {
        openSavedCommand(item.savedCommandId);
        return;
      }
      if (item.isSensitive && !allowSensitive) {
        setSensitiveMode("command");
        setSensitiveItem(item);
        return;
      }
      setSavingKey(item.key);
      try {
        const result = await appApi.saveClipboardText({
          content: item.content,
          source: item.source,
          allowSensitive,
        });
        const patch = (candidate: ClipboardItem): ClipboardItem =>
          candidate.content === item.content
            ? {
                ...candidate,
                savedCommandId: result.command.id,
                savedCommandIsFavorite: result.command.isFavorite,
              }
            : candidate;
        setClipboardState((current) =>
          current
            ? {
                ...current,
                current: current.current ? patch(current.current) : null,
                localItems: current.localItems.map(patch),
              }
            : current,
        );
        setSystemHistory((current) =>
          current
            ? { ...current, items: current.items.map(patch) }
            : current,
        );
        setSensitiveItem(null);
        showNotice({
          kind: "success",
          message: result.created
            ? "已保存到命令库的“默认”目录"
            : "该命令已在命令库中（默认目录）",
        });
        setRefreshTick((value) => value + 1);
      } catch (saveError) {
        const appError = toAppCommandError(saveError);
        if (appError.code === "SENSITIVE_CONTENT" && !allowSensitive) {
          setSensitiveMode("command");
          setSensitiveItem(item);
        } else {
          showNotice({ kind: "error", message: appError.message });
        }
      } finally {
        setSavingKey(null);
      }
    },
    [openSavedCommand, showNotice],
  );

  const saveItemAsPrompt = useCallback(
    async (item: ClipboardItem, allowSensitive = false) => {
      if (item.isSensitive && !allowSensitive) {
        setSensitiveMode("prompt");
        setSensitiveItem(item);
        return;
      }
      setSavingPromptKey(item.key);
      try {
        const result = await appApi.saveClipboardAsPrompt(
          item.content,
          allowSensitive,
        );
        setSensitiveItem(null);
        showNotice({
          kind: "success",
          message: result.created
            ? "已保存到提示词库的“默认”目录"
            : "该提示词已在提示词库中（默认目录）",
        });
        setRefreshTick((value) => value + 1);
      } catch (saveError) {
        const appError = toAppCommandError(saveError);
        if (appError.code === "SENSITIVE_CONTENT" && !allowSensitive) {
          setSensitiveMode("prompt");
          setSensitiveItem(item);
        } else {
          showNotice({ kind: "error", message: appError.message });
        }
      } finally {
        setSavingPromptKey(null);
      }
    },
    [showNotice],
  );

  const copyClipboardItem = useCallback(
    async (item: ClipboardItem) => {
      if (copyingKey) {
        return;
      }
      setCopyingKey(item.key);
      try {
        await appApi.copyClipboardText(item.content);
        showNotice({ kind: "success", message: "已复制剪贴板内容" });
        if (snapshot?.settings.hideQuickPanelAfterCopy) {
          await hideWindow();
        } else {
          setRefreshTick((value) => value + 1);
        }
      } catch (copyError) {
        showNotice({ kind: "error", message: getUserErrorMessage(copyError) });
      } finally {
        setCopyingKey(null);
      }
    },
    [copyingKey, hideWindow, showNotice, snapshot],
  );

  const copyCommand = useCallback(
    async (command: Command) => {
      if (copyingCommandId) {
        return;
      }
      setCopyingCommandId(command.id);
      try {
        const outcome = await appApi.copyCommands([command.id]);
        showNotice({
          kind: outcome.warning ? "info" : "success",
          message: outcome.warning
            ? `已复制「${commandLabel(command)}」。${outcome.warning}`
            : `已复制「${commandLabel(command)}」`,
        });
        if (snapshot?.settings.hideQuickPanelAfterCopy) {
          await hideWindow();
        } else {
          setRefreshTick((value) => value + 1);
        }
      } catch (copyError) {
        showNotice({ kind: "error", message: getUserErrorMessage(copyError) });
      } finally {
        setCopyingCommandId(null);
      }
    },
    [copyingCommandId, hideWindow, showNotice, snapshot],
  );

  const copyPrompt = useCallback(
    async (prompt: Prompt) => {
      if (copyingPromptId) {
        return;
      }
      setCopyingPromptId(prompt.id);
      try {
        const outcome = await copyPrompts([prompt.id]);
        if (outcome?.warning) {
          showNotice({ kind: "info", message: outcome.warning });
        }
        if (snapshot?.settings.hideQuickPanelAfterCopy) {
          await hideWindow();
        } else {
          setRefreshTick((value) => value + 1);
        }
      } finally {
        setCopyingPromptId(null);
      }
    },
    [copyPrompts, copyingPromptId, hideWindow, showNotice, snapshot],
  );

  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const togglePromptExpanded = (id: string) => {
    setExpandedPromptKeys((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        sensitiveItem ||
        commandMenu ||
        promptMenu ||
        colorTarget ||
        promptColorTarget
      ) {
        return;
      }
      if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        if (contentType !== "clipboard") {
          event.preventDefault();
          openActiveMenu();
        }
        return;
      }
      const isSaveShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (isSaveShortcut) {
        event.preventDefault();
        if (contentType === "clipboard" && activeItem && !savingKey) {
          void saveItem(activeItem);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (
          contentType === "prompts" &&
          activePrompt &&
          expandedPromptKeys.has(activePrompt.id)
        ) {
          togglePromptExpanded(activePrompt.id);
          return;
        }
        if (contentType === "clipboard" && activeItem && expandedKeys.has(activeItem.key)) {
          toggleExpanded(activeItem.key);
          return;
        }
        if (query.length > 0) {
          setQuery("");
          searchRef.current?.focus();
          return;
        }
        void hideWindow();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (listLength === 0) {
          return;
        }
        event.preventDefault();
        setActiveIndex((current) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return Math.min(listLength - 1, Math.max(0, current + delta));
        });
        return;
      }
      if (event.key === "Enter") {
        const target = event.target as HTMLElement | null;
        const tag =
          target && typeof target.tagName === "string"
            ? target.tagName.toLowerCase()
            : "";
        if (tag === "button" || tag === "a" || target?.isContentEditable) {
          return;
        }
        if (contentType === "clipboard" && activeItem) {
          event.preventDefault();
          void copyClipboardItem(activeItem);
        } else if (contentType === "library" && activeCommand) {
          event.preventDefault();
          void copyCommand(activeCommand);
        } else if (contentType === "prompts" && activePrompt) {
          event.preventDefault();
          void copyPrompt(activePrompt);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeCommand,
    activeItem,
    activePrompt,
    colorTarget,
    commandMenu,
    contentType,
    copyClipboardItem,
    copyCommand,
    copyPrompt,
    expandedKeys,
    expandedPromptKeys,
    hideWindow,
    listLength,
    openActiveMenu,
    promptColorTarget,
    promptMenu,
    query,
    savingKey,
    saveItem,
    sensitiveItem,
  ]);

  if (!snapshot) {
    return null;
  }

  const openManager = (view: "library" | "prompts" | "settings") => {
    setManagerView(view);
    void setUiMode("manager");
  };

  const hasQuery = debouncedQuery.trim().length > 0;
  const visibleCount = listLength;
  const commandTabLoading = contentType === "library" && commandLoading;
  const promptTabLoading = contentType === "prompts" && promptLoading;
  const currentError = clipboardState?.currentError;
  const statusMessage =
    systemHistory && systemHistory.status !== "available"
      ? systemHistory.message
      : clipboardState?.monitorWarning;
  const localDisabledMessage =
    clipboardState && !clipboardState.localHistoryEnabled
      ? "本地剪贴板监听已关闭，现有本地记录仍会显示。"
      : null;
  const activeFilter =
    contentType === "library" ? commandFilter : promptFilter;
  const setActiveFilter = (
    value: "all" | "recent" | "favorites",
  ) => {
    if (contentType === "library") {
      setCommandFilter(value);
    } else {
      setPromptFilter(value);
    }
  };

  const commandEmptyTitle = hasQuery
    ? "未找到命令"
    : commandFilter === "favorites"
      ? "暂无收藏命令"
      : commandFilter === "recent"
        ? "还没有使用记录"
        : "命令库还是空的";
  const commandEmptyDescription = hasQuery
    ? "尝试其他关键词，或切换到命令库浏览全部命令。"
    : commandFilter === "favorites"
      ? "在命令库中标记收藏后，可在这里快速找到。"
      : commandFilter === "recent"
        ? "复制命令后会自动记录最近使用。"
        : "在剪贴板中保存命令后，会出现在这里。";

  const promptEmptyTitle = hasQuery
    ? "未找到提示词"
    : promptFilter === "favorites"
      ? "暂无收藏提示词"
      : promptFilter === "recent"
        ? "还没有使用记录"
        : "提示词库还是空的";
  const promptEmptyDescription = hasQuery
    ? "尝试其他关键词，或切换到提示词库浏览全部提示词。"
    : promptFilter === "favorites"
      ? "在提示词库中标记收藏后，可在这里快速找到。"
      : promptFilter === "recent"
        ? "复制提示词后会自动记录最近使用。"
        : "把常用提示词保存到提示词库后，可随时在这里搜索和复制。";

  const searchPlaceholder =
    contentType === "clipboard"
      ? "搜索剪贴板内容…"
      : contentType === "library"
        ? "搜索命令、注释或标签…"
        : "搜索提示词正文、标题或标签…";

  const eyebrow =
    contentType === "clipboard"
      ? "剪贴板历史"
      : contentType === "library"
        ? commandFilter === "favorites"
          ? "收藏命令"
          : "全部命令"
        : promptFilter === "favorites"
          ? "收藏提示词"
          : "提示词库";

  return (
    <div className="animate-content-in flex h-full flex-col overflow-hidden bg-canvas">
      <header
        onPointerDown={startWindowDrag}
        className="window-drag-strip flex h-8 shrink-0 cursor-grab select-none items-center border-b border-line/70 bg-surface/45 px-2.5"
        title="按住此处拖动快捷面板"
      >
        <GripHorizontal
          aria-hidden="true"
          className="size-3.5 shrink-0 text-ink-faint/70"
        />
        <div className="ml-auto flex items-center gap-0.5" data-no-window-drag>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => openManager("library")}
            aria-label="打开完整管理"
            title="打开命令库"
          >
            <PanelTopOpen />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={() => openManager("settings")}
            aria-label="打开设置"
            title="设置"
          >
            <Settings2 />
          </Button>
        </div>
      </header>

      <div className="shrink-0 px-3 pb-2 pt-1.5">
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder={searchPlaceholder}
          aria-label="搜索内容"
          className="h-9 rounded-[10px] pl-8 pr-9 text-[13px] shadow-[var(--shadow-soft)] focus:shadow-[0_0_0_3px_var(--brand-soft),var(--shadow-soft)]"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 pb-1">
        <div
          className="flex flex-1 items-center gap-0.5 rounded-[10px] border border-line/70 bg-muted/75 p-0.5"
          role="group"
          aria-label="快捷面板内容类型"
        >
          {CONTENT_TYPES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={contentType === item.value}
              onClick={() => setContentType(item.value)}
              className={cn(
                "flex h-7 flex-1 items-center justify-center gap-1 rounded-[8px] text-[11px] transition-[background-color,box-shadow,color]",
                contentType === item.value
                  ? "border border-line/80 bg-surface font-medium text-ink shadow-sm"
                  : "border border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {contentTypeIcon(item.value)}
              {item.label}
            </button>
          ))}
        </div>
        <span className="flex w-3 shrink-0 items-center justify-end">
          {systemLoading && contentType === "clipboard" ? (
            <LoaderCircle className="size-2.5 animate-spin text-ink-faint" />
          ) : commandTabLoading || promptTabLoading || clipboardLoading ? (
            <LoaderCircle className="size-2.5 animate-spin text-ink-faint" />
          ) : null}
        </span>
      </div>

      {contentType !== "clipboard" ? (
        <div className="flex shrink-0 items-center gap-1 px-3 pb-1.5">
          <div
            className="flex items-center gap-0.5 rounded-[8px] border border-line/70 bg-muted/45 p-0.5"
            role="group"
            aria-label="内容筛选"
          >
            {CONTENT_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={activeFilter === item.value}
                onClick={() => setActiveFilter(item.value)}
                className={cn(
                  "h-5 rounded-[6px] px-1.5 text-[9.5px] transition-colors",
                  activeFilter === item.value
                    ? "bg-surface font-medium text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[9px] text-ink-faint">
            {contentType === "prompts"
              ? "单击复制 · 右键更多"
              : "单击复制 · 右键更多"}
          </span>
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        <RuntimeWarnings mode="quick" compact />

        <div className="flex h-6 items-center justify-between px-1.5">
          <span className="ui-eyebrow">{eyebrow}</span>
          <span className="text-[9px] tabular-nums text-ink-faint">
            {commandTabLoading || promptTabLoading || clipboardLoading
              ? "加载中"
              : `${visibleCount} 条`}
          </span>
        </div>

        {contentType === "clipboard" ? (
          <>
            {clipboardError ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <p className="text-[12px] text-danger">{clipboardError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRefreshTick((value) => value + 1)}
                >
                  重试
                </Button>
              </div>
            ) : clipboardLoading && !clipboardState ? (
              <div className="flex items-center justify-center gap-2 pt-10 text-[12px] text-ink-faint">
                <LoaderCircle className="size-3.5 animate-spin" />
                正在读取剪贴板…
              </div>
            ) : (
              <>
                {currentError ? (
                  <p className="mb-1.5 rounded border border-danger/20 bg-danger-soft px-2 py-1 text-[10.5px] leading-4 text-danger">
                    无法读取当前剪贴板：{currentError}
                  </p>
                ) : null}
                {statusMessage ? (
                  <p className="mb-1.5 rounded border border-line bg-surface px-2 py-1 text-[10px] leading-4 text-ink-faint">
                    {statusMessage}
                  </p>
                ) : null}
                {localDisabledMessage ? (
                  <p className="mb-1.5 rounded border border-line bg-surface px-2 py-1 text-[10px] leading-4 text-ink-faint">
                    {localDisabledMessage}
                  </p>
                ) : null}
                {!currentError &&
                clipboardState &&
                !clipboardState.current &&
                allClipboardItems.length > 0 ? (
                  <p className="mb-1.5 rounded border border-line bg-surface px-2 py-1 text-[10px] leading-4 text-ink-faint">
                    当前剪贴板没有可读取的文本，以下为剪贴板历史。
                  </p>
                ) : null}
                {systemLoading && allClipboardItems.length > 0 ? (
                  <p className="mb-1 flex items-center gap-1 px-1 text-[9.5px] text-ink-faint">
                    <LoaderCircle className="size-2.5 animate-spin" />
                    正在读取 Windows 剪贴板历史…
                  </p>
                ) : null}

                {filteredClipboardItems.length === 0 ? (
                  <EmptyState
                    compact
                    className="pt-5"
                    icon={<Clipboard className="size-3.5" />}
                    title={
                      hasQuery ? "没有匹配的剪贴板内容" : "剪贴板中没有文本"
                    }
                    description={
                      hasQuery
                        ? "尝试其他关键词，或清空搜索。"
                        : "在终端或其他应用中复制一段命令，再回到这里。"
                    }
                    action={
                      hasQuery ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setQuery("");
                            searchRef.current?.focus();
                          }}
                        >
                          清空搜索
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openManager("library")}
                        >
                          打开命令库
                        </Button>
                      )
                    }
                  />
                ) : (
                  <div
                    role="listbox"
                    aria-label="剪贴板文本列表"
                    className="space-y-1"
                  >
                    {filteredClipboardItems.map((item, index) => (
                      <ClipboardQuickItem
                        key={item.key}
                        item={item}
                        selected={index === activeIndex}
                        expanded={expandedKeys.has(item.key)}
                        saving={savingKey === item.key}
                        savingPrompt={savingPromptKey === item.key}
                        copying={copyingKey === item.key}
                        onSelect={() => setActiveIndex(index)}
                        onSave={() => void saveItem(item)}
                        onSaveAsPrompt={() => void saveItemAsPrompt(item)}
                        onCopy={() => void copyClipboardItem(item)}
                        onOpenSaved={() => {
                          if (item.savedCommandId) {
                            openSavedCommand(item.savedCommandId);
                          }
                        }}
                        onToggleExpanded={() => toggleExpanded(item.key)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        ) : contentType === "library" ? (
          commandError ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <p className="text-[12px] text-danger">{commandError}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRefreshTick((value) => value + 1)}
              >
                重试
              </Button>
            </div>
          ) : commandTabLoading && commands.length === 0 ? (
            <div className="flex items-center justify-center gap-2 pt-10 text-[12px] text-ink-faint">
              <LoaderCircle className="size-3.5 animate-spin" />
              正在读取命令…
            </div>
          ) : commands.length === 0 ? (
            <EmptyState
              compact
              className="pt-5"
              icon={<CommandIcon className="size-3.5" />}
              title={commandEmptyTitle}
              description={commandEmptyDescription}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openManager("library")}
                >
                  打开命令库
                </Button>
              }
            />
          ) : (
            <>
              {hasQuery ? (
                <p className="px-1.5 pb-1 text-[10px] text-ink-faint">
                  在命令库中搜索
                </p>
              ) : null}
              <div role="listbox" aria-label="命令列表" className="space-y-1">
                {commands.map((command, index) => (
                  <QuickCommandItem
                    key={command.id}
                    command={command}
                    categoryPath={
                      command.categoryId
                        ? categoryPathMap.get(command.categoryId)
                        : undefined
                    }
                    selected={index === activeIndex}
                    onSelect={() => setActiveIndex(index)}
                    onCopy={() => void copyCommand(command)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openCommandMenu(command, {
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  />
                ))}
              </div>
            </>
          )
        ) : promptError ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-[12px] text-danger">{promptError}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRefreshTick((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        ) : promptTabLoading && prompts.length === 0 ? (
          <div className="flex items-center justify-center gap-2 pt-10 text-[12px] text-ink-faint">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在读取提示词…
          </div>
        ) : prompts.length === 0 ? (
          <EmptyState
            compact
            className="pt-5"
            icon={<MessageSquareText className="size-3.5" />}
            title={promptEmptyTitle}
            description={promptEmptyDescription}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openManager("prompts")}
              >
                打开提示词库
              </Button>
            }
          />
        ) : (
          <>
            {hasQuery ? (
              <p className="px-1.5 pb-1 text-[10px] text-ink-faint">
                在提示词库中搜索
              </p>
            ) : null}
            <div role="listbox" aria-label="提示词列表" className="space-y-1">
              {prompts.map((prompt, index) => (
                <QuickPromptItem
                  key={prompt.id}
                  prompt={prompt}
                  categoryPath={
                    prompt.categoryId
                      ? promptCategoryPathMap.get(prompt.categoryId)
                      : undefined
                  }
                  selected={index === activeIndex}
                  expanded={expandedPromptKeys.has(prompt.id)}
                  canExpand={
                    prompt.content.split(/\r?\n/).length > 5 ||
                    prompt.content.length > 360
                  }
                  copying={copyingPromptId === prompt.id}
                  onSelect={() => setActiveIndex(index)}
                  onCopy={() => void copyPrompt(prompt)}
                  onEdit={() => openPromptInManager(prompt.id, true)}
                  onToggleFavorite={() => void favoritePrompt(prompt)}
                  onToggleExpanded={() => togglePromptExpanded(prompt.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openPromptMenu(prompt, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="flex h-8 shrink-0 items-center border-t border-line/80 bg-surface/55 px-3 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          选择
          <span className="mx-0.5">·</span>
          <Kbd>Enter</Kbd>
          复制
          {contentType === "clipboard" ? (
            <>
              <span className="mx-0.5">·</span>
              <Kbd>Ctrl</Kbd>
              <Kbd>S</Kbd>
              保存
            </>
          ) : null}
          {contentType === "prompts" &&
          activePrompt &&
          expandedPromptKeys.has(activePrompt.id) ? (
            <>
              <span className="mx-0.5">·</span>
              <Kbd>Esc</Kbd>
              收起
            </>
          ) : null}
          <span className="mx-0.5">·</span>
          <Kbd>Esc</Kbd>
          {query.length > 0 ? "清空" : "隐藏"}
        </span>
        <span className="ml-auto text-[9.5px]">
          {contentType === "prompts"
            ? "提示词保存在本机"
            : clipboardState
              ? `本地 ${clipboardState.localHistoryCount} 条`
              : "剪贴板历史仅保存在本机"}
        </span>
      </footer>

      <CommandContextMenu
        context="quick"
        command={commandMenu?.command ?? null}
        position={commandMenu?.position ?? { x: 0, y: 0 }}
        categories={categories}
        onClose={() => setCommandMenu(null)}
        onCopy={(command) => void copyCommand(command)}
        onEdit={(command) => openSavedCommand(command.id)}
        onToggleFavorite={(command) => void favoriteCommand(command)}
        selectionCount={1}
        allFollowCategoryColor={commandMenu?.command.useCategoryColor ?? false}
        aiAction={
          commandMenu ? ai.menuAction(commandMenu.command) : undefined
        }
        onSetColor={openCommandColor}
        onToggleCategoryColor={(command) =>
          void toggleFollowCategoryColor(command)
        }
        onMove={(command, categoryId, label) =>
          moveCommand(command, categoryId, label)
        }
        onView={(command) => openSavedCommand(command.id)}
        onDelete={(command) => setQuickDeleteTarget(command)}
        onCreateCategory={createCategoryForMenu}
      />

      <PromptContextMenu
        context="quick"
        prompt={promptMenu?.prompt ?? null}
        position={promptMenu?.position ?? { x: 0, y: 0 }}
        categories={promptCategories}
        selectionCount={1}
        onClose={() => setPromptMenu(null)}
        onCopy={(prompt) => void copyPrompt(prompt)}
        onEdit={(prompt) => openPromptInManager(prompt.id, true)}
        onToggleFavorite={(prompt) => void favoritePrompt(prompt)}
        onSetColor={openPromptColor}
        onMove={(prompt, categoryId, label) =>
          movePrompt(prompt, categoryId, label)
        }
        onView={(prompt) => openPromptInManager(prompt.id, false)}
        onDelete={(prompt) => setPromptDeleteTarget(prompt)}
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

      <ColorPickerPopover
        open={colorCommand !== null}
        anchor={colorTarget?.anchor ?? { x: 0, y: 0 }}
        commands={colorCommand ? [colorCommand] : []}
        onClose={() => setColorTarget(null)}
        onApplyColor={applyCommandColor}
        onFollowCategoryColor={applyCommandFollow}
      />

      <PromptColorPopover
        open={colorPrompt !== null}
        anchor={promptColorTarget?.anchor ?? { x: 0, y: 0 }}
        prompts={colorPrompt ? [colorPrompt] : []}
        onClose={() => setPromptColorTarget(null)}
        onApplyColor={applyPromptColor}
      />

      <ConfirmDialog
        open={quickDeleteTarget !== null}
        title="删除命令"
        description={
          quickDeleteTarget ? (
            <>
              确认删除「{commandLabel(quickDeleteTarget)}」？删除后命令会从命令库和快捷面板隐藏，数据库保留原始记录。
            </>
          ) : null
        }
        confirmLabel="删除命令"
        danger
        busy={quickDeleting}
        onConfirm={() => void confirmQuickDelete()}
        onClose={() => {
          if (!quickDeleting) {
            setQuickDeleteTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={promptDeleteTarget !== null}
        title="删除提示词"
        description={
          promptDeleteTarget ? (
            <>
              确认删除「{promptDisplayTitle(promptDeleteTarget)}」？删除后提示词会从提示词库和快捷面板隐藏，数据库保留原始记录。
            </>
          ) : null
        }
        confirmLabel="删除提示词"
        danger
        busy={quickDeleting}
        onConfirm={() => void confirmPromptDelete()}
        onClose={() => {
          if (!quickDeleting) {
            setPromptDeleteTarget(null);
          }
        }}
      />

      <SensitiveClipboardDialog
        item={sensitiveItem}
        busy={savingKey !== null || savingPromptKey !== null}
        onConfirm={() => {
          if (sensitiveItem) {
            if (sensitiveMode === "prompt") {
              void saveItemAsPrompt(sensitiveItem, true);
            } else {
              void saveItem(sensitiveItem, true);
            }
          }
        }}
        onClose={() => {
          if (!savingKey && !savingPromptKey) {
            setSensitiveItem(null);
          }
        }}
      />
    </div>
  );
}
