import { useEffect } from "react";
import { BootErrorScreen } from "@/components/common/BootErrorScreen";
import { LoadingScreen } from "@/components/common/LoadingScreen";
import { NoticeHost } from "@/components/common/NoticeHost";
import { ManagerShell } from "@/features/command-manager/ManagerShell";
import { QuickPanel } from "@/features/quick-panel/QuickPanel";
import { UpdateDialog } from "@/features/updater/UpdateDialog";
import { autoCheckForUpdates } from "@/features/updater/updateStore";
import { useAppEvents } from "@/hooks/useAppEvents";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore } from "@/stores/appStore";

export default function App() {
  const bootStatus = useAppStore((state) => state.bootStatus);
  const snapshot = useAppStore((state) => state.snapshot);
  const uiMode = useAppStore((state) => state.uiMode);
  const initialize = useAppStore((state) => state.initialize);

  useTheme(snapshot?.settings.theme);
  useAppEvents();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (bootStatus === "ready") {
      autoCheckForUpdates();
    }
  }, [bootStatus]);

  if (bootStatus === "error") {
    return <BootErrorScreen />;
  }

  if (bootStatus !== "ready" || !snapshot) {
    return <LoadingScreen />;
  }

  return (
    <>
      {uiMode === "quick" ? <QuickPanel /> : <ManagerShell />}
      <UpdateDialog />
      <NoticeHost />
    </>
  );
}
