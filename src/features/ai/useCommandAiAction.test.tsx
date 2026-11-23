import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  AiAnnotation,
  AppSnapshot,
  Command,
  GeneratedAiAnnotation,
} from "@/types/app";
import { useCommandAiAction } from "./useCommandAiAction";

vi.mock("@/services/appApi", () => ({
  appApi: {
    checkAiCommandSensitivity: vi.fn(),
    generateAiAnnotation: vi.fn(),
    getCommand: vi.fn(),
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
  uiMode: "quick",
  shortcut: { registered: true, error: null },
  autostartEnabled: false,
  aiApiKeyConfigured: true,
  settingsPath: "settings.json",
  settingsWarning: null,
  databasePath: "commands.db",
  databaseWarning: null,
};

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

function generated(overrides: Partial<GeneratedAiAnnotation> = {}): GeneratedAiAnnotation {
  return {
    commandId: "c1",
    commandContentHash: "hash",
    provider: "deepseek",
    model: "deepseek-chat",
    promptVersion: "annotation-v1",
    generatedAt: 2,
    shortDescription: "查看全部 Docker 容器",
    detailedDescription: "列出所有容器。",
    parameters: [],
    requirements: [],
    warnings: [],
    suggestedShell: "bash",
    riskLevel: "low",
    ...overrides,
  };
}

function aiAnnotation(short: string, detailed: string): AiAnnotation {
  return {
    ...generated(),
    id: "ai-1",
    commandId: "c1",
    shortDescription: short,
    detailedDescription: detailed,
    commandContentHash: "hash",
    updatedAt: 2,
    isStale: false,
  };
}

describe("useCommandAiAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ snapshot, notice: null });
    vi.mocked(appApi.getCommand).mockResolvedValue(command());
    vi.mocked(appApi.saveAiAnnotation).mockResolvedValue(command());
    vi.mocked(appApi.checkAiCommandSensitivity).mockResolvedValue(false);
  });

  it("generates and saves immediately when the command is unannotated and not sensitive", async () => {
    const result = generated();
    vi.mocked(appApi.generateAiAnnotation).mockResolvedValue(result);
    const { result: hook } = renderHook(() => useCommandAiAction());

    await act(async () => {
      await hook.current.request(command());
    });

    expect(appApi.generateAiAnnotation).toHaveBeenCalledWith(
      "c1",
      expect.any(String),
      false,
    );
    expect(appApi.saveAiAnnotation).toHaveBeenCalledWith(result, "keep");
    await waitFor(() =>
      expect(useAppStore.getState().notice?.kind).toBe("success"),
    );
  });

  it("asks before sending a sensitive command and retries with consent", async () => {
    vi.mocked(appApi.checkAiCommandSensitivity).mockResolvedValue(true);
    vi.mocked(appApi.generateAiAnnotation).mockResolvedValue(generated());
    const { result } = renderHook(() => useCommandAiAction());

    await act(async () => {
      await result.current.request(command());
    });
    expect(result.current.confirmation).toMatchObject({
      sensitive: true,
      hasManual: false,
      hasAi: false,
    });
    expect(appApi.generateAiAnnotation).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirm();
    });
    expect(appApi.generateAiAnnotation).toHaveBeenCalledWith(
      "c1",
      expect.any(String),
      true,
    );
  });

  it("confirms an existing handwritten note and preserves it through replace mode", async () => {
    const existing = command({
      title: "查看容器",
      description: "只列出运行中的容器。",
    });
    vi.mocked(appApi.getCommand).mockResolvedValue(existing);
    vi.mocked(appApi.generateAiAnnotation).mockResolvedValue(generated());
    vi.mocked(appApi.saveAiAnnotation).mockResolvedValue(existing);
    const { result } = renderHook(() => useCommandAiAction());

    await act(async () => {
      await result.current.request(existing);
    });
    expect(result.current.confirmation).toMatchObject({
      sensitive: false,
      hasManual: true,
      hasAi: false,
    });
    expect(appApi.generateAiAnnotation).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirm();
    });
    expect(appApi.saveAiAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        detailedDescription: expect.stringContaining("只列出运行中的容器。"),
      }),
      "replace",
    );
  });

  it("confirms an existing AI annotation and replaces its mirrored title/description", async () => {
    const ai = aiAnnotation("旧 AI 说明", "旧 AI 详细说明。");
    const existing = command({
      title: "旧 AI 说明",
      description: "旧 AI 详细说明。",
      aiAnnotationStatus: "ready",
      aiAnnotation: ai,
    });
    vi.mocked(appApi.getCommand).mockResolvedValue(existing);
    vi.mocked(appApi.generateAiAnnotation).mockResolvedValue(generated());
    vi.mocked(appApi.saveAiAnnotation).mockResolvedValue(existing);
    const { result } = renderHook(() => useCommandAiAction());

    await act(async () => {
      await result.current.request(existing);
    });
    expect(result.current.confirmation).toMatchObject({
      hasManual: false,
      hasAi: true,
    });

    await act(async () => {
      await result.current.confirm();
    });
    expect(appApi.saveAiAnnotation).toHaveBeenCalledWith(
      expect.any(Object),
      "replace",
    );
  });

  it("keeps the auto-generated title when the AI row is not mirrored there", async () => {
    const ai = aiAnnotation("旧 AI 说明", "旧 AI 详细说明。");
    const existing = command({
      aiAnnotationStatus: "ready",
      aiAnnotation: ai,
    });
    vi.mocked(appApi.getCommand).mockResolvedValue(existing);
    vi.mocked(appApi.generateAiAnnotation).mockResolvedValue(generated());
    vi.mocked(appApi.saveAiAnnotation).mockResolvedValue(existing);
    const { result } = renderHook(() => useCommandAiAction());

    await act(async () => {
      await result.current.request(existing);
    });
    expect(result.current.confirmation).toMatchObject({
      hasManual: false,
      hasAi: true,
    });

    await act(async () => {
      await result.current.confirm();
    });
    expect(appApi.saveAiAnnotation).toHaveBeenCalledWith(
      expect.any(Object),
      "keep",
    );
  });

  it("suppresses a rapid duplicate request for the same command", async () => {
    let resolveCheck: (value: boolean) => void = () => undefined;
    vi.mocked(appApi.checkAiCommandSensitivity).mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    vi.mocked(appApi.generateAiAnnotation).mockResolvedValue(generated());
    const { result } = renderHook(() => useCommandAiAction());

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.request(command());
      second = result.current.request(command());
    });
    await act(async () => {
      resolveCheck(false);
      await Promise.all([first, second]);
    });

    expect(appApi.checkAiCommandSensitivity).toHaveBeenCalledTimes(1);
    expect(appApi.generateAiAnnotation).toHaveBeenCalledTimes(1);
  });

  it("reports a per-command busy response as an informational notice", async () => {
    vi.mocked(appApi.generateAiAnnotation).mockRejectedValue({
      code: "AI_BUSY",
      message: "该命令正在生成 AI 注释，请等待完成后再试。",
    });
    const { result } = renderHook(() => useCommandAiAction());

    await act(async () => {
      await result.current.request(command());
    });

    await waitFor(() =>
      expect(useAppStore.getState().notice).toMatchObject({
        kind: "info",
        message: expect.stringContaining("正在生成"),
      }),
    );
  });
});
