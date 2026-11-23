import {
  getCommandAnnotation,
  hasManualAnnotation,
} from "@/features/command-display/commandDisplay";
import type { Command, GeneratedAiAnnotation } from "@/types/app";

const MAX_DETAILED_CHARS = 4_000;
const MAX_PRESERVED_MANUAL_CHARS = 1_000;
export const PRESERVED_MANUAL_MARKER =
  "\n\n---\n原手写注释（已保留）：\n";

/**
 * A command can have both a handwritten note and an AI annotation. When a
 * previous replace action copied the AI text into title/description, those
 * fields mirror the AI row; they must not be treated as a new handwritten note
 * on the next regeneration.
 */
/**
 * A previous replace action copies the AI text into title/description. Those
 * fields mirror the AI row and are not a new handwritten note.
 */
export function isAiMirroredAnnotation(command: Command): boolean {
  const ai = command.aiAnnotation;
  if (!ai) {
    return false;
  }
  return (
    command.title.trim() === ai.shortDescription.trim() &&
    command.description.trim() === ai.detailedDescription.trim()
  );
}

export function hasSeparateManualAnnotation(command: Command): boolean {
  if (!hasManualAnnotation(command)) {
    return false;
  }
  return !isAiMirroredAnnotation(command);
}

export function manualAnnotationSnapshot(command: Command): string | null {
  if (!hasSeparateManualAnnotation(command)) {
    return null;
  }
  const ai = command.aiAnnotation;
  const title = getCommandAnnotation(command)?.trim() ?? "";
  const description = command.description.trim();
  const parts: string[] = [];
  // A partially replaced command can have one field copied from the AI row and
  // the other still handwritten. Preserve only the handwritten fields.
  if (title && title !== ai?.shortDescription.trim()) {
    parts.push(`手写简短注释：${title}`);
  }
  if (description && description !== ai?.detailedDescription.trim()) {
    parts.push(`手写详细注释：${description}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function truncateText(value: string, limit: number): string {
  const chars = Array.from(value);
  if (chars.length <= limit) {
    return value;
  }
  if (limit <= 0) {
    return "";
  }
  return `${chars.slice(0, limit - 1).join("")}…`;
}

/**
 * Replace mode makes the AI result the primary title/description. Keep the old
 * handwritten note inside the new detailed explanation so it is not lost.
 */
export function buildPreservedAnnotation(
  command: Command,
  generated: GeneratedAiAnnotation,
): GeneratedAiAnnotation {
  const manual = manualAnnotationSnapshot(command);
  if (!manual) {
    return generated;
  }
  const oldNote = truncateText(manual, MAX_PRESERVED_MANUAL_CHARS);
  const budget = Math.max(
    0,
    MAX_DETAILED_CHARS - PRESERVED_MANUAL_MARKER.length - oldNote.length,
  );
  const detailed = truncateText(generated.detailedDescription, budget);
  return {
    ...generated,
    detailedDescription: `${detailed}${PRESERVED_MANUAL_MARKER}${oldNote}`,
  };
}
