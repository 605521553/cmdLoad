import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiAnnotationSection } from "./AiAnnotationSection";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  AiAnnotation,
  AppSnapshot,
  Command,
  GeneratedAiAnnotation,
} from "@/types/app";

vi.mock("@/services/appApi", () => ({
  appApi: {
    generateAiAnnotation: vi.fn(),
    cancelAiRequest: vi.fn(),
    saveAiAnnotation: vi.fn(),
  },
}));

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
  uiMode: "manager",
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
  title: "password=hunter2",
  command: "password=hunter2",
  description: "",
  shell: "cmd",
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
};

const generated: GeneratedAiAnnotation = {
  commandId: "c1",
  commandContentHash: "hash",
  provider: "deepseek",
  model: "deepseek-chat",
  promptVersion: "annotation-v1",
  generatedAt: 2,
  shortDescription: "检查本地密码配置",
  detailedDescription: "这条命令疑似包含凭据，仅用于测试。",
  parameters: [],
  requirements: [],
  warnings: ["不要在不安全的环境中执行"],
  suggestedShell: "cmd",
  riskLevel: "medium",
};

const annotation: AiAnnotation = {
  ...generated,
  id: "ai-1",
  updatedAt: 2,
  isStale: false,
};

describe("AiAnnotationSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ snapshot, notice: null });
  });

  it("confirms external sending before retrying a sensitive command", async () => {
    vi.mocked(appApi.generateAiAnnotation)
      .mockRejectedValueOnce({
        code: "AI_SENSITIVE_BLOCKED",
        message: "该命令疑似包含敏感信息。",
      })
      .mockResolvedValueOnce(generated);
    vi.mocked(appApi.saveAiAnnotation).mockResolvedValue({
      ...command,
      title: "检查本地密码配置",
      aiAnnotationStatus: "ready",
      aiAnnotation: annotation,
    });
    const onSaved = vi.fn();
    render(
      <AiAnnotationSection
        command={command}
        hasManualAnnotation={false}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 生成注释" }));
    expect(
      await screen.findByText("确认发送疑似敏感命令？"),
    ).toBeInTheDocument();
    expect(appApi.generateAiAnnotation).toHaveBeenCalledWith(
      "c1",
      expect.any(String),
      false,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
    expect(
      await screen.findByRole("dialog", { name: "AI 注释预览" }),
    ).toBeInTheDocument();
    expect(appApi.generateAiAnnotation).toHaveBeenLastCalledWith(
      "c1",
      expect.any(String),
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "应用并保存" }));
    await waitFor(() => {
      expect(appApi.saveAiAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: "c1" }),
        "keep",
      );
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("renders structured AI details and reports stale annotations", () => {
    render(
      <AiAnnotationSection
        command={{
          ...command,
          title: "docker ps -a",
          command: "docker ps -a",
          shell: "bash",
          aiAnnotationStatus: "ready",
          aiAnnotation: { ...annotation, isStale: true },
        }}
        hasManualAnnotation={false}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText("检查本地密码配置")).toBeInTheDocument();
    expect(screen.getByText("不要在不安全的环境中执行")).toBeInTheDocument();
    expect(screen.getByText(/AI 注释可能过期/)).toBeInTheDocument();
    expect(screen.getByText("建议 Shell：CMD")).toBeInTheDocument();
    expect(screen.getByText("AI 模型信息")).toBeInTheDocument();
  });

  it("disables generation when no API key is configured", async () => {
    useAppStore.setState({
      snapshot: { ...snapshot, aiApiKeyConfigured: false },
    });
    render(
      <AiAnnotationSection
        command={command}
        hasManualAnnotation={false}
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/尚未配置 AI 服务/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "AI 生成注释" }),
    ).toBeDisabled();
  });
});
