import type { CommandErrorPayload } from "@/types/app";

export class AppCommandError extends Error {
  readonly code: string;

  constructor(message: string, code = "UNKNOWN_ERROR") {
    super(message);
    this.name = "AppCommandError";
    this.code = code;
  }
}

function isCommandErrorPayload(value: unknown): value is CommandErrorPayload {
  return typeof value === "object" && value !== null && "message" in value;
}

/**
 * Tauri serializes command errors as plain objects. Keep the backend's
 * user-facing message intact and never stringify opaque error values into the
 * UI, which could expose implementation details.
 */
export function toAppCommandError(error: unknown): AppCommandError {
  if (error instanceof AppCommandError) {
    return error;
  }

  if (typeof error === "string") {
    return new AppCommandError(error);
  }

  if (isCommandErrorPayload(error) && typeof error.message === "string") {
    return new AppCommandError(
      error.message,
      typeof error.code === "string" ? error.code : "UNKNOWN_ERROR",
    );
  }

  return new AppCommandError("操作未完成，请稍后重试。");
}

export function getUserErrorMessage(error: unknown): string {
  return toAppCommandError(error).message;
}
