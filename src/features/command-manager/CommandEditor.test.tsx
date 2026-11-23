import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandEditor } from "@/features/command-manager/CommandEditor";
import type { Command } from "@/types/app";

function renderEditor() {
  return render(
    <CommandEditor
      open
      command={null}
      categories={[]}
      defaultCategoryId={null}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

describe("CommandEditor", () => {
  it("puts the command first, focuses it, and labels comments explicitly", () => {
    renderEditor();
    const command = screen.getByLabelText("命令原文");
    const annotation = screen.getByLabelText("简短注释（可选）");
    const description = screen.getByLabelText("详细说明（可选）");

    expect(command).toHaveFocus();
    expect(
      command.compareDocumentPosition(annotation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      annotation.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses the default directory option and renamed labels", () => {
    renderEditor();
    const directory = screen.getByLabelText("目录");
    expect(directory).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "默认" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/未指定目录时归入系统“默认”目录/)).toBeInTheDocument();
  });

  it("does not prefill an auto-generated title as a short annotation", () => {
    const command: Command = {
      id: "command-1",
      title: "git status",
      command: "git status",
      description: "",
      shell: "bash",
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      categoryIconName: null,
      backgroundColor: null,
      useCategoryColor: false,
      tags: [],
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
    render(
      <CommandEditor
        open
        command={command}
        categories={[]}
        defaultCategoryId={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("命令原文")).toHaveValue("git status");
    expect(screen.getByLabelText("简短注释（可选）")).toHaveValue("");
  });
});
