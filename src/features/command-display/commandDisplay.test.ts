import { describe, expect, it } from "vitest";
import {
  commandLabel,
  getDisplayAnnotation,
  hasAnyAnnotation,
  hasManualAnnotation,
} from "./commandDisplay";
import type { AiAnnotation } from "@/types/app";

const aiAnnotation: AiAnnotation = {
  id: "ai-1",
  commandId: "c1",
  shortDescription: "查看所有 Docker 容器",
  detailedDescription: "列出 Docker 环境中的全部容器。",
  parameters: [{ name: "-a", description: "显示所有容器" }],
  requirements: ["已安装 Docker"],
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

const base = {
  command: "docker ps -a",
  title: "docker ps -a",
  description: "",
  aiAnnotation,
};

describe("command display AI annotations", () => {
  it("falls back to the separated AI short annotation", () => {
    expect(hasManualAnnotation(base)).toBe(false);
    expect(getDisplayAnnotation(base)).toBe("查看所有 Docker 容器");
    expect(commandLabel(base)).toBe("查看所有 Docker 容器");
    expect(hasAnyAnnotation(base)).toBe(true);
  });

  it("keeps a handwritten title visible ahead of AI content", () => {
    const command = { ...base, title: "查看容器" };
    expect(hasManualAnnotation(command)).toBe(true);
    expect(getDisplayAnnotation(command)).toBe("查看容器");
  });

  it("counts a handwritten description as an annotation", () => {
    const command = {
      ...base,
      aiAnnotation: null,
      description: "手写说明",
    };
    expect(hasManualAnnotation(command)).toBe(true);
    expect(hasAnyAnnotation(command)).toBe(true);
    expect(getDisplayAnnotation(command)).toBeNull();
  });

  it("does not treat an auto-generated title as handwritten", () => {
    expect(
      hasManualAnnotation({
        command: "git status",
        title: "git status",
        description: "",
        aiAnnotation: null,
      }),
    ).toBe(false);
  });
});
