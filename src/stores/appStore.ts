import { create } from "zustand";
import { appApi } from "@/services/appApi";
import type {
  AppSnapshot,
  CategoryManagerRequest,
  CommandDetailRequest,
  CommandDragState,
  ManagerView,
  Notice,
  PromptDetailRequest,
  PromptDragState,
  SettingsPatch,
  UiMode,
} from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";

type BootStatus = "idle" | "loading" | "ready" | "error";

interface AppStore {
  bootStatus: BootStatus;
  bootError: string | null;
  snapshot: AppSnapshot | null;
  uiMode: UiMode;
  managerView: ManagerView;
  focusSearchRequest: number;
  notice: Notice | null;
  dataRevision: number;
  promptRevision: number;
  clipboardRevision: number;
  categoryFilterId: string | null;
  promptCategoryFilterId: string | null;
  tagFilterId: string | null;
  commandDetailRequest: CommandDetailRequest | null;
  promptDetailRequest: PromptDetailRequest | null;
  categoryManagerRequest: CategoryManagerRequest | null;
  commandDrag: CommandDragState | null;
  promptDrag: PromptDragState | null;

  initialize: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<AppSnapshot>;
  setUiMode: (mode: UiMode) => Promise<void>;
  setManagerView: (view: ManagerView) => void;
  handleModeChanged: (mode: UiMode) => void;
  handleNavigate: (view: ManagerView) => void;
  requestSearchFocus: () => void;
  handleDataChanged: (revision: number) => void;
  handlePromptsChanged: (revision: number) => void;
  handleClipboardChanged: (revision: number) => void;
  requestCommandDetail: (id: string) => void;
  clearCommandDetailRequest: () => void;
  requestPromptDetail: (id: string, openEditor?: boolean) => void;
  clearPromptDetailRequest: () => void;
  openCategoryManager: (request: {
    parentId?: string | null;
    editId?: string | null;
    deleteId?: string | null;
  }) => void;
  clearCategoryManagerRequest: () => void;
  startCommandDrag: (
    ids: string[],
    source: CommandDragState["source"],
  ) => void;
  endCommandDrag: () => void;
  startPromptDrag: (ids: string[]) => void;
  endPromptDrag: () => void;
  setCategoryFilter: (categoryId: string | null) => void;
  setPromptCategoryFilter: (categoryId: string | null) => void;
  setTagFilter: (tagId: string | null) => void;
  showNotice: (notice: Notice) => void;
  clearNotice: () => void;
  hideWindow: () => Promise<void>;
  quitApp: () => Promise<void>;
  reportError: (error: unknown) => void;
}

let initializePromise: Promise<void> | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  bootStatus: "idle",
  bootError: null,
  snapshot: null,
  uiMode: "manager",
  managerView: "library",
  focusSearchRequest: 0,
  notice: null,
  dataRevision: 0,
  promptRevision: 0,
  clipboardRevision: 0,
  categoryFilterId: null,
  promptCategoryFilterId: null,
  tagFilterId: null,
  commandDetailRequest: null,
  promptDetailRequest: null,
  categoryManagerRequest: null,
  commandDrag: null,
  promptDrag: null,

  initialize: async () => {
    if (get().bootStatus === "ready") {
      return;
    }
    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      set({ bootStatus: "loading", bootError: null });
      try {
        const snapshot = await appApi.getSnapshot();
        set({
          bootStatus: "ready",
          bootError: null,
          snapshot,
          uiMode: snapshot.uiMode,
        });
      } catch (error) {
        set({
          bootStatus: "error",
          bootError: getUserErrorMessage(error),
        });
      } finally {
        initializePromise = null;
      }
    })();

    return initializePromise;
  },

  refreshSnapshot: async () => {
    try {
      const snapshot = await appApi.getSnapshot();
      set({ snapshot, uiMode: snapshot.uiMode });
    } catch (error) {
      get().reportError(error);
    }
  },

  updateSettings: async (patch) => {
    try {
      const snapshot = await appApi.updateSettings(patch);
      set({ snapshot, uiMode: snapshot.uiMode });
      return snapshot;
    } catch (error) {
      // A failed native transaction may still have rolled a shortcut or
      // autostart registration back. Re-read the authoritative backend state
      // before displaying the error so the controls never lie to the user.
      await get().refreshSnapshot();
      throw error;
    }
  },

  setUiMode: async (mode) => {
    const previousMode = get().uiMode;
    if (previousMode === mode) {
      return;
    }

    set({ uiMode: mode });
    try {
      await appApi.setUiMode(mode);
    } catch (error) {
      set({ uiMode: previousMode });
      get().reportError(error);
      throw error;
    }
  },

  setManagerView: (view) =>
    set({ managerView: view, tagFilterId: null }),

  handleModeChanged: (mode) => {
    set((state) => ({
      uiMode: mode,
      focusSearchRequest:
        mode === "quick"
          ? state.focusSearchRequest + 1
          : state.focusSearchRequest,
    }));
  },

  handleNavigate: (view) =>
    set({ managerView: view, tagFilterId: null }),

  requestSearchFocus: () => {
    set((state) => ({ focusSearchRequest: state.focusSearchRequest + 1 }));
  },

  handleDataChanged: (revision) => {
    set((state) => ({
      dataRevision: Math.max(state.dataRevision, revision),
    }));
  },

  handlePromptsChanged: (revision) => {
    set((state) => ({
      promptRevision: Math.max(state.promptRevision, revision),
    }));
  },

  handleClipboardChanged: (revision) => {
    set((state) => ({
      clipboardRevision: Math.max(state.clipboardRevision, revision),
    }));
  },

  requestCommandDetail: (id) => {
    set((state) => ({
      managerView: "library",
      tagFilterId: null,
      commandDetailRequest: {
        id,
        revision: (state.commandDetailRequest?.revision ?? 0) + 1,
      },
    }));
  },

  clearCommandDetailRequest: () => set({ commandDetailRequest: null }),

  requestPromptDetail: (id, openEditor = false) => {
    set((state) => ({
      managerView: "prompts",
      tagFilterId: null,
      promptDetailRequest: {
        id,
        openEditor,
        revision: (state.promptDetailRequest?.revision ?? 0) + 1,
      },
    }));
  },

  clearPromptDetailRequest: () => set({ promptDetailRequest: null }),

  openCategoryManager: (request) => {
    set((state) => ({
      categoryManagerRequest: {
        ...request,
        revision: (state.categoryManagerRequest?.revision ?? 0) + 1,
      },
    }));
  },

  clearCategoryManagerRequest: () =>
    set({ categoryManagerRequest: null }),

  startCommandDrag: (ids, source) => set({ commandDrag: { ids, source } }),

  endCommandDrag: () => set({ commandDrag: null }),

  startPromptDrag: (ids) => set({ promptDrag: { ids } }),

  endPromptDrag: () => set({ promptDrag: null }),

  setCategoryFilter: (categoryId) =>
    set({
      categoryFilterId: categoryId,
      managerView: "library",
      tagFilterId: null,
    }),

  setPromptCategoryFilter: (categoryId) =>
    set({
      promptCategoryFilterId: categoryId,
      managerView: "prompts",
      tagFilterId: null,
    }),

  setTagFilter: (tagId) => set({ tagFilterId: tagId }),

  showNotice: (notice) => set({ notice }),

  clearNotice: () => set({ notice: null }),

  hideWindow: async () => {
    try {
      await appApi.hideWindow();
    } catch (error) {
      get().reportError(error);
    }
  },

  quitApp: async () => {
    try {
      await appApi.quit();
    } catch (error) {
      get().reportError(error);
    }
  },

  reportError: (error) => {
    set({
      notice: {
        kind: "error",
        message: getUserErrorMessage(error),
      },
    });
  },
}));
