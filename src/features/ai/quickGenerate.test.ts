import { describe, expect, it } from "vitest";
import type {
  AiAnnotation,
  Command,
  GeneratedAiAnnotation,
} from "@/types/app";
import {
  PRESERVED_MANUAL_MARKER,
  buildPreservedAnnotation,
  hasSeparateManualAnnotation,
  isAiMirroredAnnotation,
  manualAnnotationSnapshot,
} from "./quickGenerate";

function command(overrides: Partial<Command> = {}): Command {
  return {
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
    sourceType: "manual",
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
  };
}

function generated(detailed = "列出所有容器。"): GeneratedAiAnnotation {
  return {
    commandId: "c1",
    commandContentHash: "hash",
    provider: "deepseek",
    model: "deepseek-chat",
    promptVersion: "annotation-v1",
    generatedAt: 2,
    shortDescription: "查看全部 Docker 容器",
    detailedDescription: detailed,
    parameters: [],
    requirements: [],
    warnings: [],
    suggestedShell: "bash",
    riskLevel: "low",
  };
}

function annotation(short: string, detailed: string): AiAnnotation {
  return {
    ...generated(detailed),
    id: "ai-1",
    commandId: "c1",
    shortDescription: short,
    commandContentHash: "hash",
    updatedAt: 2,
    isStale: false,
  };
}

describe("quick AI annotation helpers", () => {
  it("distinguishes a handwritten note from AI text copied into title/description", () => {
    const manual = command({ title: "查看容器", description: "手写说明" });
    expect(hasSeparateManualAnnotation(manual)).toBe(true);
    expect(manualAnnotationSnapshot(manual)).toContain("查看容器");
    expect(manualAnnotationSnapshot(manual)).toContain("手写说明");

    const aiMirror = command({
      title: "查看全部 Docker 容器",
      description: "列出所有容器。",
      aiAnnotationStatus: "ready",
      aiAnnotation: annotation("查看全部 Docker 容器", "列出所有容器。"),
    });
    expect(hasSeparateManualAnnotation(aiMirror)).toBe(false);
    expect(isAiMirroredAnnotation(aiMirror)).toBe(true);
    expect(manualAnnotationSnapshot(aiMirror)).toBeNull();

    const aiPlusManual = command({
      title: "查看全部 Docker 容器",
      description: "用户后来补的手写说明",
      aiAnnotationStatus: "ready",
      aiAnnotation: annotation("查看全部 Docker 容器", "列出所有容器。"),
    });
    expect(hasSeparateManualAnnotation(aiPlusManual)).toBe(true);
    expect(isAiMirroredAnnotation(aiPlusManual)).toBe(false);

    const partial = command({
      title: "查看全部 Docker 容器",
      description: "用户后来补的手写说明",
      aiAnnotationStatus: "ready",
      aiAnnotation: annotation("查看全部 Docker 容器", "列出所有容器。"),
    });
    const partialSnapshot = manualAnnotationSnapshot(partial);
    expect(partialSnapshot).toContain("用户后来补的手写说明");
    expect(partialSnapshot).not.toContain("查看全部 Docker 容器");
  });

  it("preserves the old handwritten note inside the replacement detailed text", () => {
    const manual = command({
      title: "查看容器",
      description: "只列出正在运行的容器。",
    });
    const merged = buildPreservedAnnotation(manual, generated());
    expect(merged.detailedDescription).toContain("列出所有容器。");
    expect(merged.detailedDescription).toContain(PRESERVED_MANUAL_MARKER);
    expect(merged.detailedDescription).toContain("查看容器");
    expect(merged.detailedDescription).toContain("只列出正在运行的容器。");
    expect(merged.detailedDescription.length).toBeLessThanOrEqual(4_000);
  });

  it("caps a very long handwritten note so the payload stays valid", () => {
    const manual = command({
      title: "查看容器",
      description: "说明".repeat(2_000),
    });
    const merged = buildPreservedAnnotation(manual, generated("详细解释".repeat(1_000)));
    expect(merged.detailedDescription.length).toBeLessThanOrEqual(4_000);
    expect(merged.detailedDescription).toContain(PRESERVED_MANUAL_MARKER);
  });
});
