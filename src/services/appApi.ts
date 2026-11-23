import { invoke } from "@tauri-apps/api/core";
import type {
  AiConnectionTestConfig,
  AiConnectionTestResult,
  AppSnapshot,
  BackupInfo,
  CategoryAppearanceInput,
  CategoryDeleteOptions,
  CategoryDeleteReport,
  CategoryInput,
  CategoryNode,
  CategoryPatch,
  ClipboardState,
  ClipboardStatus,
  ClearClipboardHistoryResult,
  SaveClipboardInput,
  SaveClipboardResult,
  SystemClipboardHistory,
  Command,
  CommandInput,
  CommandPlacement,
  CommandQuery,
  CopyOutcome,
  GeneratedAiAnnotation,
  ImportMode,
  ManualAnnotationMode,
  MoveCommandsResult,
  ImportReport,
  LibrarySummary,
  MovePromptsResult,
  Prompt,
  PromptCategoryDeleteReport,
  PromptCategoryNode,
  PromptInput,
  PromptLibrarySummary,
  PromptPlacement,
  PromptQuery,
  RestoreReport,
  SaveAiAnnotationInput,
  SavePromptResult,
  SettingsPatch,
  Tag,
  UiMode,
  UpdateConfiguration,
} from "@/types/app";

export const appApi = {
  getSnapshot(): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("get_app_snapshot");
  },

  getUpdateConfiguration(): Promise<UpdateConfiguration> {
    return invoke<UpdateConfiguration>("get_update_configuration");
  },

  updateSettings(patch: SettingsPatch): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("update_settings", { patch });
  },

  saveAiApiKey(apiKey: string): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("save_ai_api_key", { apiKey });
  },

  clearAiApiKey(): Promise<AppSnapshot> {
    return invoke<AppSnapshot>("clear_ai_api_key");
  },

  testAiConnection(
    input: AiConnectionTestConfig,
  ): Promise<AiConnectionTestResult> {
    return invoke<AiConnectionTestResult>("test_ai_connection", { input });
  },

  checkAiCommandSensitivity(commandId: string): Promise<boolean> {
    return invoke<boolean>("check_ai_command_sensitivity", { commandId });
  },

  generateAiAnnotation(
    commandId: string,
    requestId: string,
    allowSensitive: boolean,
  ): Promise<GeneratedAiAnnotation> {
    return invoke<GeneratedAiAnnotation>("generate_ai_annotation", {
      commandId,
      requestId,
      allowSensitive,
    });
  },

  cancelAiRequest(requestId: string): Promise<boolean> {
    return invoke<boolean>("cancel_ai_request", { requestId });
  },

  saveAiAnnotation(
    generated: GeneratedAiAnnotation,
    manualMode: ManualAnnotationMode,
  ): Promise<Command> {
    const input: SaveAiAnnotationInput = { generated, manualMode };
    return invoke<Command>("save_ai_annotation", { input });
  },

  setUiMode(mode: UiMode): Promise<void> {
    return invoke<void>("set_ui_mode", { mode });
  },

  hideWindow(): Promise<void> {
    return invoke<void>("hide_main_window");
  },

  startWindowDrag(): Promise<void> {
    return invoke<void>("start_window_drag");
  },

  quit(): Promise<void> {
    return invoke<void>("quit_app");
  },

  listCommands(query: CommandQuery): Promise<Command[]> {
    return invoke<Command[]>("list_commands", { query });
  },

  getLibrarySummary(): Promise<LibrarySummary> {
    return invoke<LibrarySummary>("get_library_summary");
  },

  getCommand(id: string): Promise<Command> {
    return invoke<Command>("get_command", { id });
  },

  createCommand(input: CommandInput): Promise<Command> {
    return invoke<Command>("create_command", { input });
  },

  updateCommand(id: string, input: CommandInput): Promise<Command> {
    return invoke<Command>("update_command", { id, input });
  },

  deleteCommand(id: string): Promise<void> {
    return invoke<void>("delete_command", { id });
  },

  toggleCommandFavorite(id: string): Promise<Command> {
    return invoke<Command>("toggle_command_favorite", { id });
  },

  copyCommands(ids: string[]): Promise<CopyOutcome> {
    return invoke<CopyOutcome>("copy_commands", { ids });
  },

  reorderCommands(ids: string[]): Promise<void> {
    return invoke<void>("reorder_commands", { ids });
  },

  moveCommandsToCategory(
    ids: string[],
    categoryId: string | null,
  ): Promise<MoveCommandsResult> {
    return invoke<MoveCommandsResult>("move_commands_to_category", {
      ids,
      categoryId,
    });
  },

  restoreCommandPlacements(
    placements: CommandPlacement[],
  ): Promise<number> {
    return invoke<number>("restore_command_placements", { placements });
  },

  reorderCategories(parentId: string | null, ids: string[]): Promise<void> {
    return invoke<void>("reorder_categories", { parentId, ids });
  },

  listCategories(): Promise<CategoryNode[]> {
    return invoke<CategoryNode[]>("list_categories");
  },

  createCategory(input: CategoryInput): Promise<string> {
    return invoke<string>("create_category", { input });
  },

  updateCategory(id: string, patch: CategoryPatch): Promise<void> {
    return invoke<void>("update_category", { id, patch });
  },

  deleteCategory(id: string): Promise<void> {
    return invoke<void>("delete_category", { id });
  },

  deleteCategoryWithOptions(
    id: string,
    options: CategoryDeleteOptions,
  ): Promise<CategoryDeleteReport> {
    return invoke<CategoryDeleteReport>("delete_category_with_options", {
      id,
      options,
    });
  },

  setCommandsColor(ids: string[], color: string | null): Promise<number> {
    return invoke<number>("set_commands_color", { ids, color });
  },

  setCommandsFollowCategoryColor(
    ids: string[],
    enabled: boolean,
  ): Promise<number> {
    return invoke<number>("set_commands_follow_category_color", {
      ids,
      enabled,
    });
  },

  setCategoryAppearance(
    id: string,
    appearance: CategoryAppearanceInput,
  ): Promise<void> {
    return invoke<void>("set_category_appearance", { id, appearance });
  },

  listTags(): Promise<Tag[]> {
    return invoke<Tag[]>("list_tags");
  },

  listPrompts(query: PromptQuery): Promise<Prompt[]> {
    return invoke<Prompt[]>("list_prompts", { query });
  },

  getPromptLibrarySummary(): Promise<PromptLibrarySummary> {
    return invoke<PromptLibrarySummary>("get_prompt_library_summary");
  },

  getPrompt(id: string): Promise<Prompt> {
    return invoke<Prompt>("get_prompt", { id });
  },

  createPrompt(input: PromptInput): Promise<Prompt> {
    return invoke<Prompt>("create_prompt", { input });
  },

  updatePrompt(id: string, input: PromptInput): Promise<Prompt> {
    return invoke<Prompt>("update_prompt", { id, input });
  },

  deletePrompt(id: string): Promise<void> {
    return invoke<void>("delete_prompt", { id });
  },

  togglePromptFavorite(id: string): Promise<Prompt> {
    return invoke<Prompt>("toggle_prompt_favorite", { id });
  },

  copyPrompts(ids: string[]): Promise<CopyOutcome> {
    return invoke<CopyOutcome>("copy_prompts", { ids });
  },

  reorderPrompts(ids: string[]): Promise<void> {
    return invoke<void>("reorder_prompts", { ids });
  },

  movePromptsToCategory(
    ids: string[],
    categoryId: string | null,
  ): Promise<MovePromptsResult> {
    return invoke<MovePromptsResult>("move_prompts_to_category", {
      ids,
      categoryId,
    });
  },

  restorePromptPlacements(placements: PromptPlacement[]): Promise<number> {
    return invoke<number>("restore_prompt_placements", { placements });
  },

  setPromptsColor(ids: string[], color: string | null): Promise<number> {
    return invoke<number>("set_prompts_color", { ids, color });
  },

  listPromptCategories(): Promise<PromptCategoryNode[]> {
    return invoke<PromptCategoryNode[]>("list_prompt_categories");
  },

  createPromptCategory(input: CategoryInput): Promise<string> {
    return invoke<string>("create_prompt_category", { input });
  },

  updatePromptCategory(id: string, patch: CategoryPatch): Promise<void> {
    return invoke<void>("update_prompt_category", { id, patch });
  },

  deletePromptCategoryWithOptions(
    id: string,
    options: CategoryDeleteOptions,
  ): Promise<PromptCategoryDeleteReport> {
    return invoke<PromptCategoryDeleteReport>(
      "delete_prompt_category_with_options",
      { id, options },
    );
  },

  reorderPromptCategories(
    parentId: string | null,
    ids: string[],
  ): Promise<void> {
    return invoke<void>("reorder_prompt_categories", { parentId, ids });
  },

  setPromptCategoryAppearance(
    id: string,
    appearance: CategoryAppearanceInput,
  ): Promise<void> {
    return invoke<void>("set_prompt_category_appearance", { id, appearance });
  },

  listPromptTags(): Promise<Tag[]> {
    return invoke<Tag[]>("list_prompt_tags");
  },

  saveClipboardAsPrompt(
    content: string,
    allowSensitive: boolean,
  ): Promise<SavePromptResult> {
    return invoke<SavePromptResult>("save_clipboard_as_prompt", {
      content,
      allowSensitive,
    });
  },

  exportLibraryJson(): Promise<string> {
    return invoke<string>("export_library_json");
  },

  exportLibraryFile(): Promise<string> {
    return invoke<string>("export_library_file");
  },

  importLibraryJson(json: string, mode: ImportMode): Promise<ImportReport> {
    return invoke<ImportReport>("import_library_json", { json, mode });
  },

  createDatabaseBackup(): Promise<BackupInfo> {
    return invoke<BackupInfo>("create_database_backup");
  },

  listDatabaseBackups(): Promise<BackupInfo[]> {
    return invoke<BackupInfo[]>("list_database_backups");
  },

  restoreDatabaseBackup(fileName: string): Promise<RestoreReport> {
    return invoke<RestoreReport>("restore_database_backup", { fileName });
  },

  getClipboardState(): Promise<ClipboardState> {
    return invoke<ClipboardState>("get_clipboard_state");
  },

  getSystemClipboardHistory(): Promise<SystemClipboardHistory> {
    return invoke<SystemClipboardHistory>("get_system_clipboard_history");
  },

  getClipboardStatus(): Promise<ClipboardStatus> {
    return invoke<ClipboardStatus>("get_clipboard_status");
  },

  saveClipboardText(input: SaveClipboardInput): Promise<SaveClipboardResult> {
    return invoke<SaveClipboardResult>("save_clipboard_text", { input });
  },

  copyClipboardText(content: string): Promise<void> {
    return invoke<void>("copy_clipboard_text", { content });
  },

  clearClipboardHistory(): Promise<ClearClipboardHistoryResult> {
    return invoke<ClearClipboardHistoryResult>("clear_clipboard_history");
  },
};
