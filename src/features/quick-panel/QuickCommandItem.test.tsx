import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickCommandItem } from "@/features/quick-panel/QuickCommandItem";
import type { Command } from "@/types/app";

const command: Command = {
  id: "command-1",
  title: "连接服务器",
  command: "ssh yons@192.168.11.34",
  description: "",
  shell: "unknown",
  categoryId: "ssh",
  categoryName: "SSH",
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

describe("QuickCommandItem", () => {
  it("shows the direct category with a full path tooltip", () => {
    render(
      <QuickCommandItem
        command={command}
        categoryPath="Linux / SSH"
        selected={false}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    const label = screen.getByLabelText("所属目录：Linux / SSH");
    expect(label).toHaveTextContent("SSH");
    expect(label).toHaveAttribute("title", "Linux / SSH");
  });

  it("does not render a category label for unclassified commands", () => {
    render(
      <QuickCommandItem
        command={{ ...command, categoryId: null, categoryName: null }}
        selected={false}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    expect(
      screen.queryByLabelText(/所属目录/),
    ).not.toBeInTheDocument();
  });

  it("applies the own background color and renders the category icon", () => {
    render(
      <QuickCommandItem
        command={{
          ...command,
          backgroundColor: "#FCEEF0",
          categoryColor: "#EDF8F2",
          categoryIconName: "server",
        }}
        selected={false}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    const option = screen.getByRole("option");
    expect(option).toHaveClass("command-tint");
    expect(option.style.getPropertyValue("--command-tint-light")).toBe(
      "#FCEEF0",
    );
    const icon = option.querySelector(
      '[data-category-icon="server"]',
    );
    expect(icon).toBeInTheDocument();
  });

  it("follows the category color instead of its own stored color", () => {
    render(
      <QuickCommandItem
        command={{
          ...command,
          backgroundColor: "#FCEEF0",
          categoryColor: "#EDF8F2",
          useCategoryColor: true,
        }}
        selected={false}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole("option")
        .style.getPropertyValue("--command-tint-light"),
    ).toBe("#EDF8F2");
  });

  it("hides the Shell badge for unknown/empty shells and shows explicit shells", () => {
    const { rerender } = render(
      <QuickCommandItem
        command={command}
        selected={false}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    expect(screen.queryByText("未确定")).not.toBeInTheDocument();
    expect(screen.queryByText("未知")).not.toBeInTheDocument();
    expect(document.querySelector("[data-shell-badge]")).toBeNull();

    rerender(
      <QuickCommandItem
        command={{ ...command, shell: "bash" }}
        selected={false}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(document.querySelector('[data-shell-badge="bash"]')).not.toBeNull();
  });

  it("does not tint a command without a color", () => {
    render(
      <QuickCommandItem
        command={command}
        selected={false}
        onSelect={vi.fn()}
        onCopy={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    expect(screen.getByRole("option")).not.toHaveClass("command-tint");
  });

  it("still copies on click and opens the context menu on right click", () => {
    const onCopy = vi.fn();
    const onContextMenu = vi.fn();
    render(
      <QuickCommandItem
        command={command}
        selected={false}
        onSelect={vi.fn()}
        onCopy={onCopy}
        onContextMenu={onContextMenu}
      />,
    );
    fireEvent.click(screen.getByRole("option"));
    expect(onCopy).toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole("option"));
    expect(onContextMenu).toHaveBeenCalled();
  });
});
