import { RotateCcw, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/common/BrandMark";
import { Button } from "@/components/ui/Button";
import { useAppStore } from "@/stores/appStore";

export function BootErrorScreen() {
  const bootError = useAppStore((state) => state.bootError);
  const initialize = useAppStore((state) => state.initialize);

  return (
    <div className="flex h-full items-center justify-center bg-canvas px-8">
      <div className="w-full max-w-md rounded-card border border-line bg-panel p-6 shadow-window">
        <div className="flex items-center gap-3">
          <BrandMark size={36} />
          <div>
            <p className="text-sm font-semibold text-ink">Pata Commands</p>
            <p className="text-xs text-ink-muted">本地服务暂不可用</p>
          </div>
        </div>

        <div className="mt-6 flex gap-3 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">无法读取应用状态</p>
            <p className="mt-1 break-words text-xs leading-5 text-ink-muted">
              {bootError ?? "请确认应用已通过桌面端启动，然后重试。"}
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-ink-muted">
          数据保存在本机，不会因为界面加载失败而丢失。若问题持续存在，请查看应用日志或重新启动程序。
        </p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button onClick={() => void initialize()}>
            <RotateCcw />
            重试
          </Button>
        </div>
      </div>
    </div>
  );
}
