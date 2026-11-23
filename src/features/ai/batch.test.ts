import { describe, expect, it } from "vitest";
import { partitionBatchCandidates } from "./batch";
import type { AiAnnotation, Command } from "@/types/app";

const command = (overrides: Partial<Command>): Command => ({
  id: "c1",
  title: "docker ps -a",
  command: "docker ps -a",
  description: "",
  shell: "bash",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: null,
  useCategoryColor: false,
  tags: [],
  sourceType: "clipboard_current",
  aiAnnotationStatus: "none",
  contentHash: "hash",
  aiAnnotation: null,
  isFavorite: false,
  sortOrder: 10,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const annotation: AiAnnotation = {
  id: "ai-1",
  commandId: "c1",
  shortDescription: "查看容器",
  detailedDescription: "列出容器。",
  parameters: [],
  requirements: [],
  warnings: [],
  suggestedShell: "bash",
  riskLevel: "low",
  provider: "deepseek",
  model: "deepseek-chat",
  promptVersion: "annotation-v1",
  commandContentHash: "hash",
  generatedAt: 1,
  updatedAt: 1,
  isStale: false,
};

describe("partitionBatchCandidates", () => {
  it("includes only commands with no manual or AI annotation", () => {
    const result = partitionBatchCandidates([
      command({ id: "auto-title" }),
      command({ id: "manual-title", title: "查看容器" }),
      command({ id: "manual-description", description: "手写说明" }),
      command({ id: "ai", aiAnnotation: annotation, aiAnnotationStatus: "ready" }),
      command({ id: "pending", aiAnnotationStatus: "pending" }),
      command({ id: "failed", aiAnnotationStatus: "failed" }),
    ]);
    expect(result.eligible.map((item) => item.id)).toEqual([
      "auto-title",
      "failed",
    ]);
    expect(result.skippedAnnotated).toBe(3);
    expect(result.skippedPending).toBe(1);
  });

  it("does not treat a title equal to the command as handwritten", () => {
    const result = partitionBatchCandidates([
      command({ id: "same", title: "docker ps -a" }),
    ]);
    expect(result.eligible).toHaveLength(1);
  });
});
