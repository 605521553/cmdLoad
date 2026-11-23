import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import type { ClipboardItem } from "@/types/app";

interface SensitiveClipboardDialogProps {
  item: ClipboardItem | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmation shared by the quick panel and the manager clipboard page. */
export function SensitiveClipboardDialog({
  item,
  busy,
  onConfirm,
  onClose,
}: SensitiveClipboardDialogProps) {
  return (
    <ConfirmDialog
      open={item !== null}
      title="疑似包含敏感信息"
      description={
        item ? (
          <div className="space-y-2">
            <p>
              这段内容可能包含密码、令牌或私钥。它不会被缓存到本地历史，也不会发送到任何 AI
              服务。只有你确认后才会写入永久命令库的“默认”目录。
            </p>
            <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded border border-line bg-muted px-2 py-1.5 font-mono text-[11px] leading-4 text-ink-muted">
              {item.content.slice(0, 500)}
              {item.content.length > 500 ? "…" : ""}
            </pre>
          </div>
        ) : null
      }
      confirmLabel="仍然保存"
      danger
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
