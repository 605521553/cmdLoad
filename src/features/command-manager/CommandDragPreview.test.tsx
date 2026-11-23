import { describe, expect, it } from "vitest";
import { createCommandDragPreview } from "@/features/command-manager/CommandDragPreview";
import type { Command } from "@/types/app";

const command: Command = {
  id: "command-1",
  title: "查看容器",
  command: "docker ps -a",
  description: "",
  shell: "unknown",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryIconName: null,
  backgroundColor: null,
  useCategoryColor: false,
  tags: [],
  sourceType: "manual",
  aiAnnotationStatus: "none",
  contentHash: "",
  aiAnnotation: null,
  isFavorite: false,
  sortOrder: 10,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("createCommandDragPreview", () => {
  it("renders a compact single-command preview", () => {
    const preview = createCommandDragPreview(command, 1);
    expect(preview.textContent).toContain("查看容器");
    expect(preview.textContent).toContain("docker ps -a");
    expect(preview.textContent).not.toContain("共 3 条命令");
    expect(preview.style.width).toBe("280px");
  });

  it("shows the selected count for a multi-command drag", () => {
    const preview = createCommandDragPreview(command, 3);
    expect(preview.textContent).toContain("共 3 条命令");
  });
});
