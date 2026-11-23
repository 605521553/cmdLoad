import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "@/features/prompts/PromptEditor";
import type { CategoryNode, Prompt } from "@/types/app";

const categories: CategoryNode[] = [
  {
    id: "cat-code",
    name: "编程开发",
    parentId: null,
    sortOrder: 10,
    commandCount: 0,
    color: null,
    iconName: null,
    children: [
      {
        id: "cat-review",
        name: "代码审查",
        parentId: "cat-code",
        sortOrder: 10,
        commandCount: 1,
        color: null,
        iconName: null,
        children: [],
      },
    ],
  },
];

const prompt: Prompt = {
  id: "p1",
  title: "代码审查提示词",
  content: "请你作为资深工程师：\n\n```ts\nconst x = 1;\n```\n\n- 逻辑\n- 安全  ",
  categoryId: "cat-review",
  categoryName: "代码审查",
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: "#FCEEF0",
  tags: [{ id: "t1", name: "审查", color: null }],
  isFavorite: true,
  sortOrder: 10,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("PromptEditor", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("saves exact multiline content with optional metadata", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PromptEditor
        open
        prompt={null}
        categories={categories}
        defaultCategoryId="cat-review"
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const content = "第一行\n\n    缩进的代码\n```md\n# 标题\n```\n保留末尾空格  ";
    fireEvent.change(screen.getByLabelText("标题（可选）"), {
      target: { value: "代码审查" },
    });
    fireEvent.change(screen.getByLabelText("提示词内容"), {
      target: { value: content },
    });
    fireEvent.change(screen.getByLabelText("标签"), {
      target: { value: "审查, 中文" },
    });
    fireEvent.click(screen.getByLabelText("收藏这条提示词"));
    fireEvent.click(screen.getByRole("button", { name: "保存提示词" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        title: "代码审查",
        content,
        categoryId: "cat-review",
        tags: ["审查", "中文"],
        backgroundColor: null,
        favorite: true,
      });
    });
  });

  it("prefills an existing prompt and saves with Ctrl+S", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PromptEditor
        open
        prompt={prompt}
        categories={categories}
        defaultCategoryId={null}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText("标题（可选）")).toHaveValue(
      "代码审查提示词",
    );
    expect(screen.getByLabelText("提示词内容")).toHaveValue(prompt.content);
    expect(screen.getByLabelText("收藏这条提示词")).toBeChecked();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "代码审查提示词",
          content: prompt.content,
          categoryId: "cat-review",
          tags: ["审查"],
          backgroundColor: "#FCEEF0",
          favorite: true,
        }),
      );
    });
  });

  it("requires prompt content and never calls save for blank text", async () => {
    const onSave = vi.fn();
    render(
      <PromptEditor
        open
        prompt={null}
        categories={categories}
        defaultCategoryId={null}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "保存提示词" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请填写提示词内容",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("confirms before discarding unsaved edits", () => {
    const onClose = vi.fn();
    render(
      <PromptEditor
        open
        prompt={prompt}
        categories={categories}
        defaultCategoryId={null}
        onClose={onClose}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("提示词内容"), {
      target: { value: "新的修改" },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("放弃未保存的修改？")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes immediately with Escape when nothing changed", () => {
    const onClose = vi.fn();
    render(
      <PromptEditor
        open
        prompt={prompt}
        categories={categories}
        defaultCategoryId={null}
        onClose={onClose}
        onSave={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
