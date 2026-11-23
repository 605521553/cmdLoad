import { Check, Plus, RotateCcw, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/utils/cn";
import { getUserErrorMessage } from "@/utils/errors";
import {
  MAX_CUSTOM_COLORS,
  MACARON_PALETTE,
  colorsEqual,
  findPresetColor,
  normalizeHexColor,
  readableInkFor,
  resolveCommandSurface,
} from "./palette";

interface ColorPaletteEditorProps {
  /** Active persisted color; `null` means the theme default. */
  value: string | null;
  customColors: string[];
  onPick: (color: string | null) => void | Promise<void>;
  onCustomApply: (color: string) => void | Promise<void>;
  onSaveToPalette: (color: string) => void | Promise<void>;
  onRemoveFromPalette: (color: string) => void | Promise<void>;
  onReorderPalette: (from: number, to: number) => void | Promise<void>;
  /** Label used by the live preview, e.g. "命令背景" or "目录图标色". */
  previewLabel?: string;
  /** True when a multi-selection has different colors; suppresses "default". */
  mixed?: boolean;
  disabled?: boolean;
}

export function ColorPaletteEditor({
  value,
  customColors,
  onPick,
  onCustomApply,
  onSaveToPalette,
  onRemoveFromPalette,
  onReorderPalette,
  previewLabel = "背景预览",
  mixed = false,
  disabled = false,
}: ColorPaletteEditorProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialCustom = value && !findPresetColor(value) ? value : "";
  const [customOpen, setCustomOpen] = useState(Boolean(initialCustom));
  const [draft, setDraft] = useState(initialCustom || value || "#EDF3FC");
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const hexRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value && !findPresetColor(value)) {
      setDraft(value);
    }
  }, [value]);

  const normalizedDraft = normalizeHexColor(draft);
  const draftSurface = useMemo(
    () => resolveCommandSurface(normalizedDraft),
    [normalizedDraft],
  );
  const busy = pending || disabled;
  const canSaveDraft =
    Boolean(normalizedDraft) &&
    !customColors.some((color) => colorsEqual(color, normalizedDraft)) &&
    customColors.length < MAX_CUSTOM_COLORS;

  const run = async (action: () => void | Promise<void>) => {
    if (busy) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(getUserErrorMessage(actionError));
    } finally {
      setPending(false);
    }
  };

  const openCustom = () => {
    setCustomOpen(true);
    window.setTimeout(() => {
      hexRef.current?.focus();
      hexRef.current?.select();
    }, 0);
  };

  const applyCustom = () => {
    if (!normalizedDraft) {
      setError("请输入有效的 HEX 颜色值，例如 #EDF3FC。");
      return;
    }
    void run(() => onCustomApply(normalizedDraft));
  };

  const saveDraft = () => {
    if (!normalizedDraft) {
      setError("请输入有效的 HEX 颜色值，例如 #EDF3FC。");
      return;
    }
    void run(() => onSaveToPalette(normalizedDraft));
  };

  const handleSwatchKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!event.altKey) {
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      void run(() => onReorderPalette(index, index - 1));
    } else if (event.key === "ArrowRight" && index < customColors.length - 1) {
      event.preventDefault();
      void run(() => onReorderPalette(index, index + 1));
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    if (draggingIndex === null || draggingIndex === index) {
      return;
    }
    const from = draggingIndex;
    setDraggingIndex(null);
    void run(() => onReorderPalette(from, index));
  };

  return (
    <div className="space-y-2.5" aria-busy={pending || undefined}>
      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className="ui-eyebrow">默认颜色</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onPick(null))}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[9.5px] text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-45"
          >
            <RotateCcw className="size-2.5" />
            重置
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          aria-pressed={!value && !mixed}
          aria-label="默认颜色"
          onClick={() => void run(() => onPick(null))}
          className={cn(
            "flex h-7 w-full items-center gap-2 rounded-md border px-2 text-left text-[10.5px] transition-colors",
            !value && !mixed
              ? "border-line-strong bg-muted/60 text-ink"
              : "border-line bg-canvas text-ink-muted hover:text-ink",
          )}
        >
          <span className="size-3.5 shrink-0 rounded-full border border-line-strong bg-[var(--panel)]" />
          跟随主题默认背景
          {!value && !mixed ? (
            <Check className="ml-auto size-3 text-success" />
          ) : null}
        </button>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className="ui-eyebrow">预设颜色</span>
          <span className="text-[9px] text-ink-faint">
            {mixed ? "多个值" : value ? normalizeHexColor(value) : "未设置"}
          </span>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {MACARON_PALETTE.map((preset) => {
            const active = colorsEqual(value, preset.commandLight);
            return (
              <button
                key={preset.id}
                type="button"
                disabled={busy}
                aria-label={`${preset.name} ${preset.commandLight}`}
                aria-pressed={active}
                title={`${preset.name} · ${preset.commandLight}`}
                onClick={() => void run(() => onPick(preset.commandLight))}
                className={cn(
                  "relative flex size-6 items-center justify-center rounded-full border transition-transform hover:scale-110 disabled:opacity-50",
                  active
                    ? "border-ink ring-2 ring-ink/15"
                    : "border-line-strong/70",
                )}
                style={{ background: preset.commandLight }}
              >
                {active ? (
                  <Check
                    className="size-3"
                    style={{ color: readableInkFor(preset.commandLight) }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className="ui-eyebrow">我的颜色</span>
          <button
            type="button"
            disabled={busy}
            onClick={openCustom}
            className="flex size-4 items-center justify-center rounded border border-dashed border-line-strong text-ink-faint transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-45"
            aria-label="添加自定义颜色"
            title="添加自定义颜色"
          >
            <Plus className="size-2.5" />
          </button>
        </div>
        {customColors.length === 0 ? (
          <p className="rounded border border-dashed border-line px-2 py-1.5 text-[9.5px] leading-4 text-ink-faint">
            还没有保存的颜色。调色盘里选好后点击“保存到我的颜色”。
          </p>
        ) : (
          <div className="grid grid-cols-8 gap-1">
            {customColors.map((color, index) => {
              const active = colorsEqual(value, color);
              return (
                <div
                  key={color}
                  draggable={!busy}
                  onDragStart={() => setDraggingIndex(index)}
                  onDragEnd={() => setDraggingIndex(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => handleDrop(event, index)}
                  className={cn(
                    "group/swatch relative",
                    draggingIndex === index && "opacity-40",
                  )}
                  title={`${color} · 拖动排序`}
                >
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`我的颜色 ${color}`}
                    aria-pressed={active}
                    onClick={() => void run(() => onPick(color))}
                    onKeyDown={(event) => handleSwatchKeyDown(event, index)}
                    className={cn(
                      "flex size-6 cursor-grab items-center justify-center rounded-full border transition-transform hover:scale-110 active:cursor-grabbing disabled:opacity-50",
                      active
                        ? "border-ink ring-2 ring-ink/15"
                        : "border-line-strong/70",
                    )}
                    style={{ background: color }}
                  >
                    {active ? (
                      <Check
                        className="size-3"
                        style={{ color: readableInkFor(color) }}
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => onRemoveFromPalette(color))}
                    className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full border border-line bg-surface text-ink-faint opacity-0 shadow-sm transition-[opacity,color] hover:text-danger focus:pointer-events-auto focus:opacity-100 group-hover/swatch:pointer-events-auto group-hover/swatch:opacity-100 disabled:opacity-50"
                    aria-label={`从我的颜色中删除 ${color}`}
                    title="从我的颜色中删除"
                  >
                    <X className="size-2" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {customOpen ? (
        <section className="rounded-md border border-line bg-canvas/60 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="ui-eyebrow">自定义颜色</span>
            <button
              type="button"
              onClick={() => setCustomOpen(false)}
              className="rounded p-0.5 text-ink-faint hover:bg-muted hover:text-ink"
              aria-label="收起自定义颜色"
            >
              <X className="size-2.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={normalizedDraft ?? "#EDF3FC"}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              aria-label="调色盘"
              className="size-7 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0"
            />
            <input
              ref={hexRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyCustom();
                }
              }}
              spellCheck={false}
              maxLength={7}
              placeholder="#EDF3FC"
              aria-label="HEX 颜色值"
              className={cn(
                "h-7 min-w-0 flex-1 rounded border bg-surface px-1.5 font-mono text-[11px] uppercase text-ink outline-none",
                normalizedDraft
                  ? "border-line focus:border-ink-faint"
                  : "border-danger/60",
              )}
            />
          </div>
          <div className="mt-1.5">
            <span className="text-[9px] text-ink-faint">{previewLabel}</span>
            <div
              className={cn(
                "mt-1 flex h-7 items-center rounded-md border border-line/80 px-2 text-[10px] text-ink",
                draftSurface && "command-tint",
              )}
              style={
                draftSurface
                  ? ({
                      "--command-tint-light": draftSurface.light,
                      "--command-tint-dark": draftSurface.dark,
                    } as CSSProperties)
                  : undefined
              }
            >
              {normalizedDraft ?? "无效颜色"}
            </div>
          </div>
          {normalizedDraft ? null : (
            <p className="mt-1 text-[9px] leading-3.5 text-danger">
              颜色需为 #RRGGBB 或 #RGB 格式。
            </p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy || !canSaveDraft}
              onClick={saveDraft}
              className="flex h-6 items-center gap-1 rounded border border-line bg-surface px-1.5 text-[10px] text-ink-muted transition-colors hover:text-ink disabled:opacity-45"
              title={
                customColors.some((color) => colorsEqual(color, normalizedDraft))
                  ? "该颜色已在个人色板中"
                  : customColors.length >= MAX_CUSTOM_COLORS
                    ? "个人色板已满"
                    : "保存到我的颜色"
              }
            >
              <Plus className="size-2.5" />
              保存到我的颜色
            </button>
            <button
              type="button"
              disabled={busy || !normalizedDraft}
              onClick={applyCustom}
              className="ml-auto flex h-6 items-center gap-1 rounded bg-brand px-2 text-[10px] font-medium text-brand-contrast transition-opacity hover:opacity-90 disabled:opacity-45"
            >
              {pending ? "应用中…" : "应用"}
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={openCustom}
          className="w-full rounded-md border border-dashed border-line py-1.5 text-[10px] text-ink-faint transition-colors hover:border-line-strong hover:text-ink disabled:opacity-45"
        >
          自定义颜色…（调色盘 / HEX）
        </button>
      )}

      {error ? (
        <p className="rounded border border-danger/20 bg-danger-soft px-2 py-1 text-[9.5px] leading-4 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
