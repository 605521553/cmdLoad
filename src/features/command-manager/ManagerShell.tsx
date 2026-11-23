import { GripHorizontal, PanelTopOpen } from "lucide-react";
import { RuntimeWarnings } from "@/components/common/RuntimeWarnings";
import { ShortcutKeys } from "@/components/common/ShortcutKeys";
import { Button } from "@/components/ui/Button";
import { ClipboardPage } from "@/features/command-manager/ClipboardPage";
import { LibraryPage } from "@/features/command-manager/LibraryPage";
import { OverviewPage } from "@/features/command-manager/OverviewPage";
import { Sidebar } from "@/features/command-manager/Sidebar";
import { WorkflowsPage } from "@/features/command-manager/WorkflowsPage";
import { PromptLibraryPage } from "@/features/prompts/PromptLibraryPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { useAppStore } from "@/stores/appStore";
import type { ManagerView } from "@/types/app";
import { cn } from "@/utils/cn";

const PAGE_TITLES: Record<ManagerView, string> = {
  library: "命令库",
  prompts: "提示词库",
  workflows: "工作流",
  clipboard: "剪贴板",
  overview: "概览",
  settings: "设置",
};

export function ManagerShell() {
  const snapshot = useAppStore((state) => state.snapshot);
  const managerView = useAppStore((state) => state.managerView);
  const setUiMode = useAppStore((state) => state.setUiMode);
  const startWindowDrag = useWindowDrag();

  if (!snapshot) {
    return null;
  }

  const isLibrary = managerView === "library" || managerView === "prompts";
  const page =
    managerView === "library" ? (
      <LibraryPage />
    ) : managerView === "prompts" ? (
      <PromptLibraryPage />
    ) : managerView === "workflows" ? (
      <WorkflowsPage />
    ) : managerView === "clipboard" ? (
      <ClipboardPage />
    ) : managerView === "settings" ? (
      <SettingsPage />
    ) : (
      <OverviewPage />
    );

  return (
    <div className="animate-content-in flex h-full overflow-hidden bg-canvas">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          onPointerDown={startWindowDrag}
          className="window-drag-strip flex h-9 shrink-0 cursor-grab items-center border-b border-line/80 bg-surface/45 px-3"
          title="拖动此处移动窗口"
        >
          <div className="flex min-w-0 items-center gap-2">
            <GripHorizontal
              aria-hidden="true"
              className="size-3.5 text-ink-faint/70"
            />
            <span className="truncate text-[13px] font-semibold tracking-tight text-ink">
              {PAGE_TITLES[managerView]}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void setUiMode("quick")}
              title="打开快捷面板"
            >
              <PanelTopOpen />
              快捷面板
            </Button>
            <span className="hidden xl:inline-flex">
              <ShortcutKeys
                shortcut={snapshot.settings.shortcut}
                className="[&_kbd]:h-[17px] [&_kbd]:text-[9px]"
                muted
              />
            </span>
          </div>
        </header>

        <main
          className={cn(
            "min-h-0 flex-1",
            isLibrary ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {isLibrary ? (
            <div className="flex h-full min-h-0 flex-col px-4 pb-3 pt-3">
              <RuntimeWarnings mode="manager" />
              <div className="min-h-0 flex-1">{page}</div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[920px] px-5 py-4">
              <div className="space-y-3">
                <RuntimeWarnings mode="manager" />
                {page}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
