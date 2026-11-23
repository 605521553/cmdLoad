import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { useAppStore } from "@/stores/appStore";
import type { Command } from "@/types/app";

interface AiQuickConfirmDialogProps {
  open: boolean;
  command: Command | null;
  sensitive: boolean;
  hasManual: boolean;
  hasAi: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * One confirmation combines the two independent risks of the quick action:
 * sending a potentially sensitive command to a third party, and replacing an
 * annotation that is already present.
 */
export function AiQuickConfirmDialog({
  open,
  command,
  sensitive,
  hasManual,
  hasAi,
  onConfirm,
  onClose,
}: AiQuickConfirmDialogProps) {
  const snapshot = useAppStore((state) => state.snapshot);
  if (!command) {
    return null;
  }

  const provider = snapshot?.settings.aiProvider ?? "AI";
  const model = snapshot?.settings.aiModel ?? "未配置模型";
  const title = sensitive
    ? "确认发送并生成 AI 注释？"
    : hasManual || hasAi
      ? "确认覆盖现有注释？"
      : "确认生成 AI 注释？";

  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={
        <>
          {sensitive ? (
            <>
              检测到该命令可能包含密码、Token、私钥或其他凭据。继续会把
              <strong className="mx-1 text-ink">完整命令原文</strong>
              发送到第三方 AI 服务（{provider} · {model}），请求无法撤回。
            </>
          ) : null}
          {sensitive && (hasManual || hasAi) ? (
            <>
              <br />
              <br />
            </>
          ) : null}
          {hasManual ? (
            <>
              该命令已有手写注释。生成后将用 AI 注释覆盖当前简短/详细说明，并把
              <strong className="mx-1 text-ink">原手写内容保留</strong>
              在新详细说明末尾。
            </>
          ) : null}
          {hasManual && hasAi ? (
            <>
              <br />
              <br />
            </>
          ) : null}
          {hasAi ? (
            <>
              该命令已有 AI 注释，生成后会覆盖原 AI 注释。
            </>
          ) : null}
          <br />
          <br />
          <span className="text-[11px] text-ink-faint">
            原始命令文本不会被修改；AI 结果保存到本地注释表。
          </span>
        </>
      }
      confirmLabel={
        sensitive
          ? "确认发送并生成"
          : hasManual
            ? "覆盖并生成"
            : "重新生成"
      }
      danger={sensitive}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
