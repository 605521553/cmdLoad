import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandContextMenu } from "@/features/command-actions/CommandContextMenu";
import type { CategoryNode, Command } from "@/types/app";

const command: Command = {
  id: "command-1",
  title: "查看容器",
  command: "docker ps -a",
  description: "",
  shell: "unknown",
  categoryId: "docker",
  categoryName: "Docker",
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

const categories: CategoryNode[] = [
  {
    id: "linux",
    name: "Linux",
    parentId: null,
    sortOrder: 10,
    commandCount: 0,
    color: null,
    iconName: null,
    children: [
      {
        id: "docker",
        name: "Docker",
        parentId: "linux",
        sortOrder: 10,
        commandCount: 1,
        color: null,
        iconName: null,
        children: [],
      },
    ],
  },
];

function renderMenu(
  context: "quick" | "manager",
  overrides: Partial<ComponentProps<typeof CommandContextMenu>> = {},
) {
  const props = {
    context,
    command,
    position: { x: 20, y: 20 },
    categories,
    onClose: vi.fn(),
    onCopy: vi.fn(),
    onEdit: vi.fn(),
    onToggleFavorite: vi.fn(),
    onMove: vi.fn(),
    onView: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CommandContextMenu {...props} />) };
}

describe("CommandContextMenu", () => {
  it("shows manager-only move actions and no manager-view item", () => {
    const onMoveDown = vi.fn();
    renderMenu("manager", {
      canMoveUp: true,
      canMoveDown: true,
      onMoveUp: vi.fn(),
      onMoveDown,
    });
    expect(
      screen.queryByRole("menuitem", {
        name: "在完整管理界面中查看",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "下移" })).toBeEnabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "下移" }));
    expect(onMoveDown).toHaveBeenCalledWith(command);
  });

  it("disables manager move actions and shows the sort hint", () => {
    renderMenu("manager", {
      canMoveUp: false,
      canMoveDown: false,
      sortHint: "仅自定义排序可上移、下移",
    });
    expect(screen.getByRole("menuitem", { name: "上移" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "下移" })).toBeDisabled();
    expect(screen.getByText("仅自定义排序可上移、下移")).toBeInTheDocument();
  });

  it("keeps the manager-view item in the quick context", () => {
    const { props } = renderMenu("quick");
    expect(
      screen.getByRole("menuitem", {
        name: "在完整管理界面中查看",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "下移" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "在完整管理界面中查看",
      }),
    );
    expect(props.onView).toHaveBeenCalledWith(command);
  });

  it("offers multi-selection color actions and the follow-category toggle", () => {
    const onSetColor = vi.fn();
    const onToggleCategoryColor = vi.fn();
    const { props } = renderMenu("manager", {
      selectionCount: 3,
      allFollowCategoryColor: true,
      onSetColor,
      onToggleCategoryColor,
    });

    fireEvent.click(
      screen.getByRole("menuitem", { name: "设置颜色（3 条）" }),
    );
    expect(props.onClose).toHaveBeenCalled();
    expect(onSetColor).toHaveBeenCalledWith(command);

    fireEvent.click(
      screen.getByRole("menuitem", { name: "取消跟随目录颜色" }),
    );
    expect(onToggleCategoryColor).toHaveBeenCalledWith(command);
  });

  it("shows the follow-category action unchecked when the command has its own color", () => {
    renderMenu("quick", {
      onSetColor: vi.fn(),
      onToggleCategoryColor: vi.fn(),
    });
    expect(
      screen.getByRole("menuitem", { name: "设置颜色" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "使用所在目录颜色" }),
    ).toBeInTheDocument();
  });

  it("creates and moves to a new root category from the category panel", async () => {
    const onCreateCategory = vi.fn().mockResolvedValue("new-id");
    const onMove = vi.fn();
    renderMenu("quick", { onCreateCategory, onMove });

    fireEvent.click(screen.getByRole("menuitem", { name: "移动到目录" }));
    fireEvent.click(
      screen.getByRole("button", { name: "新建一级目录" }),
    );
    const input = screen.getByLabelText("新目录名称");
    fireEvent.change(input, { target: { value: "  新目录  " } });
    fireEvent.click(screen.getByRole("button", { name: "创建并移动" }));

    await waitFor(() => {
      expect(onCreateCategory).toHaveBeenCalledWith(null, "新目录");
      expect(onMove).toHaveBeenCalledWith(command, "new-id", "新目录");
    });
  });

  it("runs the one-click AI action and closes the menu", () => {
    const onSelect = vi.fn();
    const { props } = renderMenu("quick", {
      aiAction: { label: "AI 生成注释", onSelect },
    });

    const item = screen.getByRole("menuitem", { name: "AI 生成注释" });
    expect(item).toBeEnabled();
    fireEvent.click(item);
    expect(props.onClose).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("disables the AI action while generation is busy", () => {
    renderMenu("manager", {
      aiAction: {
        label: "AI 生成中…",
        busy: true,
        disabled: true,
        onSelect: vi.fn(),
      },
    });
    expect(
      screen.getByRole("menuitem", { name: "AI 生成中…" }),
    ).toBeDisabled();
  });

  it("creates a child category under the selected parent", async () => {
    const onCreateCategory = vi.fn().mockResolvedValue("child-id");
    const onMove = vi.fn();
    renderMenu("quick", { onCreateCategory, onMove });

    fireEvent.click(screen.getByRole("menuitem", { name: "移动到目录" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "在 Linux 下新建子目录",
      }),
    );
    const input = screen.getByLabelText("新目录名称");
    fireEvent.change(input, { target: { value: "Docker 子目录" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并移动" }));

    await waitFor(() => {
      expect(onCreateCategory).toHaveBeenCalledWith(
        "linux",
        "Docker 子目录",
      );
      expect(onMove).toHaveBeenCalledWith(
        command,
        "child-id",
        "Docker 子目录",
      );
    });
  });
});
