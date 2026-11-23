import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClipboardPage } from "@/features/command-manager/ClipboardPage";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { ClipboardItem, ClipboardState, Command, Prompt } from "@/types/app";

vi.mock("@/services/appApi", () => ({
  appApi: {
    getClipboardState: vi.fn(),
    saveClipboardText: vi.fn(),
    saveClipboardAsPrompt: vi.fn(),
    copyClipboardText: vi.fn(),
    clearClipboardHistory: vi.fn(),
  },
}));

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

const localItem: ClipboardItem = {
  key: "local-1",
  content: "git status\n--short",
  source: "local_monitor",
  copiedAt: Date.now() - 60_000,
  isCurrent: false,
  isSensitive: false,
  savedCommandId: null,
  savedCommandIsFavorite: false,
};

const sensitiveItem: ClipboardItem = {
  key: "local-2",
  content: "password=hunter2",
  source: "local_monitor",
  copiedAt: Date.now() - 120_000,
  isCurrent: false,
  isSensitive: true,
  savedCommandId: null,
  savedCommandIsFavorite: false,
};

const clipboardState: ClipboardState = {
  current: currentItem,
  localItems: [localItem, sensitiveItem],
  localHistoryEnabled: true,
  localHistoryCount: 2,
  currentError: null,
  monitorWarning: null,
};

const savedCommand: Command = {
  id: "saved-1",
  title: "git status",
  command: "git status\n--short",
  description: "",
  shell: "unknown",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: null,
  useCategoryColor: false,
  tags: [],
  sourceType: "clipboard_history",
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

const promptFixture: Prompt = {
  id: "prompt-1",
  title: "docker ps -a",
  content: "docker ps -a",
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

describe("ClipboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appApi.getClipboardState).mockResolvedValue(clipboardState);
    vi.mocked(appApi.saveClipboardText).mockResolvedValue({
      command: savedCommand,
      created: true,
    });
    vi.mocked(appApi.saveClipboardAsPrompt).mockResolvedValue({
      prompt: promptFixture,
      created: true,
    });
    vi.mocked(appApi.copyClipboardText).mockResolvedValue(undefined);
    vi.mocked(appApi.clearClipboardHistory).mockResolvedValue({ removed: 2 });
    useAppStore.setState({
      clipboardRevision: 0,
      dataRevision: 0,
      notice: null,
    });
  });

  it("saves the current clipboard through the shared command service", async () => {
    render(<ClipboardPage />);
    await screen.findByText("当前剪贴板");

    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);

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

  it("preserves multi-line content when saving a history item", async () => {
    render(<ClipboardPage />);
    const row = (await screen.findByText(/git status/)).closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(appApi.saveClipboardText).toHaveBeenCalledWith({
        content: "git status\n--short",
        source: "local_monitor",
        allowSensitive: false,
      });
    });
  });

  it("filters history and restores it with the clear control", async () => {
    render(<ClipboardPage />);
    await screen.findByText("password=hunter2");
    const search = screen.getByRole("searchbox", {
      name: "搜索剪贴板历史",
    });

    fireEvent.change(search, { target: { value: "git" } });
    expect(screen.queryByText("password=hunter2")).toBeNull();
    expect(screen.getByText(/git status/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(await screen.findByText("password=hunter2")).toBeInTheDocument();
  });

  it("copies the full original clipboard text", async () => {
    render(<ClipboardPage />);
    await screen.findByText("当前剪贴板");
    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);

    await waitFor(() => {
      expect(appApi.copyClipboardText).toHaveBeenCalledWith("docker ps -a");
    });
  });

  it("requires confirmation before saving sensitive history", async () => {
    render(<ClipboardPage />);
    const row = (await screen.findByText("password=hunter2")).closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("疑似包含敏感信息"),
    ).toBeInTheDocument();
    expect(appApi.saveClipboardText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "仍然保存" }));

    await waitFor(() => {
      expect(appApi.saveClipboardText).toHaveBeenCalledWith({
        content: "password=hunter2",
        source: "local_monitor",
        allowSensitive: true,
      });
    });
  });

  it("can save the same clipboard text as a prompt without using the command path", async () => {
    render(<ClipboardPage />);
    await screen.findByText("当前剪贴板");

    fireEvent.click(
      screen.getAllByRole("button", { name: "更多保存方式" })[0],
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
    expect(appApi.saveClipboardText).not.toHaveBeenCalled();
    expect(useAppStore.getState().notice?.message).toBe(
      "已保存到提示词库的“默认”目录",
    );
  });
});
