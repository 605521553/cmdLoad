import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPage } from "@/features/command-manager/LibraryPage";
import { appApi } from "@/services/appApi";
import type { Command } from "@/types/app";

vi.mock("@/services/appApi", () => ({
  appApi: {
    listCommands: vi.fn(),
    listCategories: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([]),
    copyCommands: vi.fn(),
    createCommand: vi.fn(),
    updateCommand: vi.fn(),
    deleteCommand: vi.fn(),
    toggleCommandFavorite: vi.fn(),
    reorderCommands: vi.fn(),
    createCategory: vi.fn(),
    moveCommandsToCategory: vi.fn(),
    restoreCommandPlacements: vi.fn(),
    reorderCategories: vi.fn(),
    deleteCategoryWithOptions: vi.fn(),
    setCommandsColor: vi.fn().mockResolvedValue(1),
    setCommandsFollowCategoryColor: vi.fn().mockResolvedValue(1),
    setCategoryAppearance: vi.fn().mockResolvedValue(undefined),
  },
}));

const dockerCommand: Command = {
  id: "6b0a26d6-6f2f-4e8d-a9d4-8af18f0a7f11",
  title: "Docker 状态",
  command: "docker compose ps",
  description: "查看容器状态",
  shell: "bash",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: null,
  useCategoryColor: false,
  tags: [{ id: "tag-1", name: "docker", color: null }],
  sourceType: "manual",
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

describe("LibraryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(appApi.listCommands).mockResolvedValue([]);
    vi.mocked(appApi.listCategories).mockResolvedValue([]);
    vi.mocked(appApi.listTags).mockResolvedValue([]);
  });

  it("uses a real empty state with an enabled add action", async () => {
    render(<LibraryPage />);

    expect(await screen.findByText("暂无命令")).toBeInTheDocument();
    expect(
      screen.getByText("添加第一条命令，开始建立本地命令库。"),
    ).toBeInTheDocument();
    const addButtons = screen.getAllByRole("button", { name: "添加命令" });
    expect(addButtons.length).toBeGreaterThan(0);
    addButtons.forEach((button) => expect(button).toBeEnabled());
  });

  it("shows a no-results state for a query", async () => {
    render(<LibraryPage />);
    await screen.findByText("暂无命令");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "docker" },
    });

    expect(await screen.findByText("未找到命令")).toBeInTheDocument();
  });

  it("switches the active filter and uses a truthful empty state", async () => {
    render(<LibraryPage />);
    await screen.findByText("暂无命令");
    fireEvent.click(screen.getByRole("button", { name: "收藏" }));

    expect(screen.getByRole("button", { name: "收藏" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByText("暂无收藏命令")).toBeInTheDocument();
  });

  it("switches sort mode and requests the matching backend order", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([dockerCommand]);
    render(<LibraryPage />);
    await screen.findByRole("listbox", { name: "命令列表" });
    fireEvent.change(screen.getByLabelText("排序方式"), {
      target: { value: "name" },
    });

    await waitFor(() => {
      expect(appApi.listCommands).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "title" }),
      );
    });
  });

  it("shows selection order numbers and copies in click order", async () => {
    const second: Command = {
      ...dockerCommand,
      id: "6b0a26d6-6f2f-4e8d-a9d4-8af18f0a7f12",
      title: "Git 状态",
      command: "git status",
    };
    vi.mocked(appApi.listCommands).mockResolvedValue([
      dockerCommand,
      second,
    ]);
    vi.mocked(appApi.copyCommands).mockResolvedValue({
      copiedCount: 2,
      usageRecorded: true,
      warning: null,
    });
    render(<LibraryPage />);
    const list = within(
      await screen.findByRole("listbox", { name: "命令列表" }),
    );

    fireEvent.click(list.getByText("Git 状态"), { ctrlKey: true });
    fireEvent.click(list.getByText("Docker 状态"), { ctrlKey: true });

    expect(screen.getByLabelText("第 1 个选择")).toHaveTextContent("1");
    expect(screen.getByLabelText("第 2 个选择")).toHaveTextContent("2");
    expect(appApi.copyCommands).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "按选择顺序复制" }),
    );
    await waitFor(() => {
      expect(appApi.copyCommands).toHaveBeenCalledWith([
        second.id,
        dockerCommand.id,
      ]);
    });
  });

  it("offers batch AI annotation only for commands without annotations", async () => {
    const second: Command = {
      ...dockerCommand,
      id: "6b0a26d6-6f2f-4e8d-a9d4-8af18f0a7f12",
      title: "git status",
      command: "git status",
      description: "",
      tags: [],
    };
    vi.mocked(appApi.listCommands).mockResolvedValue([
      dockerCommand,
      second,
    ]);
    render(<LibraryPage />);
    await screen.findByRole("listbox", { name: "命令列表" });

    fireEvent.click(screen.getByLabelText("选择 Docker 状态"));
    fireEvent.click(screen.getByLabelText("选择 git status"));
    const batchButton = screen.getByRole("button", {
      name: /批量 AI 注释/,
    });
    expect(batchButton).toHaveTextContent("(1)");
    fireEvent.click(batchButton);

    expect(
      await screen.findByRole("dialog", { name: "批量生成 AI 注释" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可生成")).toBeInTheDocument();
    expect(screen.getByText("已有注释")).toBeInTheDocument();
  });

  it("shows the one-click AI action for a single manager command", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([dockerCommand]);
    render(<LibraryPage />);
    const list = within(
      await screen.findByRole("listbox", { name: "命令列表" }),
    );
    fireEvent.contextMenu(list.getByText("Docker 状态"));

    expect(
      await screen.findByRole("menuitem", { name: "AI 生成注释" }),
    ).toBeInTheDocument();
  });

  it("hides the one-click AI action when multiple commands are selected", async () => {
    const second: Command = {
      ...dockerCommand,
      id: "6b0a26d6-6f2f-4e8d-a9d4-8af18f0a7f14",
      title: "git status",
      command: "git status",
      description: "",
      tags: [],
    };
    vi.mocked(appApi.listCommands).mockResolvedValue([
      dockerCommand,
      second,
    ]);
    render(<LibraryPage />);
    const list = within(
      await screen.findByRole("listbox", { name: "命令列表" }),
    );
    fireEvent.click(screen.getByLabelText("选择 Docker 状态"));
    fireEvent.click(screen.getByLabelText("选择 git status"));
    fireEvent.contextMenu(list.getByText("Docker 状态"));

    expect(
      await screen.findByRole("menuitem", { name: "编辑命令" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "AI 生成注释" }),
    ).not.toBeInTheDocument();
  });

  it("toggles the follow-category mode from the manager menu", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([dockerCommand]);
    render(<LibraryPage />);
    const list = within(
      await screen.findByRole("listbox", { name: "命令列表" }),
    );
    fireEvent.contextMenu(list.getByText("Docker 状态"));
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "使用所在目录颜色",
      }),
    );

    await waitFor(() => {
      expect(appApi.setCommandsFollowCategoryColor).toHaveBeenCalledWith(
        [dockerCommand.id],
        true,
      );
    });
  });

  it("switches to the tree view and renders category count", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([dockerCommand]);
    vi.mocked(appApi.listCategories).mockResolvedValue([
      {
        id: "cat-1",
        name: "开发",
        parentId: null,
        sortOrder: 10,
        commandCount: 1,
        color: null,
        iconName: null,
        children: [],
      },
    ]);
    render(<LibraryPage />);
    await screen.findByRole("listbox", { name: "命令列表" });
    fireEvent.click(screen.getByRole("button", { name: "树状" }));
    expect(await screen.findByText("开发")).toBeInTheDocument();
  });

  it("moves a command down through the manager context menu", async () => {
    const second: Command = {
      ...dockerCommand,
      id: "6b0a26d6-6f2f-4e8d-a9d4-8af18f0a7f13",
      title: "Git 状态",
      command: "git status",
    };
    vi.mocked(appApi.listCommands).mockResolvedValue([
      dockerCommand,
      second,
    ]);
    vi.mocked(appApi.reorderCommands).mockResolvedValue(undefined);
    render(<LibraryPage />);
    const list = within(
      await screen.findByRole("listbox", { name: "命令列表" }),
    );
    fireEvent.contextMenu(list.getByText("Docker 状态"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "下移" }),
    );

    await waitFor(() => {
      expect(appApi.reorderCommands).toHaveBeenCalledWith([
        second.id,
        dockerCommand.id,
      ]);
    });
  });

  it("renders the selected command in the detail panel", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([dockerCommand]);
    render(<LibraryPage />);
    await screen.findByRole("listbox", { name: "命令列表" });
    const detail = within(screen.getByLabelText("命令详情"));
    expect(detail.getByText("Docker 状态")).toBeInTheDocument();
    expect(detail.getByText("docker compose ps")).toBeInTheDocument();
    expect(detail.getByText("查看容器状态")).toBeInTheDocument();
  });

  it("renders database commands and copies them through the service", async () => {
    vi.mocked(appApi.listCommands).mockResolvedValue([dockerCommand]);
    vi.mocked(appApi.copyCommands).mockResolvedValue({
      copiedCount: 1,
      usageRecorded: true,
      warning: null,
    });
    render(<LibraryPage />);

    const list = within(
      await screen.findByRole("listbox", { name: "命令列表" }),
    );
    expect(list.getByText("Docker 状态")).toBeInTheDocument();
    expect(list.getByText("docker compose ps")).toBeInTheDocument();
    fireEvent.click(list.getByRole("button", { name: "复制 Docker 状态" }));

    await waitFor(() => {
      expect(appApi.copyCommands).toHaveBeenCalledWith([dockerCommand.id]);
    });
  });
});
