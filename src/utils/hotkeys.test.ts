import { describe, expect, it } from "vitest";
import {
  captureShortcut,
  formatShortcut,
  isSameShortcut,
  keyFromKeyboardCode,
  parseShortcut,
} from "@/utils/hotkeys";

const baseEvent = {
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

describe("captureShortcut", () => {
  it("captures the documented default shortcut", () => {
    const result = captureShortcut({
      ...baseEvent,
      code: "KeyV",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(result.status).toBe("ready");
    expect(result.shortcut).toBe("Ctrl+Shift+V");
  });

  it("supports digits and function keys", () => {
    expect(
      captureShortcut({ ...baseEvent, code: "Digit4", ctrlKey: true }).shortcut,
    ).toBe("Ctrl+4");
    expect(
      captureShortcut({ ...baseEvent, code: "F8", altKey: true }).shortcut,
    ).toBe("Alt+F8");
  });

  it("treats a modifier-only press as incomplete rather than invalid", () => {
    const result = captureShortcut({
      ...baseEvent,
      code: "ControlLeft",
      ctrlKey: true,
    });
    expect(result.status).toBe("modifier-only");
  });

  it("requires a Ctrl, Alt or Win anchor", () => {
    const shiftOnly = captureShortcut({
      ...baseEvent,
      code: "KeyV",
      shiftKey: true,
    });
    expect(shiftOnly.status).toBe("unsupported");
    expect(shiftOnly.message).toContain("Ctrl");

    const win = captureShortcut({
      ...baseEvent,
      code: "KeyV",
      metaKey: true,
    });
    expect(win.status).toBe("ready");
    expect(win.shortcut).toBe("Super+V");
  });

  it("rejects unsupported keys without altering the draft", () => {
    const result = captureShortcut({
      ...baseEvent,
      code: "CapsLock",
      ctrlKey: true,
    });
    expect(result.status).toBe("unsupported");
    expect(result.shortcut).toBeUndefined();
  });
});

describe("shortcut display helpers", () => {
  it("splits modifiers and key for the UI", () => {
    expect(parseShortcut("Ctrl+Alt+Shift+F12")).toEqual({
      modifiers: ["Ctrl", "Alt", "Shift"],
      key: "F12",
    });
  });

  it("formats a structured shortcut", () => {
    expect(formatShortcut({ modifiers: ["Ctrl", "Shift"], key: "V" })).toBe(
      "Ctrl+Shift+V",
    );
  });

  it("compares shortcuts independent of modifier ordering", () => {
    expect(isSameShortcut("Ctrl+Shift+V", "Shift+Ctrl+v")).toBe(true);
    expect(isSameShortcut("Ctrl+Shift+V", "Ctrl+Alt+V")).toBe(false);
  });

  it("maps browser codes to stable hotkey labels", () => {
    expect(keyFromKeyboardCode("KeyQ")).toBe("Q");
    expect(keyFromKeyboardCode("Digit9")).toBe("9");
    expect(keyFromKeyboardCode("ArrowUp")).toBe("Up");
    expect(keyFromKeyboardCode("F24")).toBe("F24");
    expect(keyFromKeyboardCode("Numpad5")).toBeNull();
  });
});
