import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/appStore";
import type { AppSnapshot, Command } from "@/types/app";
import { AiQuickConfirmDialog } from "./AiQuickConfirmDialog";

const snapshot: AppSnapshot = {
  version: "0.2.0",
  settings: {
    shortcut: "Ctrl+Shift+V",
    launchAtStartup: false,
    autoHideQuickPanel: true,
    theme: "system",
    sidebarWidth: 172,
    clipboardMonitoringEnabled: true,
    clipboardHistoryLimit: 100,
    clipboardHistoryRetentionDays: 7,
    hideQuickPanelAfterCopy: false,
    customColors: [],
    aiProvider: "deepseek",
    aiBaseUrl: "https://api.deepseek.com/v1",
    aiModel: "deepseek-chat",
    aiTimeoutSeconds: 30,
    aiTemperature: null,
    aiAutoAnnotation: false,
  },
  uiMode: "quick",
  shortcut: { registered: true, error: null },
  autostartEnabled: false,
  aiApiKeyConfigured: true,
  settingsPath: "settings.json",
  settingsWarning: null,
  databasePath: "commands.db",
  databaseWarning: null,
};

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
  aiAnnotationStatus: "ready",
  contentHash: "hash",
  aiAnnotation: null,
  isFavorite: false,
  sortOrder: 10,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("AiQuickConfirmDialog", () => {
  beforeEach(() => {
    useAppStore.setState({ snapshot });
  });

  it("combines the sensitive-send and overwrite warnings", () => {
    const onConfirm = vi.fn();
    render(
      <AiQuickConfirmDialog
        open
        command={command}
        sensitive
        hasManual
        hasAi
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("确认发送并生成 AI 注释？"),
    ).toBeInTheDocument();
    expect(screen.getByText(/完整命令原文/)).toBeInTheDocument();
    expect(screen.getByText(/原手写内容保留/)).toBeInTheDocument();
    expect(screen.getByText(/覆盖原 AI 注释/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认发送并生成" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("labels a manual-only overwrite as replace and preserve", () => {
    render(
      <AiQuickConfirmDialog
        open
        command={command}
        sensitive={false}
        hasManual
        hasAi={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("确认覆盖现有注释？")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "覆盖并生成" }),
    ).toBeInTheDocument();
  });
});
