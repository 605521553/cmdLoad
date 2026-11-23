import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandDetailPanel } from "@/features/command-manager/CommandDetailPanel";
import type { Command } from "@/types/app";

const command: Command = {
  id: "command-1",
  title: "查看容器",
  command: "docker ps -a",
  description: "列出所有容器",
  shell: "bash",
  categoryId: "docker",
  categoryName: "Docker",
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
  useCount: 2,
  lastUsedAt: Date.now() - 60_000,
  createdAt: 1,
  updatedAt: Date.now() - 120_000,
};

describe("CommandDetailPanel", () => {
  it("renders command, category path, metadata and tags", () => {
    render(
      <CommandDetailPanel
        command={command}
        categoryPath="Linux / Docker"
        width={300}
        onCopy={vi.fn()}
        onEdit={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDelete={vi.fn()}
        onTagClick={vi.fn()}
      />,
    );
    expect(screen.getByText("查看容器")).toBeInTheDocument();
    expect(screen.getByText("docker ps -a")).toBeInTheDocument();
    expect(screen.getByText("Linux / Docker")).toBeInTheDocument();
    expect(screen.getByText("手动添加")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("docker")).toBeInTheDocument();
    expect(screen.getByText("简短注释")).toBeInTheDocument();
  });

  it("forwards copy, edit, favorite and delete actions", () => {
    const onCopy = vi.fn();
    const onEdit = vi.fn();
    const onToggleFavorite = vi.fn();
    const onDelete = vi.fn();
    render(
      <CommandDetailPanel
        command={command}
        width={300}
        onCopy={onCopy}
        onEdit={onEdit}
        onToggleFavorite={onToggleFavorite}
        onDelete={onDelete}
        onTagClick={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制命令" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "收藏命令" }));
    fireEvent.click(screen.getByRole("button", { name: "删除命令" }));
    expect(onCopy).toHaveBeenCalledWith(command);
    expect(onEdit).toHaveBeenCalledWith(command);
    expect(onToggleFavorite).toHaveBeenCalledWith(command);
    expect(onDelete).toHaveBeenCalledWith(command);
  });

  it("omits the Shell metadata row when the shell is unknown", () => {
    render(
      <CommandDetailPanel
        command={{ ...command, shell: "unknown" }}
        width={300}
        onCopy={vi.fn()}
        onEdit={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDelete={vi.fn()}
        onTagClick={vi.fn()}
      />,
    );
    expect(screen.queryByText("Shell")).not.toBeInTheDocument();
    expect(screen.queryByText("未确定")).not.toBeInTheDocument();
    expect(screen.getByText("手动添加")).toBeInTheDocument();
  });

  it("does not duplicate the AI detailed text when replace copied it into description", () => {
    const aiAnnotation = {
      id: "ai-1",
      commandId: command.id,
      shortDescription: "查看容器",
      detailedDescription: "列出所有容器",
      parameters: [],
      requirements: [],
      warnings: [],
      suggestedShell: "bash" as const,
      riskLevel: "low" as const,
      provider: "deepseek",
      model: "deepseek-chat",
      promptVersion: "annotation-v1",
      commandContentHash: "",
      generatedAt: 1,
      updatedAt: 1,
      isStale: false,
    };
    render(
      <CommandDetailPanel
        command={{
          ...command,
          description: "列出所有容器",
          aiAnnotationStatus: "ready",
          aiAnnotation,
        }}
        width={300}
        onCopy={vi.fn()}
        onEdit={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDelete={vi.fn()}
        onTagClick={vi.fn()}
      />,
    );
    expect(screen.queryByText("详细说明")).not.toBeInTheDocument();
    expect(screen.getAllByText("列出所有容器")).toHaveLength(1);
  });

  it("renders a quiet empty state without a command", () => {
    render(
      <CommandDetailPanel
        command={null}
        width={300}
        onCopy={vi.fn()}
        onEdit={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDelete={vi.fn()}
        onTagClick={vi.fn()}
      />,
    );
    expect(screen.getByText("选择一条命令")).toBeInTheDocument();
  });
});
