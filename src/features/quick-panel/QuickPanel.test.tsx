import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickPanel } from "@/features/quick-panel/QuickPanel";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  AppSnapshot,
  ClipboardItem,
  ClipboardState,
  Command,
  Prompt,
  SystemClipboardHistory,
} from "@/types/app";

vi.mock("@/services/appApi", () => ({
  appApi: {
    getClipboardState: vi.fn(),
    getSystemClipboardHistory: vi.fn(),
    getClipboardStatus: vi.fn(),
    saveClipboardText: vi.fn(),
    copyClipboardText: vi.fn(),
    clearClipboardHistory: vi.fn(),
    listCommands: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    listPrompts: vi.fn().mockResolvedValue([]),
    listPromptCategories: vi.fn().mockResolvedValue([]),
    listPromptTags: vi.fn().mockResolvedValue([]),
    saveClipboardAsPrompt: vi.fn(),
    copyPrompts: vi.fn(),
    togglePromptFavorite: vi.fn(),
    movePromptsToCategory: vi.fn(),
    restorePromptPlacements: vi.fn(),
    deletePrompt: vi.fn(),
    setPromptsColor: vi.fn().mockResolvedValue(1),
    createCategory: vi.fn(),
    startWindowDrag: vi.fn().mockResolvedValue(undefined),
    hideWindow: vi.fn().mockResolvedValue(undefined),
    setUiMode: vi.fn().mockResolvedValue(undefined),
    copyCommands: vi.fn(),
    toggleCommandFavorite: vi.fn(),
    moveCommandsToCategory: vi.fn(),
    restoreCommandPlacements: vi.fn(),
    deleteCommand: vi.fn(),
    setCommandsColor: vi.fn().mockResolvedValue(1),
    setCommandsFollowCategoryColor: vi.fn().mockResolvedValue(1),
  },
}));

const snapshot: AppSnapshot = {
  version: "0.2.0",
  settings: {
    shortcut: "Ctrl+Shift+V",
    launchAtStartup: false,
    autoHideQuickPanel: true,
    theme: "system",
    sidebarWidth: 172,
    clipboardMonitoringEnabled: true,
    clipboardHistoryLimit: 100,
    clipboardHistoryRetentionDays: 7,
    hideQuickPanelAfterCopy: false,
    customColors: [],
    aiProvider: "deepseek",
    aiBaseUrl: "https://api.deepseek.com/v1",
    aiModel: "deepseek-chat",
    aiTimeoutSeconds: 30,
    aiTemperature: null,
    aiAutoAnnotation: false,
  },
  uiMode: "quick",
  shortcut: { registered: true, error: null },
  autostartEnabled: false,
  aiApiKeyConfigured: false,
  settingsPath: "C:\\Users\\test\\settings.json",
  settingsWarning: null,
  databasePath: "C:\\Users\\test\\commands.db",
  databaseWarning: null,
};

const currentItem: ClipboardItem = {
  key: "current",
  content: "docker ps -a",
  source: "current",
  copiedAt: Date.now(),
  isCurrent: true,
  isSensitive: false,
  savedCommandId: null,
  savedCommandIsFavorite: false,
};

const clipboardState: ClipboardState = {
  current: currentItem,
  localItems: [],
  localHistoryEnabled: true,
  localHistoryCount: 0,
  currentError: null,
  monitorWarning: null,
};

const emptySystemHistory: SystemClipboardHistory = {
  status: "available",
  enabled: true,
  items: [],
  message: null,
};

const savedCommand: Command = {
  id: "4b2d5f2b-3a2a-49ce-9b72-cf9b6ed70c35",
  title: "docker ps -a",
  command: "docker ps -a",
  description: "",
  shell: "unknown",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: null,
  useCategoryColor: false,
  tags: [],
  sourceType: "clipboard_current",
  aiAnnotationStatus: "none",
  contentHash: "",
  aiAnnotation: null,
  isFavorite: false,
  sortOrder: 10,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

const prompt: Prompt = {
  id: "prompt-1",
  title: "代码审查提示词",
  content:
    "请你作为资深工程师检查以下代码。\n\n请重点关注：\n1. 代码逻辑\n2. 性能问题\n3. 安全风险\n4. 可维护性\n5. 测试覆盖\n\n```ts\nconst x = 1;\n```",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: null,
  tags: [],
  isFavorite: false,
  sortOrder: 10,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("QuickPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appApi.getClipboardState).mockResolvedValue(clipboardState);
    vi.mocked(appApi.getSystemClipboardHistory).mockResolvedValue(
      emptySystemHistory,
    );
    vi.mocked(appApi.listCommands).mockResolvedValue([]);
    vi.mocked(appApi.listPrompts).mockResolvedValue([]);
    vi.mocked(appApi.listPromptCategories).mockResolvedValue([]);
    vi.mocked(appApi.listPromptTags).mockResolvedValue([]);
    vi.mocked(appApi.saveClipboardAsPrompt).mockResolvedValue({
      prompt,
      created: true,
    });
    vi.mocked(appApi.copyClipboardText).mockResolvedValue(undefined);
    vi.mocked(appApi.saveClipboardText).mockResolvedValue({
      command: savedCommand,
      created: true,
    });
    useAppStore.setState({
      snapshot,
      uiMode: "quick",
      focusSearchRequest: 0,
      notice: null,
      clipboardRevision: 0,
      dataRevision: 0,
      commandDetailRequest: null,
    });
  });

  it("renders the clipboard-first panel with the two-level navigation", async () => {
    render(<QuickPanel />);

    expect(screen.queryByText("Pata Commands")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick")).not.toBeInTheDocument();
    expect(screen.getByText("剪贴板")).toBeInTheDocument();
    expect(screen.getByText("命令库")).toBeInTheDocument();
    expect(screen.getByText("提示词库")).toBeInTheDocument();
    expect(await screen.findByText("docker ps -a")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开完整管理" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开设置" })).toBeInTheDocument();
  });

  it("shows a truthful empty clipboard state without clearing local history", async () => {
    vi.mocked(appApi.getClipboardState).mockResolvedValue({
      ...clipboardState,
      current: null,
      localHistoryCount: 2,
      localItems: [],
    });
    render(<QuickPanel />);

    expect(
      await screen.findByText("剪贴板中没有文本"),
    ).toBeInTheDocument();
    expect(screen.getByText("本地 2 条")).toBeInTheDocument();
  });

  it("saves the selected clipboard item with one click", async () => {
    render(<QuickPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(appApi.saveClipboardText).toHaveBeenCalledWith({
        content: "docker ps -a",
        source: "current",
        allowSensitive: false,
      });
    });
    expect(
      await screen.findByRole("button", { name: "已保存" }),
    ).toBeInTheDocument();
    expect(useAppStore.getState().notice?.message).toBe(
      "已保存到命令库的“默认”目录",
    );
  });

  it("saves with Ctrl+S and copies with Enter", async () => {
    render(<QuickPanel />);
    await screen.findByRole("button", { name: "保存" });
    const search = screen.getByRole("searchbox");
    // Let the async clipboard load settle and the window key listener attach.
    await new Promise((resolve) => setTimeout(resolve, 25));

    fireEvent.keyDown(search, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(appApi.saveClipboardText).toHaveBeenCalledOnce();
    });

    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => {
      expect(appApi.copyClipboardText).toHaveBeenCalledWith("docker ps -a");
    });
  });

  it("requires confirmation before persisting sensitive clipboard text", async () => {
    vi.mocked(appApi.getClipboardState).mockResolvedValue({
      ...clipboardState,
      current: { ...currentItem, isSensitive: true },
    });
    render(<QuickPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("疑似包含敏感信息"),
    ).toBeInTheDocument();
    expect(appApi.saveClipboardText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "仍然保存" }));

    await waitFor(() => {
      expect(appApi.saveClipboardText).toHaveBeenCalledWith({
        content: "docker ps -a",
        source: "current",
        allowSensitive: true,
      });
    });
  });

  it("switches to the command library and copies a command", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    vi.mocked(appApi.copyCommands).mockResolvedValue({
      copiedCount: 1,
      usageRecorded: true,
      warning: null,
    });
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));

    const commandOption = await screen.findByRole("option", {
      name: /docker ps -a/,
    });
    fireEvent.click(commandOption);

    await waitFor(() => {
      expect(appApi.copyCommands).toHaveBeenCalledWith([savedCommand.id]);
    });
  });

  it("opens the command context menu without copying", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));
    const command = await screen.findByRole("option", {
      name: /docker ps -a/,
    });

    fireEvent.contextMenu(command);
    expect(
      await screen.findByRole("menuitem", { name: "编辑命令" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "AI 生成注释" }),
    ).toBeInTheDocument();
    expect(appApi.copyCommands).not.toHaveBeenCalled();
  });

  it("guides to settings when AI is not configured and the quick menu action is used", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));
    const command = await screen.findByRole("option", {
      name: /docker ps -a/,
    });

    fireEvent.contextMenu(command);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "AI 生成注释" }),
    );

    await waitFor(() => {
      expect(useAppStore.getState().notice).toMatchObject({
        kind: "info",
        message: expect.stringContaining("尚未配置"),
      });
    });
    expect(appApi.setUiMode).not.toHaveBeenCalled();
  });

  it("supports keyboard access to the command context menu", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));
    await screen.findByRole("option", { name: /docker ps -a/ });

    fireEvent.keyDown(window, { key: "F10", shiftKey: true });
    expect(
      await screen.findByRole(
        "menuitem",
        { name: "复制命令" },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it("opens the compact color popover from the quick command menu", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));
    const command = await screen.findByRole("option", {
      name: /docker ps -a/,
    });
    fireEvent.contextMenu(command);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "设置颜色" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "设置颜色" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "淡紫 #F4EFFB" }),
    );

    await waitFor(() => {
      expect(appApi.setCommandsColor).toHaveBeenCalledWith(
        [savedCommand.id],
        "#F4EFFB",
      );
    });
  });

  it("favorites a command from the context menu", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    vi.mocked(appApi.toggleCommandFavorite).mockResolvedValue({
      ...savedCommand,
      isFavorite: true,
    });
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));
    const command = await screen.findByRole("option", {
      name: /docker ps -a/,
    });
    fireEvent.contextMenu(command);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "收藏命令" }),
    );

    await waitFor(() => {
      expect(appApi.toggleCommandFavorite).toHaveBeenCalledWith(savedCommand.id);
    });
  });

  it("moves a command from the context menu", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    vi.mocked(appApi.listCategories).mockResolvedValue([
      {
        id: "cat-docker",
        name: "Docker",
        parentId: null,
        sortOrder: 10,
        commandCount: 1,
        color: null,
        iconName: null,
        children: [],
      },
    ]);
    vi.mocked(appApi.moveCommandsToCategory).mockResolvedValue({
      moved: 1,
      previous: [],
    });
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));
    const command = await screen.findByRole("option", {
      name: /docker ps -a/,
    });
    fireEvent.contextMenu(command);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "移动到目录" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Docker" }),
    );

    await waitFor(() => {
      expect(appApi.moveCommandsToCategory).toHaveBeenCalledWith(
        [savedCommand.id],
        "cat-docker",
      );
    });
  });

  it("requires confirmation to delete from the context menu", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([savedCommand]);
    vi.mocked(appApi.deleteCommand).mockResolvedValue(undefined);
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /命令库/ }));
    const command = await screen.findByRole("option", {
      name: /docker ps -a/,
    });
    fireEvent.contextMenu(command);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "删除命令" }),
    );
    expect(await screen.findByText("确认删除", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除命令" }));

    await waitFor(() => {
      expect(appApi.deleteCommand).toHaveBeenCalledWith(savedCommand.id);
    });
  });

  it("starts a native window drag from the explicit drag strip", () => {
    render(<QuickPanel />);
    fireEvent.pointerDown(
      screen.getByTitle("按住此处拖动快捷面板"),
      { button: 0, pointerId: 1 },
    );

    expect(appApi.startWindowDrag).toHaveBeenCalledOnce();
  });

  it("hides the panel with Escape", async () => {
    render(<QuickPanel />);
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(appApi.hideWindow).toHaveBeenCalledOnce();
    });
  });

  it("clears a non-empty search before hiding with Escape", async () => {
    render(<QuickPanel />);
    await screen.findByText("docker ps -a");
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "docker" } });

    expect(
      screen.getAllByRole("button", { name: "清空搜索" }),
    ).toHaveLength(1);
    expect(search).toHaveValue("docker");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(search).toHaveValue(""));
    expect(appApi.hideWindow).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(appApi.hideWindow).toHaveBeenCalledOnce();
    });
  });

  it("focuses the search field when the panel is shown again", async () => {
    render(<QuickPanel />);
    await screen.findByText("docker ps -a");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("switches to the prompt library and copies the full prompt", async () => {
    vi.mocked(appApi.listPrompts).mockResolvedValue([prompt]);
    vi.mocked(appApi.copyPrompts).mockResolvedValue({
      copiedCount: 1,
      usageRecorded: true,
      warning: null,
    });
    render(<QuickPanel />);

    fireEvent.click(screen.getByRole("button", { name: /提示词库/ }));
    const option = await screen.findByRole("option", {
      name: /代码审查提示词/,
    });
    fireEvent.click(option);

    await waitFor(() => {
      expect(appApi.copyPrompts).toHaveBeenCalledWith([prompt.id]);
    });
  });

  it("expands a long prompt inside the quick panel", async () => {
    vi.mocked(appApi.listPrompts).mockResolvedValue([prompt]);
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /提示词库/ }));
    await screen.findByRole("option", { name: /代码审查提示词/ });

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "收起" })).toBeNull();
    expect(appApi.hideWindow).not.toHaveBeenCalled();
  });

  it("saves clipboard content as a prompt from the save menu", async () => {
    render(<QuickPanel />);
    await screen.findByRole("button", { name: "保存" });

    fireEvent.click(
      screen.getByRole("button", { name: "更多保存方式" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "保存为提示词" }),
    );

    await waitFor(() => {
      expect(appApi.saveClipboardAsPrompt).toHaveBeenCalledWith(
        "docker ps -a",
        false,
      );
    });
    expect(useAppStore.getState().notice?.message).toBe(
      "已保存到提示词库的“默认”目录",
    );
    expect(appApi.saveClipboardText).not.toHaveBeenCalled();
  });

  it("favorites a prompt from the quick context menu", async () => {
    vi.mocked(appApi.listPrompts).mockResolvedValue([prompt]);
    vi.mocked(appApi.togglePromptFavorite).mockResolvedValue({
      ...prompt,
      isFavorite: true,
    });
    render(<QuickPanel />);
    fireEvent.click(screen.getByRole("button", { name: /提示词库/ }));
    const option = await screen.findByRole("option", {
      name: /代码审查提示词/,
    });
    fireEvent.contextMenu(option);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "收藏提示词" }),
    );

    await waitFor(() => {
      expect(appApi.togglePromptFavorite).toHaveBeenCalledWith(prompt.id);
    });
  });
});
