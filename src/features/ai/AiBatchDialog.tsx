import {
  AlertTriangle,
  CircleStop,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { Command } from "@/types/app";
import { cn } from "@/utils/cn";
import { toAppCommandError } from "@/utils/errors";
import {
  partitionBatchCandidates,
  type BatchPartition,
} from "./batch";

interface AiBatchDialogProps {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}

interface BatchProgress {
  done: number;
  succeeded: number;
  failed: number;
  skippedSensitive: number;
  errors: string[];
}

const EMPTY_PROGRESS: BatchProgress = {
  done: 0,
  succeeded: 0,
  failed: 0,
  skippedSensitive: 0,
  errors: [],
};

function requestIdFor() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AiBatchDialog({ open, commands, onClose }: AiBatchDialogProps) {
  const snapshot = useAppStore((state) => state.snapshot);
  const partition = useMemo(
    () => partitionBatchCandidates(commands),
    [commands],
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [total, setTotal] = useState(0);
  const [runSummary, setRunSummary] = useState<BatchPartition | null>(null);
  const [progress, setProgress] = useState<BatchProgress>(EMPTY_PROGRESS);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const cancelRequested = useRef(false);
  const configured = snapshot?.aiApiKeyConfigured ?? false;

  useEffect(() => {
    if (!open) {
      if (!running) {
        setFinished(false);
        setProgress(EMPTY_PROGRESS);
        setCurrentId(null);
      }
      return;
    }
    setFinished(false);
    setStopped(false);
    setTotal(0);
    setRunSummary(null);
    setProgress(EMPTY_PROGRESS);
    setCurrentId(null);
    cancelRequested.current = false;
    // Resetting on open is the desired behavior; commands are snapshotted when
    // the run starts so data refreshes cannot change the batch midway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return null;
  }

  const summary = runSummary ?? partition;

  const start = async () => {
    const plan = partition.eligible;
    if (!configured || plan.length === 0 || running) {
      return;
    }
    setRunning(true);
    setFinished(false);
    setStopped(false);
    setRunSummary(partition);
    setTotal(plan.length);
    setProgress(EMPTY_PROGRESS);
    cancelRequested.current = false;
    let update = { ...EMPTY_PROGRESS };
    for (const command of plan) {
      if (cancelRequested.current) {
        break;
      }
      setCurrentId(command.id);
      const requestId = requestIdFor();
      setCurrentRequestId(requestId);
      try {
        const generated = await appApi.generateAiAnnotation(
          command.id,
          requestId,
          false,
        );
        if (cancelRequested.current) {
          break;
        }
        await appApi.saveAiAnnotation(generated, "keep");
        update = {
          ...update,
          done: update.done + 1,
          succeeded: update.succeeded + 1,
        };
      } catch (error) {
        const appError = toAppCommandError(error);
        if (appError.code === "AI_CANCELLED") {
          break;
        }
        if (appError.code === "AI_SENSITIVE_BLOCKED") {
          update = {
            ...update,
            done: update.done + 1,
            skippedSensitive: update.skippedSensitive + 1,
          };
        } else {
          update = {
            ...update,
            done: update.done + 1,
            failed: update.failed + 1,
            errors:
              update.errors.length < 3
                ? [...update.errors, `${command.title}: ${appError.message}`]
                : update.errors,
          };
        }
      }
      setProgress(update);
      setCurrentRequestId(null);
    }
    setCurrentRequestId(null);
    setCurrentId(null);
    setRunning(false);
    setFinished(true);
  };

  const stop = async () => {
    cancelRequested.current = true;
    setStopped(true);
    if (currentRequestId) {
      await appApi.cancelAiRequest(currentRequestId);
    }
  };

  const close = () => {
    if (running) {
      return;
    }
    onClose();
  };

  const currentIndex = progress.done;
  const percent =
    total === 0 ? 0 : Math.min(100, Math.round((currentIndex / total) * 100));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) {
          close();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-batch-title"
        className="w-full max-w-[460px] rounded-lg border border-line bg-surface shadow-window"
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-4">
          <Sparkles className="size-4 text-ink-faint" />
          <h2 id="ai-batch-title" className="text-[13px] font-semibold text-ink">
            批量生成 AI 注释
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={running}
            className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-40"
            aria-label="关闭批量生成"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <p className="text-[11px] leading-4 text-ink-muted">
            只为所选命令中没有注释的命令生成说明。已有手写注释或已生成 AI
            注释的命令会自动跳过；批量模式不会弹出预览，成功结果直接保存。
          </p>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="可生成" value={summary.eligible.length} />
            <Metric label="已有注释" value={summary.skippedAnnotated} />
            <Metric label="生成中" value={summary.skippedPending} />
          </div>

          {!configured ? (
            <p className="flex items-start gap-1.5 rounded-md border border-amber/30 bg-amber-soft px-2 py-1.5 text-[10.5px] leading-4 text-amber">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              尚未配置 API Key。请先在设置 → AI 注释中完成配置。
            </p>
          ) : null}

          {partition.eligible.length > 0 && !runSummary ? (
            <p className="text-[10px] leading-4 text-ink-faint">
              将为 {partition.eligible.length} 条命令依次发起请求；疑似包含密码、Token
              或私钥的命令会被本地拦截并跳过，不会发送。批量请求会计入你的 API 用量。
            </p>
          ) : null}
          {!runSummary && partition.eligible.length === 0 ? (
            <p className="rounded-md border border-line bg-canvas/60 px-2.5 py-2 text-[10.5px] text-ink-muted">
              所选命令都已有注释或正在生成，没有需要处理的内容。
            </p>
          ) : null}

          {running || finished ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10.5px] text-ink-muted">
                <span>
                  {running
                    ? `正在生成${currentId ? "…" : ""}`
                    : stopped
                      ? "已停止"
                      : "批量生成完成"}
                </span>
                <span className="tabular-nums">
                  {currentIndex} / {total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
                <span>成功 {progress.succeeded}</span>
                <span>失败 {progress.failed}</span>
                <span>敏感跳过 {progress.skippedSensitive}</span>
              </div>
              {progress.errors.length > 0 ? (
                <ul className="space-y-0.5 rounded-md border border-danger/20 bg-danger-soft px-2 py-1.5 text-[9.5px] leading-4 text-danger">
                  {progress.errors.map((error, index) => (
                    <li key={index} className="break-words">
                      {error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          {running ? (
            <Button variant="danger" size="sm" onClick={() => void stop()}>
              <CircleStop />
              停止
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={close}>
                {finished ? "关闭" : "取消"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void start()}
                disabled={
                  !configured ||
                  partition.eligible.length === 0 ||
                  finished
                }
              >
                {running ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                {finished ? "已完成" : "开始生成"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-canvas/60 px-2 py-1.5">
      <p
        className={cn(
          "text-[15px] font-semibold tabular-nums leading-5 text-ink",
          value === 0 && "text-ink-faint",
        )}
      >
        {value}
      </p>
      <p className="text-[9.5px] text-ink-faint">{label}</p>
    </div>
  );
}
