import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CategoryNode } from "@/types/app";
import { CategoryAppearancePopover } from "./CategoryAppearancePopover";

const category: CategoryNode = {
  id: "docker",
  name: "Docker",
  parentId: null,
  sortOrder: 10,
  commandCount: 2,
  color: null,
  iconName: null,
  children: [],
};

function renderPopover(
  overrides: Partial<ComponentProps<typeof CategoryAppearancePopover>> = {},
) {
  const props = {
    open: true,
    anchor: { x: 20, y: 20 },
    category,
    onClose: vi.fn(),
    onApplyAppearance: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { props, ...render(<CategoryAppearancePopover {...props} />) };
}

describe("CategoryAppearancePopover", () => {
  it("applies an icon immediately and keeps the color", async () => {
    const { props } = renderPopover();
    fireEvent.click(
      screen.getByRole("button", { name: "选择图标 数据库" }),
    );
    await waitFor(() =>
      expect(props.onApplyAppearance).toHaveBeenCalledWith({
        color: null,
        iconName: "database",
      }),
    );
  });

  it("applies preset colors with the current icon and resets defaults", async () => {
    const { props } = renderPopover();
    fireEvent.click(
      screen.getByRole("button", { name: "选择图标 容器" }),
    );
    await waitFor(() =>
      expect(props.onApplyAppearance).toHaveBeenLastCalledWith({
        color: null,
        iconName: "container",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "薄荷绿 #EDF8F2" }));
    await waitFor(() =>
      expect(props.onApplyAppearance).toHaveBeenLastCalledWith({
        color: "#EDF8F2",
        iconName: "container",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "恢复默认颜色和图标" }),
    );
    await waitFor(() =>
      expect(props.onApplyAppearance).toHaveBeenLastCalledWith({
        color: null,
        iconName: null,
      }),
    );
  });

  it("filters the icon grid by name and keywords", () => {
    renderPopover();
    fireEvent.change(screen.getByLabelText("搜索图标"), {
      target: { value: "sql" },
    });
    expect(
      screen.getByRole("button", { name: "选择图标 数据库" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "选择图标 终端" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索图标"), {
      target: { value: "不存在的图标" },
    });
    expect(screen.getByText("没有匹配的图标")).toBeInTheDocument();
  });
});
