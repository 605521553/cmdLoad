import { AlertTriangle, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { getCommandAnnotation } from "@/features/command-display/commandDisplay";
import type {
  AiAnnotationDraft,
  AiAnnotationParameter,
  AiRiskLevel,
  Command,
  GeneratedAiAnnotation,
  ManualAnnotationMode,
} from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage, toAppCommandError } from "@/utils/errors";

const RISK_LABELS: Record<AiRiskLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  unknown: "风险未知",
};

const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[11.5px] leading-4 text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-ink-faint";

function linesToArray(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

interface AiAnnotationPreviewDialogProps {
  command: Command;
  generated: GeneratedAiAnnotation;
  hasManualAnnotation: boolean;
  onClose: () => void;
  onApply: (
    generated: GeneratedAiAnnotation,
    mode: ManualAnnotationMode,
  ) => Promise<void>;
  onRegenerate: () => Promise<GeneratedAiAnnotation | null>;
}

export function AiAnnotationPreviewDialog({
  command,
  generated,
  hasManualAnnotation,
  onClose,
  onApply,
  onRegenerate,
}: AiAnnotationPreviewDialogProps) {
  const [shortDescription, setShortDescription] = useState(
    generated.shortDescription,
  );
  const [detailedDescription, setDetailedDescription] = useState(
    generated.detailedDescription,
  );
  const [parameters, setParameters] = useState<AiAnnotationParameter[]>(
    generated.parameters,
  );
  const [requirements, setRequirements] = useState(
    generated.requirements.join("\n"),
  );
  const [warnings, setWarnings] = useState(generated.warnings.join("\n"));
  const [manualMode, setManualMode] =
    useState<ManualAnnotationMode>("keep");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manualAnnotation = useMemo(
    () => getCommandAnnotation(command),
    [command],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !regenerating) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, regenerating, saving]);

  const apply = async () => {
    const short = shortDescription.trim();
    const detailed = detailedDescription.trim();
    if (!short) {
      setError("简短注释不能为空。");
      return;
    }
    if (short.length > 160) {
      setError("简短注释不能超过 160 个字符。");
      return;
    }
    if (!detailed) {
      setError("详细说明不能为空。");
      return;
    }
    if (detailed.length > 4000) {
      setError("详细说明不能超过 4,000 个字符。");
      return;
    }
    if (
      parameters.some(
        (parameter) =>
          !parameter.name.trim() && parameter.description.trim(),
      )
    ) {
      setError("参数说明缺少参数名。");
      return;
    }
    const draft: AiAnnotationDraft = {
      shortDescription: short,
      detailedDescription: detailed,
      parameters: parameters
        .map((parameter) => ({
          name: parameter.name.trim(),
          description: parameter.description.trim(),
        }))
        .filter((parameter) => parameter.name),
      requirements: linesToArray(requirements),
      warnings: linesToArray(warnings),
      suggestedShell: generated.suggestedShell,
      riskLevel: generated.riskLevel,
    };
    setSaving(true);
    setError(null);
    try {
      await onApply({ ...generated, ...draft }, manualMode);
    } catch (saveError) {
      setError(getUserErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const next = await onRegenerate();
      if (next) {
        setShortDescription(next.shortDescription);
        setDetailedDescription(next.detailedDescription);
        setParameters(next.parameters);
        setRequirements(next.requirements.join("\n"));
        setWarnings(next.warnings.join("\n"));
      }
    } catch (regenerateError) {
      const appError = toAppCommandError(regenerateError);
      if (appError.code !== "AI_CANCELLED") {
        setError(appError.message);
      }
    } finally {
      setRegenerating(false);
    }
  };

  const updateParameter = (
    index: number,
    patch: Partial<AiAnnotationParameter>,
  ) => {
    setParameters((current) =>
      current.map((parameter, position) =>
        position === index ? { ...parameter, ...patch } : parameter,
      ),
    );
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-6"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !saving &&
          !regenerating
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-preview-title"
        className="w-full max-w-[700px] rounded-lg border border-line bg-surface shadow-window"
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-4">
          <Sparkles className="size-4 text-ink-faint" />
          <h2
            id="ai-preview-title"
            className="text-[13px] font-semibold text-ink"
          >
            AI 注释预览
          </h2>
          <span className="text-[10px] text-ink-faint">
            {generated.provider} · {generated.model}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || regenerating}
            className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-50"
            aria-label="关闭预览"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="max-h-[calc(100vh-190px)] space-y-3 overflow-y-auto p-4">
          <section>
            <p className="ui-eyebrow mb-1">命令原文（不会修改）</p>
            <pre className="selectable max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-line bg-canvas p-2.5 font-mono text-[12px] leading-5 text-ink">
              {command.command}
            </pre>
          </section>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">
              简短注释
            </span>
            <input
              value={shortDescription}
              onChange={(event) => setShortDescription(event.target.value)}
              maxLength={160}
              className={inputClass}
              aria-label="AI 简短注释"
            />
            <span className="mt-0.5 block text-[9.5px] text-ink-faint">
              建议 15–40 个汉字；显示在命令下方。
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">
              详细说明
            </span>
            <textarea
              value={detailedDescription}
              onChange={(event) => setDetailedDescription(event.target.value)}
              rows={3}
              maxLength={4000}
              className={`${inputClass} resize-y`}
              aria-label="AI 详细说明"
            />
          </label>

          <section>
            <div className="mb-1 flex items-center">
              <p className="text-[11px] font-medium text-ink-muted">参数说明</p>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-1.5 text-[10px]"
                onClick={() =>
                  setParameters((current) => [
                    ...current,
                    { name: "", description: "" },
                  ])
                }
                disabled={parameters.length >= 24}
              >
                <Plus />
                添加
              </Button>
            </div>
            {parameters.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-2.5 py-2 text-[10.5px] text-ink-faint">
                没有识别到需要单独解释的参数。
              </p>
            ) : (
              <div className="space-y-1.5">
                {parameters.map((parameter, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[110px_minmax(0,1fr)_24px] gap-1.5"
                  >
                    <input
                      value={parameter.name}
                      onChange={(event) =>
                        updateParameter(index, { name: event.target.value })
                      }
                      placeholder="-a"
                      className={`${inputClass} font-mono`}
                      aria-label={`参数 ${index + 1} 名称`}
                    />
                    <input
                      value={parameter.description}
                      onChange={(event) =>
                        updateParameter(index, {
                          description: event.target.value,
                        })
                      }
                      placeholder="参数说明"
                      className={inputClass}
                      aria-label={`参数 ${index + 1} 说明`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setParameters((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                      className="flex items-center justify-center rounded text-ink-faint hover:bg-danger-soft hover:text-danger"
                      aria-label={`删除参数 ${index + 1}`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-ink-muted">
                执行前提
              </span>
              <textarea
                value={requirements}
                onChange={(event) => setRequirements(event.target.value)}
                rows={3}
                placeholder="每行一条"
                className={`${inputClass} resize-y`}
                aria-label="AI 执行前提"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-ink-muted">
                风险提示
              </span>
              <textarea
                value={warnings}
                onChange={(event) => setWarnings(event.target.value)}
                rows={3}
                placeholder="每行一条"
                className={`${inputClass} resize-y`}
                aria-label="AI 风险提示"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas/60 px-2.5 py-2 text-[10.5px] text-ink-muted">
            <span>
              建议 Shell：<strong className="font-medium text-ink">{generated.suggestedShell}</strong>
              （仅建议，不自动覆盖现有 Shell）
            </span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5",
                generated.riskLevel === "high"
                  ? "border-danger/30 bg-danger-soft text-danger"
                  : generated.riskLevel === "medium"
                    ? "border-amber/30 bg-amber-soft text-amber"
                    : "border-line bg-muted text-ink-muted",
              )}
            >
              {RISK_LABELS[generated.riskLevel]}
            </span>
          </div>

          {hasManualAnnotation ? (
            <fieldset className="rounded-md border border-amber/30 bg-amber-soft/50 px-2.5 py-2">
              <legend className="px-1 text-[11px] font-medium text-amber">
                已有手写注释
              </legend>
              <p className="mb-1.5 text-[10px] leading-4 text-ink-muted">
                现有手写注释：「{manualAnnotation ?? command.description}」。保存 AI
                注释不会自动覆盖它；请选择处理方式。
              </p>
              <div className="flex flex-wrap gap-3 text-[10.5px] text-ink-muted">
                {(
                  [
                    ["keep", "保留原注释（AI 结果单独保存）"],
                    ["append", "追加 AI 内容到现有注释"],
                    ["replace", "用 AI 内容替换现有注释"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="radio"
                      name="manual-annotation-mode"
                      value={value}
                      checked={manualMode === value}
                      onChange={() => setManualMode(value)}
                      className="accent-[var(--brand)]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {error ? (
            <p className="flex items-start gap-1 text-[11px] leading-4 text-danger" role="alert">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void regenerate()}
            disabled={saving || regenerating}
          >
            {regenerating ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {regenerating ? "重新生成中…" : "重新生成"}
          </Button>
          <span className="text-[9.5px] text-ink-faint">
            未确认前不会写入数据库或覆盖手写注释
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClose}
            disabled={saving || regenerating}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void apply()}
            disabled={saving || regenerating}
          >
            {saving ? "保存中…" : "应用并保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
