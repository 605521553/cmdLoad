import { BrandMark } from "@/components/common/BrandMark";

export function LoadingScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-canvas">
      <BrandMark size={48} className="shadow-window" />
      <div className="text-center">
        <p className="text-sm font-medium text-ink">正在打开 Pata Commands</p>
        <p className="mt-1 text-xs text-ink-muted">恢复本地工作区与会话状态</p>
      </div>
      <div className="loading-track h-px w-36 bg-line" aria-hidden="true" />
    </div>
  );
}
