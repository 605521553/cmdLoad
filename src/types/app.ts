export type UiMode = "quick" | "manager";

export type ThemePreference = "system" | "light" | "dark";

export type ManagerView =
  | "library"
  | "prompts"
  | "workflows"
  | "clipboard"
  | "overview"
  | "settings";

export interface AppSettings {
  shortcut: string;
  launchAtStartup: boolean;
  autoHideQuickPanel: boolean;
  theme: ThemePreference;
  sidebarWidth: number;
  clipboardMonitoringEnabled: boolean;
  clipboardHistoryLimit: number;
  clipboardHistoryRetentionDays: number;
  hideQuickPanelAfterCopy: boolean;
  /** Shared personal palette, canonical #RRGGBB values, oldest first. */
  customColors: string[];
  aiProvider: string;
  aiBaseUrl: string;
  aiModel: string;
  aiTimeoutSeconds: number;
  aiTemperature: number | null;
  aiAutoAnnotation: boolean;
}

export interface ShortcutStatus {
  registered: boolean;
  error: string | null;
}

export interface AppSnapshot {
  version: string;
  settings: AppSettings;
  uiMode: UiMode;
  shortcut: ShortcutStatus;
  autostartEnabled: boolean;
  aiApiKeyConfigured: boolean;
  settingsPath: string;
  settingsWarning: string | null;
  databasePath: string;
  databaseWarning: string | null;
}

export type CommandShell =
  | "powershell"
  | "cmd"
  | "bash"
  | "sh"
  | "zsh"
  | "other"
  | "unknown";
export type CommandSource =
  | "manual"
  | "clipboard_current"
  | "clipboard_history"
  | "import";
export type CommandFilter = "all" | "recent" | "favorites";
export type CommandSort = "manual" | "recent" | "updated" | "title" | "mostUsed";
export type ImportMode = "merge" | "replace";

export type AiAnnotationStatus = "none" | "pending" | "ready" | "failed";
export type AiRiskLevel = "low" | "medium" | "high" | "unknown";
export type AiSuggestedShell = CommandShell;
export type ManualAnnotationMode = "keep" | "append" | "replace";

export interface AiAnnotationParameter {
  name: string;
  description: string;
}

export interface AiAnnotationDraft {
  shortDescription: string;
  detailedDescription: string;
  parameters: AiAnnotationParameter[];
  requirements: string[];
  warnings: string[];
  suggestedShell: AiSuggestedShell;
  riskLevel: AiRiskLevel;
}

export interface AiAnnotation extends AiAnnotationDraft {
  id: string;
  commandId: string;
  provider: string;
  model: string;
  promptVersion: string;
  commandContentHash: string;
  generatedAt: number;
  updatedAt: number;
  isStale: boolean;
}

export interface GeneratedAiAnnotation extends AiAnnotationDraft {
  commandId: string;
  commandContentHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  generatedAt: number;
}

export interface SaveAiAnnotationInput {
  generated: GeneratedAiAnnotation;
  manualMode: ManualAnnotationMode;
}

export interface AiConnectionTestConfig {
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  apiKey?: string;
}

export interface AiConnectionTestResult {
  model: string;
  latencyMs: number;
}

export interface TagSummary {
  id: string;
  name: string;
  color: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  commandCount: number;
  createdAt: number;
}

export interface Command {
  id: string;
  title: string;
  command: string;
  description: string;
  shell: CommandShell;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIconName: string | null;
  backgroundColor: string | null;
  useCategoryColor: boolean;
  tags: TagSummary[];
  sourceType: CommandSource;
  aiAnnotationStatus: AiAnnotationStatus;
  contentHash: string;
  aiAnnotation: AiAnnotation | null;
  isFavorite: boolean;
  sortOrder: number;
  useCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CommandInput {
  title: string;
  command: string;
  description: string;
  shell: CommandShell;
  categoryId: string | null;
  tags: string[];
}

export interface LibrarySummary {
  commandCount: number;
  favoriteCount: number;
  categoryCount: number;
  tagCount: number;
  recentCommands: Command[];
}

export interface CommandQuery {
  search?: string;
  filter?: CommandFilter;
  sort?: CommandSort;
  categoryId?: string | null;
  unclassifiedOnly?: boolean;
  tagId?: string | null;
  limit?: number;
}

export const UNCLASSIFIED_CATEGORY_ID = "__unclassified__";

export type PromptFilter = "all" | "recent" | "favorites";
export type PromptSort = "manual" | "recent" | "updated" | "title" | "mostUsed";

export interface Prompt {
  id: string;
  /** Empty when the user did not name the prompt. */
  title: string;
  content: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIconName: string | null;
  backgroundColor: string | null;
  tags: TagSummary[];
  isFavorite: boolean;
  sortOrder: number;
  useCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PromptInput {
  title: string;
  content: string;
  categoryId: string | null;
  tags: string[];
  backgroundColor: string | null;
  favorite: boolean;
}

export interface PromptQuery {
  search?: string;
  filter?: PromptFilter;
  sort?: PromptSort;
  categoryId?: string | null;
  unclassifiedOnly?: boolean;
  tagId?: string | null;
  limit?: number;
}

export interface PromptCategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  promptCount: number;
  color: string | null;
  iconName: string | null;
  children: PromptCategoryNode[];
}

export interface PromptCategoryDeleteReport {
  movedPrompts: number;
  deletedCategories: number;
  targetCategoryId: string | null;
}

export interface PromptPlacement {
  id: string;
  categoryId: string | null;
  sortOrder: number;
}

export interface MovePromptsResult {
  moved: number;
  previous: PromptPlacement[];
}

export interface PromptLibrarySummary {
  promptCount: number;
  favoriteCount: number;
  categoryCount: number;
  tagCount: number;
  recentPrompts: Prompt[];
}

export interface SavePromptResult {
  prompt: Prompt;
  created: boolean;
}

export interface UpdateConfiguration {
  currentVersion: string;
  endpoint: string | null;
  configured: boolean;
  pubkeyConfigured: boolean;
}

export interface PromptDragState {
  ids: string[];
}

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  commandCount: number;
  color: string | null;
  iconName: string | null;
  children: CategoryNode[];
}

export interface CategoryAppearanceInput {
  color: string | null;
  iconName: string | null;
}

export interface CategoryInput {
  name: string;
  parentId: string | null;
}

export interface CategoryPatch {
  name?: string;
  parentId?: string | null;
}

export type CategoryCommandAction = "moveToParent" | "unclassified";
export type CategoryChildAction = "promote" | "deleteSubtree";

export interface CategoryDeleteOptions {
  commandAction: CategoryCommandAction;
  childAction: CategoryChildAction;
}

export interface CategoryDeleteReport {
  movedCommands: number;
  deletedCategories: number;
  targetCategoryId: string | null;
}

export interface CommandPlacement {
  id: string;
  categoryId: string | null;
  sortOrder: number;
}

export interface MoveCommandsResult {
  moved: number;
  previous: CommandPlacement[];
}

export interface CopyOutcome {
  copiedCount: number;
  usageRecorded: boolean;
  warning: string | null;
}

export interface BackupInfo {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: number;
}

export interface ImportReport {
  mode: ImportMode;
  categoriesAdded: number;
  tagsAdded: number;
  commandsAdded: number;
  commandsSkipped: number;
  promptCategoriesAdded: number;
  promptsAdded: number;
  promptsSkipped: number;
  backupPath: string | null;
}

export interface RestoreReport {
  commands: number;
  categories: number;
  tags: number;
  prompts: number;
  promptCategories: number;
  preRestoreBackup: string;
}

export type ClipboardSource = "current" | "system_history" | "local_monitor";

export type SystemHistoryStatus =
  | "available"
  | "disabled"
  | "access_denied"
  | "unsupported"
  | "error";

export interface ClipboardItem {
  key: string;
  content: string;
  source: ClipboardSource;
  copiedAt: number;
  isCurrent: boolean;
  isSensitive: boolean;
  savedCommandId: string | null;
  savedCommandIsFavorite: boolean;
}

export interface ClipboardState {
  current: ClipboardItem | null;
  localItems: ClipboardItem[];
  localHistoryEnabled: boolean;
  localHistoryCount: number;
  currentError: string | null;
  monitorWarning: string | null;
}

export interface SystemClipboardHistory {
  status: SystemHistoryStatus;
  enabled: boolean;
  items: ClipboardItem[];
  message: string | null;
}

export interface ClipboardStatus {
  systemHistoryEnabled: boolean;
  systemHistoryStatus: SystemHistoryStatus;
  systemHistoryMessage: string | null;
  localHistoryCount: number;
  localHistoryEnabled: boolean;
  monitorWarning: string | null;
}

export interface SaveClipboardInput {
  content: string;
  source: ClipboardSource;
  allowSensitive?: boolean;
}

export interface SaveClipboardResult {
  command: Command;
  created: boolean;
}

export interface ClearClipboardHistoryResult {
  removed: number;
}

export interface DataChangedPayload {
  revision: number;
}

export interface ClipboardChangedPayload {
  revision: number;
}

export interface CommandDetailRequest {
  id: string;
  revision: number;
}

export interface PromptDetailRequest {
  id: string;
  revision: number;
  openEditor: boolean;
}

export interface CategoryManagerRequest {
  parentId?: string | null;
  editId?: string | null;
  deleteId?: string | null;
  revision: number;
}

export interface CommandDragState {
  ids: string[];
  source: "library" | "tree";
}

export interface SettingsPatch {
  shortcut?: string;
  launchAtStartup?: boolean;
  autoHideQuickPanel?: boolean;
  theme?: ThemePreference;
  sidebarWidth?: number;
  clipboardMonitoringEnabled?: boolean;
  clipboardHistoryLimit?: number;
  clipboardHistoryRetentionDays?: number;
  hideQuickPanelAfterCopy?: boolean;
  customColors?: string[];
  aiProvider?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  aiTimeoutSeconds?: number;
  aiTemperature?: number;
  clearAiTemperature?: boolean;
  aiAutoAnnotation?: boolean;
}

export interface CommandErrorPayload {
  code?: string;
  message?: string;
}

export interface ModeChangedPayload {
  mode: UiMode;
}

export interface NavigatePayload {
  view: ManagerView;
}

export interface PanelShownPayload {
  mode: UiMode;
}

export interface Notice {
  kind: "success" | "error" | "info";
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}
