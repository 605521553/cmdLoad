import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiAnnotationPreviewDialog } from "./AiAnnotationPreviewDialog";
import type { Command, GeneratedAiAnnotation } from "@/types/app";

const command: Command = {
  id: "c1",
  title: "查看容器",
  command: "docker ps -a",
  description: "手写说明",
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
};

const generated: GeneratedAiAnnotation = {
  commandId: "c1",
  commandContentHash: "hash",
  provider: "deepseek",
  model: "deepseek-chat",
  promptVersion: "annotation-v1",
  generatedAt: 100,
  shortDescription: "查看所有 Docker 容器",
  detailedDescription: "列出 Docker 环境中的全部容器。",
  parameters: [{ name: "-a", description: "显示所有容器" }],
  requirements: ["已安装 Docker"],
  warnings: [],
  suggestedShell: "bash",
  riskLevel: "low",
};

describe("AiAnnotationPreviewDialog", () => {
  it("keeps the original command read-only and applies edited AI content", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <AiAnnotationPreviewDialog
        command={command}
        generated={generated}
        hasManualAnnotation
        onClose={vi.fn()}
        onApply={onApply}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByText("docker ps -a")).toBeInTheDocument();
    expect(
      screen.getByText(/现有手写注释：「查看容器」/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("AI 简短注释"), {
      target: { value: "查看全部 Docker 容器" },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: /追加 AI 内容到现有注释/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "应用并保存" }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({
          commandId: "c1",
          commandContentHash: "hash",
          shortDescription: "查看全部 Docker 容器",
        }),
        "append",
      );
    });
  });

  it("regenerates into the preview without saving", async () => {
    const onApply = vi.fn();
    const onRegenerate = vi.fn().mockResolvedValue({
      ...generated,
      shortDescription: "列出 Docker 容器",
      detailedDescription: "列出全部容器，包括已停止的容器。",
    });
    render(
      <AiAnnotationPreviewDialog
        command={command}
        generated={generated}
        hasManualAnnotation={false}
        onClose={vi.fn()}
        onApply={onApply}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    await waitFor(() => {
      expect(screen.getByLabelText("AI 简短注释")).toHaveValue(
        "列出 Docker 容器",
      );
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not save when cancelled", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <AiAnnotationPreviewDialog
        command={command}
        generated={generated}
        hasManualAnnotation={false}
        onClose={onClose}
        onApply={onApply}
        onRegenerate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
