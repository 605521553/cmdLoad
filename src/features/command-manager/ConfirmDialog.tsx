import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, busy, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-[400px] rounded-lg border border-line bg-surface shadow-window"
      >
        <div className="flex h-10 items-center border-b border-line px-3.5">
          <h2
            id="confirm-dialog-title"
            className="text-[13px] font-semibold text-ink"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-50"
            aria-label="关闭确认框"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="px-3.5 py-3 text-[12px] leading-5 text-ink-muted">
          {description}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-3.5 py-2.5">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
