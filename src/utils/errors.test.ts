import { describe, expect, it } from "vitest";
import {
  AppCommandError,
  getUserErrorMessage,
  toAppCommandError,
} from "@/utils/errors";

describe("command error normalization", () => {
  it("keeps backend error codes and messages", () => {
    const error = toAppCommandError({
      code: "HOTKEY_CONFLICT",
      message: "快捷键冲突",
    });
    expect(error).toBeInstanceOf(AppCommandError);
    expect(error.code).toBe("HOTKEY_CONFLICT");
    expect(error.message).toBe("快捷键冲突");
  });

  it("handles string rejections from Tauri", () => {
    expect(getUserErrorMessage("窗口操作失败")).toBe("窗口操作失败");
  });

  it("never exposes unhelpful unknown values", () => {
    expect(getUserErrorMessage({ unexpected: true })).toBe(
      "操作未完成，请稍后重试。",
    );
    expect(getUserErrorMessage(undefined)).toBe("操作未完成，请稍后重试。");
  });
});
