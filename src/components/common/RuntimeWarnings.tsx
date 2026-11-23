import { ArrowRight } from "lucide-react";
import { Banner } from "@/components/common/Banner";
import { Button } from "@/components/ui/Button";
import { useAppStore } from "@/stores/appStore";
import type { UiMode } from "@/types/app";

interface RuntimeWarningsProps {
  mode: UiMode;
  compact?: boolean;
}

export function RuntimeWarnings({ mode, compact = false }: RuntimeWarningsProps) {
  const snapshot = useAppStore((state) => state.snapshot);
  const setManagerView = useAppStore((state) => state.setManagerView);
  const setUiMode = useAppStore((state) => state.setUiMode);

  if (!snapshot) {
    return null;
  }

  const openShortcutSettings = () => {
    setManagerView("settings");
    void setUiMode("manager");
  };

  return (
    <div className="space-y-1.5">
      {snapshot.settingsWarning ? (
        <Banner tone="warning" title="设置文件需要检查">
          {snapshot.settingsWarning}
        </Banner>
      ) : null}

      {snapshot.databaseWarning ? (
        <Banner tone="warning" title="命令数据库已恢复">
          {snapshot.databaseWarning}
        </Banner>
      ) : null}

      {!snapshot.shortcut.registered ? (
        <Banner
          tone="warning"
          title="全局快捷键不可用"
          action={
            compact ? null : (
              <Button variant="outline" size="sm" onClick={openShortcutSettings}>
                检查快捷键
                <ArrowRight />
              </Button>
            )
          }
        >
          {snapshot.shortcut.error ?? "快捷键未能注册，托盘仍可正常使用。"}
          {mode === "quick" ? " 你仍可从托盘呼出面板。" : ""}
        </Banner>
      ) : null}
    </div>
  );
}
