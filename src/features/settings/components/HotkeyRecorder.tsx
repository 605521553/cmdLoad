import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ShortcutKeys } from "@/components/common/ShortcutKeys";
import { Button } from "@/components/ui/Button";
import { getUserErrorMessage } from "@/utils/errors";
import { captureShortcut, isSameShortcut } from "@/utils/hotkeys";
import { cn } from "@/utils/cn";

interface HotkeyRecorderProps {
  currentShortcut: string;
  registered: boolean;
  disabled?: boolean;
  onSave: (shortcut: string) => Promise<void>;
}

export function HotkeyRecorder({
  currentShortcut,
  registered,
  disabled = false,
  onSave,
}: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [candidate, setCandidate] = useState(currentShortcut);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recording) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) {
        return;
      }

      if (event.key === "Escape") {
        setRecording(false);
        setCandidate(currentShortcut);
        setHint(null);
        setError(null);
        return;
      }

      const result = captureShortcut(event);
      if (result.status === "modifier-only") {
        setHint("继续按下字母、数字或功能键");
        setError(null);
        return;
      }
      if (result.status === "unsupported" || !result.shortcut) {
        setHint(null);
        setError(result.message ?? "无法使用这个按键组合。");
        return;
      }

      setCandidate(result.shortcut);
      setHint(null);
      setError(null);
      setRecording(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, currentShortcut]);

  const startRecording = () => {
    setRecording(true);
    setCandidate(currentShortcut);
    setHint("请按下新的快捷键组合");
    setError(null);
  };

  const cancelRecording = () => {
    setRecording(false);
    setCandidate(currentShortcut);
    setHint(null);
    setError(null);
  };

  const hasChange =
    !isSameShortcut(candidate, currentShortcut) ||
    (!registered && isSameShortcut(candidate, currentShortcut));
  const controlsDisabled = disabled || saving;

  const applyShortcut = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(candidate);
      setHint("快捷键已更新");
    } catch (saveError) {
      setError(getUserErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-line/70 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-5 text-ink">全局呼出快捷键</p>
          <p className="mt-0.5 text-[12px] leading-[18px] text-ink-muted">
            在其他应用中呼出快捷面板，再次触发可隐藏。
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {recording ? (
            <div
              className="flex h-7 min-w-[150px] items-center justify-center gap-1.5 rounded-md border border-dashed border-ink-faint bg-muted/60 px-2.5 text-[10.5px] font-medium text-ink"
              role="status"
              aria-live="polite"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-ink" />
              正在录入…
            </div>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={controlsDisabled}
              className={cn(
                "group flex h-7 min-w-[150px] items-center justify-between gap-2 rounded-md border border-line bg-surface px-2 transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50",
                !registered && "border-amber/40",
              )}
              title="点击后输入新的快捷键组合"
            >
              <ShortcutKeys
                shortcut={candidate}
                className="[&_kbd]:h-[17px] [&_kbd]:text-[9px]"
              />
              <Pencil className="size-3 text-ink-faint transition-colors group-hover:text-ink-muted" />
            </button>
          )}

          {recording ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelRecording}
              aria-label="取消录入快捷键"
            >
              <X />
              取消
            </Button>
          ) : (
            <>
              {candidate !== currentShortcut ? (
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => {
                    setCandidate(currentShortcut);
                    setHint(null);
                    setError(null);
                  }}
                  disabled={controlsDisabled}
                  aria-label="恢复当前快捷键"
                  title="恢复"
                >
                  <RotateCcw />
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                onClick={() => void applyShortcut()}
                disabled={controlsDisabled || !hasChange}
              >
                {saving ? "应用中…" : "应用"}
                {!saving ? <Check /> : null}
              </Button>
            </>
          )}
        </div>
      </div>

      {!registered ? (
        <p className="mt-1.5 text-[10.5px] text-amber" role="status">
          当前组合没有成功注册，请输入新组合并应用。
        </p>
      ) : null}
      {hint ? (
        <p className="mt-1.5 text-[10.5px] text-ink-muted" role="status">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-[10.5px] leading-4 text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-1 text-[10px] leading-4 text-ink-faint">
        组合需包含 Ctrl、Alt 或 Win；录入时按 Esc 取消。
      </p>
    </div>
  );
}
