import type { Command } from "@/types/app";

type CommandLike = Pick<Command, "command" | "title">;
type AnnotationLike = Pick<Command, "command" | "title"> &
  Partial<Pick<Command, "description" | "aiAnnotation">>;

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/**
 * The database keeps the original `title` field for backwards compatibility.
 * In the command-first UI it is shown as the short annotation only when it adds
 * information beyond the command itself. Auto-generated titles (first line /
 * truncated first line) are suppressed to avoid duplicating the command.
 */
export function getCommandAnnotation(command: CommandLike): string | null {
  const title = command.title.trim();
  if (!title) {
    return null;
  }
  const titleKey = normalized(title);
  if (!titleKey) {
    return null;
  }
  const commandLines = command.command
    .split(/\r?\n/)
    .map(normalized)
    .filter(Boolean);
  if (commandLines.includes(titleKey)) {
    return null;
  }
  if (titleKey.endsWith("…")) {
    const stem = titleKey.slice(0, -1);
    if (
      stem.length >= 20 &&
      commandLines.some((line) => line.startsWith(stem))
    ) {
      return null;
    }
  }
  return title;
}

/** A handwritten annotation is a meaningful title or a non-empty description. */
export function hasManualAnnotation(command: AnnotationLike): boolean {
  return (
    (command.description ?? "").trim().length > 0 ||
    getCommandAnnotation(command) !== null
  );
}

/**
 * Prefer the user's handwritten short annotation; otherwise fall back to the
 * separated AI annotation. AI content never replaces or edits the title/command
 * without an explicit save choice.
 */
export function getDisplayAnnotation(command: AnnotationLike): string | null {
  return (
    getCommandAnnotation(command) ??
    command.aiAnnotation?.shortDescription.trim() ??
    null
  );}

export function hasAnyAnnotation(command: AnnotationLike): boolean {
  return hasManualAnnotation(command) || Boolean(command.aiAnnotation);
}

/** Short label for confirmations, toasts and accessible names. */
export function commandLabel(command: AnnotationLike, limit = 44): string {
  const annotation = getDisplayAnnotation(command);
  const source =
    annotation ??
    command.command
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ??
    command.command;
  const singleLine = source.replace(/\s+/g, " ").trim();
  return singleLine.length > limit
    ? `${singleLine.slice(0, limit)}…`
    : singleLine;
}

