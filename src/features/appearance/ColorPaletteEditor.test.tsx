import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ColorPaletteEditor } from "./ColorPaletteEditor";

function renderEditor(
  overrides: Partial<ComponentProps<typeof ColorPaletteEditor>> = {},
) {
  const props = {
    value: null,
    customColors: ["#FCEEF0", "#EDF3FC"],
    onPick: vi.fn(),
    onCustomApply: vi.fn(),
    onSaveToPalette: vi.fn(),
    onRemoveFromPalette: vi.fn(),
    onReorderPalette: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ColorPaletteEditor {...props} />) };
}

describe("ColorPaletteEditor", () => {
  it("applies presets, personal colors and resets", async () => {
    const { props } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "薄荷绿 #EDF8F2" }));
    await waitFor(() =>
      expect(props.onPick).toHaveBeenCalledWith("#EDF8F2"),
    );

    fireEvent.click(screen.getByRole("button", { name: "我的颜色 #EDF3FC" }));
    await waitFor(() =>
      expect(props.onPick).toHaveBeenCalledWith("#EDF3FC"),
    );

    fireEvent.click(screen.getByRole("button", { name: "默认颜色" }));
    await waitFor(() => expect(props.onPick).toHaveBeenCalledWith(null));
  }, 10_000);

  it("validates the custom hex input and supports save plus apply", async () => {
    const { props } = renderEditor();
    fireEvent.click(
      screen.getByRole("button", { name: /自定义颜色…/ }),
    );
    const input = screen.getByLabelText("HEX 颜色值");
    expect(input).toHaveValue("#EDF3FC");

    fireEvent.change(input, { target: { value: "not-a-color" } });
    expect(screen.getByText(/颜色需为 #RRGGBB/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "应用" }),
    ).toBeDisabled();

    fireEvent.change(input, { target: { value: "#fff8e8" } });
    fireEvent.click(
      screen.getByRole("button", { name: "保存到我的颜色" }),
    );
    await waitFor(() =>
      expect(props.onSaveToPalette).toHaveBeenCalledWith("#FFF8E8"),
    );

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() =>
      expect(props.onCustomApply).toHaveBeenCalledWith("#FFF8E8"),
    );
  });

  it("disables saving a duplicate and can delete a personal color", async () => {
    const { props } = renderEditor();
    fireEvent.click(
      screen.getByRole("button", { name: /自定义颜色…/ }),
    );
    expect(screen.getByLabelText("HEX 颜色值")).toHaveValue("#EDF3FC");
    expect(
      screen.getByRole("button", { name: "保存到我的颜色" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "从我的颜色中删除 #FCEEF0",
      }),
    );
    await waitFor(() =>
      expect(props.onRemoveFromPalette).toHaveBeenCalledWith("#FCEEF0"),
    );
  });

  it("reorders personal colors with Alt + arrow keys", async () => {
    const { props } = renderEditor();
    const swatch = screen.getByRole("button", {
      name: "我的颜色 #FCEEF0",
    });
    swatch.focus();
    fireEvent.keyDown(swatch, { key: "ArrowRight", altKey: true });
    await waitFor(() =>
      expect(props.onReorderPalette).toHaveBeenCalledWith(0, 1),
    );
  });
});
