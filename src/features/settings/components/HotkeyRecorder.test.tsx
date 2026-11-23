import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HotkeyRecorder } from "@/features/settings/components/HotkeyRecorder";

async function startRecording() {
  fireEvent.click(screen.getByTitle("点击后输入新的快捷键组合"));
}

async function pressShortcut(
  code: string,
  modifiers: Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  }>,
) {
  fireEvent.keyDown(window, {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  });
}

describe("HotkeyRecorder", () => {
  it("captures and applies a new shortcut", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <HotkeyRecorder
        currentShortcut="Ctrl+Shift+V"
        registered
        onSave={onSave}
      />,
    );

    await startRecording();
    await pressShortcut("KeyP", { ctrlKey: true, altKey: true });
    fireEvent.click(screen.getByRole("button", { name: /应用/ }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("Ctrl+Alt+P");
    });
  });

  it("cancels recording with Escape and restores the existing shortcut", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <HotkeyRecorder
        currentShortcut="Ctrl+Shift+V"
        registered
        onSave={onSave}
      />,
    );

    await startRecording();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });

    expect(
      screen.getByTitle("点击后输入新的快捷键组合"),
    ).toHaveTextContent("Ctrl");
    expect(screen.getByRole("button", { name: /应用/ })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows backend conflict errors inline", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new Error("该快捷键已被其他程序占用"));
    render(
      <HotkeyRecorder
        currentShortcut="Ctrl+Shift+V"
        registered
        onSave={onSave}
      />,
    );

    await startRecording();
    await pressShortcut("KeyJ", { ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: /应用/ }));

    expect(
      await screen.findByText("该快捷键已被其他程序占用"),
    ).toBeInTheDocument();
  });

  it("allows retrying registration when the saved shortcut is unavailable", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <HotkeyRecorder
        currentShortcut="Ctrl+Shift+V"
        registered={false}
        onSave={onSave}
      />,
    );

    expect(
      screen.getByText(/当前组合没有成功注册/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /应用/ })).toBeEnabled();
  });
});
