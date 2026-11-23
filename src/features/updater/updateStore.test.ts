import { beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { appApi } from "@/services/appApi";
import type { UpdateConfiguration } from "@/types/app";
import {
  resetUpdateStoreForTests,
  useUpdateStore,
} from "@/features/updater/updateStore";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/appApi", () => ({
  appApi: {
    getUpdateConfiguration: vi.fn(),
  },
}));

const configuration: UpdateConfiguration = {
  currentVersion: "0.2.0",
  endpoint:
    "https://github.com/example/pata-commands/releases/latest/download/latest.json",
  configured: true,
  pubkeyConfigured: true,
};

function fakeUpdate(version = "0.2.1") {
  return {
    currentVersion: "0.2.0",
    version,
    date: "2026-11-23T04:00:00Z",
    body: "修复若干问题\n\n- 提示词搜索\n- 更新流程",
    downloadAndInstall: vi.fn(
      async (
        onEvent?: (event: {
          event: string;
          data?: { contentLength?: number; chunkLength?: number };
        }) => void,
      ) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 60 } });
        onEvent?.({ event: "Finished" });
      },
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("updateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUpdateStoreForTests();
    vi.mocked(appApi.getUpdateConfiguration).mockResolvedValue(configuration);
  });

  it("reports an available update and opens the dialog for manual checks", async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate() as never);
    await useUpdateStore.getState().check();

    const state = useUpdateStore.getState();
    expect(state.status).toBe("available");
    expect(state.update?.version).toBe("0.2.1");
    expect(state.dialogOpen).toBe(true);
    expect(state.error).toBeNull();
  });

  it("keeps startup checks silent when already up to date", async () => {
    vi.mocked(check).mockResolvedValue(null);
    await useUpdateStore.getState().check({ silent: true });

    const state = useUpdateStore.getState();
    expect(state.status).toBe("up-to-date");
    expect(state.dialogOpen).toBe(false);
  });

  it("shows up-to-date feedback for a manual check", async () => {
    vi.mocked(check).mockResolvedValue(null);
    await useUpdateStore.getState().check();

    expect(useUpdateStore.getState().status).toBe("up-to-date");
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("downloads, tracks progress and relaunches after install", async () => {
    const update = fakeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);
    await useUpdateStore.getState().check();
    await useUpdateStore.getState().install();

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState().status).toBe("installing");
    expect(useUpdateStore.getState().progress).toBe(1);
    expect(useUpdateStore.getState().downloadedBytes).toBe(100);
    expect(useUpdateStore.getState().totalBytes).toBe(100);
  });

  it("never calls the updater when the release endpoint is still a placeholder", async () => {
    vi.mocked(appApi.getUpdateConfiguration).mockResolvedValue({
      ...configuration,
      configured: false,
      endpoint:
        "https://github.com/your-org/pata-commands/releases/latest/download/latest.json",
    });

    await useUpdateStore.getState().check();

    expect(check).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toContain("更新源尚未配置");
  });

  it("surfaces network errors without crashing", async () => {
    vi.mocked(check).mockRejectedValue(
      new Error("error sending request for url"),
    );
    await useUpdateStore.getState().check();

    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
    expect(useUpdateStore.getState().error).toContain("无法连接更新服务器");
  });

  it("remembers a dismissed version for the current session", async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate("0.2.1") as never);
    await useUpdateStore.getState().check({ silent: true });
    useUpdateStore.getState().closeDialog();
    expect(useUpdateStore.getState().dismissedVersion).toBe("0.2.1");

    vi.mocked(check).mockResolvedValue(fakeUpdate("0.2.1") as never);
    await useUpdateStore.getState().check({ silent: true });
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
  });
});
