import {
  AlertTriangle,
  ChevronRight,
  CircleStop,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  Command,
  GeneratedAiAnnotation,
  ManualAnnotationMode,
} from "@/types/app";
import { cn } from "@/utils/cn";
import {
  toAppCommandError,
} from "@/utils/errors";
import { AiAnnotationPreviewDialog } from "./AiAnnotationPreviewDialog";

const RISK_LABELS: Record<string, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  unknown: "风险未知",
};

const SHELL_LABELS: Record<string, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  bash: "Bash",
  sh: "Shell",
  zsh: "Zsh",
  other: "其他",
  unknown: "未确定",
};

function requestIdFor() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface AiAnnotationSectionProps {
  command: Command;
  hasManualAnnotation: boolean;
  onSaved: (command: Command) => void;
}

export function AiAnnotationSection({
  command,
  hasManualAnnotation,
  onSaved,
}: AiAnnotationSectionProps) {
  const snapshot = useAppStore((state) => state.snapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const [generating, setGenerating] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratedAiAnnotation | null>(null);
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);

  const annotation = command.aiAnnotation;
  const pending = command.aiAnnotationStatus === "pending";
  const failed = command.aiAnnotationStatus === "failed";
  const configured = snapshot?.aiApiKeyConfigured ?? false;
  const canGenerate = configured && !pending && !generating;

  const risk = annotation?.riskLevel ?? "unknown";
  const riskClass =
    risk === "high"
      ? "border-danger/30 bg-danger-soft text-danger"
      : risk === "medium"
        ? "border-amber/30 bg-amber-soft text-amber"
        : "border-line bg-muted text-ink-muted";

  useEffect(() => {
    setGenerating(false);
    setRequestId(null);
    setPreview(null);
    setConfirmSensitive(false);
    setSensitiveConfirmed(false);
  }, [command.id]);

  const requestGeneration = async (
    allowSensitive: boolean,
  ): Promise<GeneratedAiAnnotation | null> => {
    if (!configured) {
      showNotice({
        kind: "info",
        message: "请先在设置中配置 API Key、Base URL 和模型。",
      });
      return null;
    }
    const id = requestIdFor();
    setGenerating(true);
    setRequestId(id);
    try {
      const generated = await appApi.generateAiAnnotation(
        command.id,
        id,
        allowSensitive,
      );
      setPreview(generated);
      if (allowSensitive) {
        setSensitiveConfirmed(true);
      }
      return generated;
    } catch (error) {
      const appError = toAppCommandError(error);
      if (appError.code === "AI_SENSITIVE_BLOCKED" && !allowSensitive) {
        setConfirmSensitive(true);
        return null;
      }
      if (appError.code !== "AI_CANCELLED") {
        showNotice({ kind: "error", message: appError.message });
      }
      return null;
    } finally {
      setGenerating(false);
      setRequestId(null);
    }
  };

  const cancelGeneration = async () => {
    if (!requestId) {
      return;
    }
    await appApi.cancelAiRequest(requestId);
  };

  const startGeneration = () => {
    void requestGeneration(false);
  };

  const confirmAndGenerate = async () => {
    setConfirmSensitive(false);
    await requestGeneration(true);
  };

  const regenerate = async (): Promise<GeneratedAiAnnotation | null> =>
    requestGeneration(sensitiveConfirmed);

  const applyAnnotation = async (
    generated: GeneratedAiAnnotation,
    mode: ManualAnnotationMode,
  ) => {
    const saved = await appApi.saveAiAnnotation(generated, mode);
    setPreview(null);
    showNotice({
      kind: "success",
      message:
        mode === "keep"
          ? "AI 注释已保存，手写注释保持不变"
          : mode === "append"
            ? "AI 注释已保存，并追加到现有注释"
            : "AI 注释已保存，并替换现有注释",
    });
    onSaved(saved);
  };

  const modelInfo = useMemo(() => {
    if (!annotation) {
      return [];
    }
    return [
      ["服务商", annotation.provider],
      ["模型", annotation.model],
      ["Prompt", annotation.promptVersion],
      [
        "生成时间",
        new Date(annotation.generatedAt).toLocaleString("zh-CN"),
      ],
      ["内容指纹", annotation.commandContentHash.slice(0, 16)],
    ];
  }, [annotation]);

  return (
    <>
      <section className="mt-3 border-t border-line/70 pt-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3 text-ink-faint" />
          <p className="ui-eyebrow">AI 解释</p>
          {annotation ? (
            <span
              className={cn(
                "ml-1 rounded border px-1 py-px text-[9px]",
                riskClass,
              )}
            >
              {RISK_LABELS[risk] ?? RISK_LABELS.unknown}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {generating ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => void cancelGeneration()}
              >
                <CircleStop />
                取消生成
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={startGeneration}
                disabled={!canGenerate}
                title={
                  !configured
                    ? "请先在设置中配置 AI 服务"
                    : pending
                      ? "AI 正在生成"
                      : annotation
                        ? "重新生成 AI 注释"
                        : "AI 生成注释"
                }
              >
                {annotation ? <RefreshCw /> : <Sparkles />}
                {annotation ? "重新生成" : "AI 生成注释"}
              </Button>
            )}
          </div>
        </div>

        {!configured ? (
          <p className="mt-1.5 rounded-md border border-line bg-canvas/50 px-2 py-1.5 text-[10px] leading-4 text-ink-faint">
            尚未配置 AI 服务。到设置 → AI 注释中填写 Base URL、模型和 API Key
            后即可生成。原有命令管理功能不受影响。
          </p>
        ) : null}

        {pending || generating ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-ink-muted">
            <LoaderCircle className="size-3 animate-spin" />
            {generating ? "正在请求 AI 并校验结构化结果…" : "AI 正在后台生成注释…"}
          </p>
        ) : null}

        {failed && !annotation ? (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-danger/20 bg-danger-soft px-2 py-1.5 text-[10.5px] leading-4 text-danger">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            上次自动生成失败，命令已保留。可以手动重新生成。
          </p>
        ) : null}

        {annotation ? (
          <div className="mt-2 space-y-2.5">
            {annotation.isStale ? (
              <p className="flex items-start gap-1.5 rounded-md border border-amber/30 bg-amber-soft px-2 py-1.5 text-[10.5px] leading-4 text-amber">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                命令原文在此注释生成后已修改，AI 注释可能过期。请重新生成。
              </p>
            ) : null}

            <section>
              <p className="mb-0.5 text-[10px] font-medium text-ink-muted">
                简短注释
              </p>
              <p className="selectable text-[11.5px] leading-[1.55] text-ink">
                {annotation.shortDescription}
              </p>
            </section>

            <section>
              <p className="mb-0.5 text-[10px] font-medium text-ink-muted">
                详细解释
              </p>
              <p className="selectable whitespace-pre-wrap break-words text-[11px] leading-[1.55] text-ink-muted">
                {annotation.detailedDescription}
              </p>
            </section>

            {annotation.parameters.length > 0 ? (
              <section>
                <p className="mb-1 text-[10px] font-medium text-ink-muted">
                  参数说明
                </p>
                <div className="space-y-1">
                  {annotation.parameters.map((parameter, index) => (
                    <div
                      key={`${parameter.name}-${index}`}
                      className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-1.5 text-[10px] leading-4"
                    >
                      <code className="rounded bg-muted px-1 py-px font-mono text-ink">
                        {parameter.name}
                      </code>
                      <span className="selectable text-ink-muted">
                        {parameter.description || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {annotation.requirements.length > 0 ? (
              <section>
                <p className="mb-0.5 text-[10px] font-medium text-ink-muted">
                  执行前提
                </p>
                <ul className="space-y-0.5">
                  {annotation.requirements.map((requirement, index) => (
                    <li
                      key={`${requirement}-${index}`}
                      className="flex items-start gap-1 text-[10px] leading-4 text-ink-muted"
                    >
                      <ChevronRight className="mt-0.5 size-2.5 shrink-0 text-ink-faint" />
                      {requirement}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {annotation.warnings.length > 0 ? (
              <section className="rounded-md border border-amber/20 bg-amber-soft/50 px-2 py-1.5">
                <p className="mb-0.5 text-[10px] font-medium text-amber">
                  风险提示
                </p>
                <ul className="space-y-0.5">
                  {annotation.warnings.map((warning, index) => (
                    <li
                      key={`${warning}-${index}`}
                      className="flex items-start gap-1 text-[10px] leading-4 text-ink-muted"
                    >
                      <AlertTriangle className="mt-0.5 size-2.5 shrink-0 text-amber" />
                      {warning}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5 text-[9.5px] text-ink-faint">
              <span className="rounded border border-line bg-canvas px-1.5 py-0.5">
                建议 Shell：{SHELL_LABELS[annotation.suggestedShell] ?? "未确定"}
              </span>
              <span>AI 建议不会自动修改 Shell</span>
            </div>

            <details className="group text-[10px] text-ink-faint">
              <summary className="flex cursor-pointer list-none items-center gap-0.5 hover:text-ink-muted">
                <ChevronRight className="size-2.5 transition-transform group-open:rotate-90" />
                AI 模型信息
              </summary>
              <dl className="mt-1 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-md border border-line/70 bg-canvas/45 px-2 py-1.5">
                {modelInfo.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt>{label}</dt>
                    <dd className="selectable truncate font-mono" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        ) : !pending && !generating && !failed ? (
          <p className="mt-1.5 text-[10.5px] leading-4 text-ink-faint">
            还没有 AI 注释。可以生成中文简短说明、参数解释和风险提示；预览确认后才会保存。
          </p>
        ) : null}
      </section>

      {preview ? (
        <AiAnnotationPreviewDialog
          key={`${preview.generatedAt}-${preview.shortDescription}`}
          command={command}
          generated={preview}
          hasManualAnnotation={hasManualAnnotation}
          onClose={() => setPreview(null)}
          onApply={applyAnnotation}
          onRegenerate={regenerate}
        />
      ) : null}

      <ConfirmDialog
        open={confirmSensitive}
        title="确认发送疑似敏感命令？"
        description={
          <>
            检测到该命令可能包含密码、Token、私钥或其他凭据。继续生成会把
            <strong className="mx-1 text-ink">完整命令原文</strong>
            发送到你配置的第三方 AI 服务（{snapshot?.settings.aiProvider ?? "AI"} ·{" "}
            {snapshot?.settings.aiModel ?? "未配置模型"}）。
            <br />
            <br />
            该请求无法撤回；请确认你有权处理其中的数据。敏感命令永远不会被自动发送。
          </>
        }
        confirmLabel="确认发送"
        danger
        busy={generating}
        onConfirm={() => void confirmAndGenerate()}
        onClose={() => {
          if (!generating) {
            setConfirmSensitive(false);
          }
        }}
      />
    </>
  );
}
