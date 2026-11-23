import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptLibraryPage } from "@/features/prompts/PromptLibraryPage";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { Prompt, PromptCategoryNode } from "@/types/app";

vi.mock("@/services/appApi", () => ({
  appApi: {
    listPrompts: vi.fn().mockResolvedValue([]),
    listPromptCategories: vi.fn().mockResolvedValue([]),
    listPromptTags: vi.fn().mockResolvedValue([]),
    getPrompt: vi.fn(),
    createPrompt: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    togglePromptFavorite: vi.fn(),
    copyPrompts: vi.fn(),
    reorderPrompts: vi.fn(),
    movePromptsToCategory: vi.fn(),
    restorePromptPlacements: vi.fn(),
    setPromptsColor: vi.fn().mockResolvedValue(1),
  },
}));

const content =
  "请你作为一名经验丰富的软件工程师，检查以下代码中可能存在的逻辑问题、性能问题以及潜在的安全风险。\n\n```ts\nconst value = 1;\n```\n\n- 逻辑\n- 性能\n- 安全  ";

const prompt: Prompt = {
  id: "prompt-1",
  title: "代码审查提示词",
  content,
  categoryId: "cat-review",
  categoryName: "代码审查",
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: null,
  tags: [{ id: "tag-1", name: "审查", color: null }],
  isFavorite: false,
  sortOrder: 10,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

const categories: PromptCategoryNode[] = [
  {
    id: "cat-code",
    name: "编程开发",
    parentId: null,
    sortOrder: 10,
    promptCount: 0,
    color: null,
    iconName: null,
    children: [
      {
        id: "cat-review",
        name: "代码审查",
        parentId: "cat-code",
        sortOrder: 10,
        promptCount: 1,
        color: null,
        iconName: null,
        children: [],
      },
    ],
  },
];

describe("PromptLibraryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appApi.listPrompts).mockResolvedValue([prompt]);
    vi.mocked(appApi.listPromptCategories).mockResolvedValue(categories);
    vi.mocked(appApi.listPromptTags).mockResolvedValue([
      { id: "tag-1", name: "审查", color: null, commandCount: 1, createdAt: 1 },
    ]);
    vi.mocked(appApi.copyPrompts).mockResolvedValue({
      copiedCount: 1,
      usageRecorded: true,
      warning: null,
    });
    vi.mocked(appApi.togglePromptFavorite).mockResolvedValue({
      ...prompt,
      isFavorite: true,
    });
    vi.mocked(appApi.deletePrompt).mockResolvedValue(undefined);
    vi.mocked(appApi.createPrompt).mockResolvedValue(prompt);
    useAppStore.setState({
      promptRevision: 0,
      promptCategoryFilterId: null,
      tagFilterId: null,
      promptDetailRequest: null,
      notice: null,
    });
  });

  it("shows prompt rows and the full text preview with metadata", async () => {
    render(<PromptLibraryPage />);

    expect(
      await screen.findAllByText("代码审查提示词"),
    ).not.toHaveLength(0);
    const preview = screen.getByRole("complementary", {
      name: "提示词预览",
    });
    expect(preview.querySelector("pre")?.textContent).toBe(content);
    expect(within(preview).getByText("编程开发 / 代码审查")).toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "复制提示词" })).toBeInTheDocument();
    expect(within(preview).queryByText(/Shell/i)).not.toBeInTheDocument();
  });

  it("copies the exact prompt on double click", async () => {
    render(<PromptLibraryPage />);
    const row = await screen.findByTitle(
      "单击选中查看，双击复制完整提示词",
    );
    fireEvent.doubleClick(row);

    await waitFor(() => {
      expect(appApi.copyPrompts).toHaveBeenCalledWith([prompt.id]);
    });
  });

  it("searches the prompt library through the backend", async () => {
    render(<PromptLibraryPage />);
    await screen.findAllByText("代码审查提示词");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索提示词" }), {
      target: { value: "安全" },
    });
    await waitFor(() => {
      expect(appApi.listPrompts).toHaveBeenCalledWith(
        expect.objectContaining({ search: "安全" }),
      );
    });
  });

  it("creates a prompt from the compact text editor", async () => {
    render(<PromptLibraryPage />);
    await screen.findAllByText("代码审查提示词");
    fireEvent.click(screen.getByRole("button", { name: "添加提示词" }));

    const textarea = screen.getByLabelText("提示词内容");
    fireEvent.change(textarea, { target: { value: "新的多行提示词\n第二行  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存提示词" }));

    await waitFor(() => {
      expect(appApi.createPrompt).toHaveBeenCalledWith({
        title: "",
        content: "新的多行提示词\n第二行  ",
        categoryId: null,
        tags: [],
        backgroundColor: null,
        favorite: false,
      });
    });
  });

  it("favorites and soft deletes through the shared prompt actions", async () => {
    render(<PromptLibraryPage />);
    await screen.findAllByText("代码审查提示词");

    fireEvent.click(
      screen.getAllByRole("button", { name: "收藏提示词" })[0],
    );
    await waitFor(() => {
      expect(appApi.togglePromptFavorite).toHaveBeenCalledWith(prompt.id);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "删除 代码审查提示词" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "删除提示词",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "删除提示词" }),
    );
    await waitFor(() => {
      expect(appApi.deletePrompt).toHaveBeenCalledWith(prompt.id);
    });
  });
});
