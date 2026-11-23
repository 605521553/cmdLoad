import { hasAnyAnnotation } from "@/features/command-display/commandDisplay";
import type { Command } from "@/types/app";

export interface BatchPartition {
  eligible: Command[];
  skippedAnnotated: number;
  skippedPending: number;
}

/**
 * Batch annotation is intentionally limited to commands with no handwritten note
 * and no existing AI result. This keeps repeated runs from spending API quota.
 */
export function partitionBatchCandidates(commands: Command[]): BatchPartition {
  const eligible: Command[] = [];
  let skippedAnnotated = 0;
  let skippedPending = 0;
  for (const command of commands) {
    if (hasAnyAnnotation(command)) {
      skippedAnnotated += 1;
      continue;
    }
    if (
      command.aiAnnotationStatus === "pending" ||
      command.aiAnnotationStatus === "ready"
    ) {
      skippedPending += 1;
      continue;
    }
    eligible.push(command);
  }
  return { eligible, skippedAnnotated, skippedPending };
}
