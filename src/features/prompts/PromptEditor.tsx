import { X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { MACARON_PALETTE, colorsEqual, normalizeHexColor } from "@/features/appearance/palette";
import { flattenCategoryOptions } from "@/features/command-manager/categoryUtils";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import type { CategoryNode, Prompt, PromptInput } from "@/types/app";
import { cn } from "@/utils/cn";
import { getUserErrorMessage } from "@/utils/errors";

const inputClass =
  "h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-ink-faint";

function tagsToInput(prompt?: Prompt | null): string {
  return prompt?.tags.map((tag) => tag.name).join(", ") ?? "";
}

function parseTags(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

interface PromptEditorProps {
  open: boolean;
  prompt: Prompt | null;
  categories: CategoryNode[];
  defaultCategoryId: string | null;
  onClose: () => void;
  onSave: (input: PromptInput) => Promise<void>;
}

export function PromptEditor({
  open,
  prompt,
  categories,
  defaultCategoryId,
  onClose,
  onSave,
}: PromptEditorProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [initial, setInitial] = useState({
    title: "",
    content: "",
    categoryId: "",
    tags: "",
    favorite: false,
    backgroundColor: null as string | null,
  });

  const flatCategories = useMemo(
    () => flattenCategoryOptions(categories),
    [categories],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const next = {
      title: prompt?.title ?? "",
      content: prompt?.content ?? "",
      categoryId: prompt?.categoryId ?? defaultCategoryId ?? "",
      tags: tagsToInput(prompt),
      favorite: prompt?.isFavorite ?? false,
      backgroundColor: prompt?.backgroundColor ?? null,
    };
    setInitial(next);
    setTitle(next.title);
    setContent(next.content);
    setCategoryId(next.categoryId);
    setTags(next.tags);
    setFavorite(next.favorite);
    setBackgroundColor(next.backgroundColor);
    setError(null);
    setSaving(false);
    setConfirmDiscard(false);
    window.setTimeout(() => textareaRef.current?.focus(), 20);
  }, [open, prompt, defaultCategoryId]);

  const dirty =
    title !== initial.title ||
    content !== initial.content ||
    categoryId !== initial.categoryId ||
    tags !== initial.tags ||
    favorite !== initial.favorite ||
    !colorsEqual(backgroundColor, initial.backgroundColor);

  const requestClose = () => {
    if (saving) {
      return;
    }
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }
      if (event.key === "Escape" && !confirmDiscard) {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      const isSave =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (isSave && !saving && !confirmDiscard) {
        event.preventDefault();
        event.stopPropagation();
        const form = document.getElementById(
          "prompt-editor-form",
        ) as HTMLFormElement | null;
        form?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  if (!open) {
    return null;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) {
      setError("请填写提示词内容。");
      textareaRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        content,
        categoryId: categoryId || null,
        tags: parseTags(tags),
        backgroundColor: normalizeHexColor(backgroundColor ?? "") ?? null,
        favorite,
      });
    } catch (saveError) {
      setError(getUserErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 px-4 py-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            requestClose();
          }
        }}
      >
        <form
          id="prompt-editor-form"
          onSubmit={(event) => void submit(event)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-editor-title"
          className="flex max-h-[calc(100vh-48px)] w-full max-w-[720px] flex-col rounded-lg border border-line bg-surface shadow-window"
        >
          <div className="flex h-11 shrink-0 items-center border-b border-line px-4">
            <h2
              id="prompt-editor-title"
              className="text-[13px] font-semibold text-ink"
            >
              {prompt ? "编辑提示词" : "添加提示词"}
            </h2>
            <p className="ml-3 hidden text-[10px] text-ink-faint sm:block">
              Ctrl+S 保存 · Esc 取消
            </p>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-50"
              aria-label="关闭提示词编辑器"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <p className="rounded border border-line bg-canvas px-2.5 py-1.5 text-[10.5px] leading-4 text-ink-muted">
              只有提示词正文是必填项。标题、目录、标签和颜色都可以留空；正文会保留原始换行、空格、Markdown
              和代码块。
            </p>

            <Field label="标题（可选）" htmlFor="prompt-title">
              <input
                id="prompt-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：代码审查提示词；留空时直接显示正文"
                maxLength={200}
                className={inputClass}
              />
            </Field>

            <Field label="提示词内容" htmlFor="prompt-content">
              <textarea
                ref={textareaRef}
                id="prompt-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={
                  "请你作为一名经验丰富的软件工程师，检查以下代码中可能存在的逻辑问题、性能问题以及潜在的安全风险……"
                }
                rows={16}
                spellCheck={false}
                className="min-h-[280px] w-full resize-y rounded-md border border-line bg-canvas px-3 py-2.5 font-sans text-[13px] leading-[1.7] text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-ink-faint"
              />
              <div className="mt-1 flex items-center justify-between text-[9.5px] text-ink-faint">
                <span>支持中文、英文、Markdown 与代码块</span>
                <span className="tabular-nums">
                  {content.length.toLocaleString("zh-CN")} 字符 ·{" "}
                  {content.split(/\r?\n/).length} 行
                </span>
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="目录" htmlFor="prompt-category">
                <select
                  id="prompt-category"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">默认</option>
                  {flatCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {"— ".repeat(category.depth)}
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="标签" htmlFor="prompt-tags">
                <input
                  id="prompt-tags"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="用逗号分隔，例如：论文, 润色"
                  className={inputClass}
                />
              </Field>
            </div>

            <div>
              <span className="mb-1 block text-[11px] font-medium text-ink-muted">
                背景颜色
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={backgroundColor === null}
                  onClick={() => setBackgroundColor(null)}
                  className={cn(
                    "h-6 rounded-md border px-2 text-[10px] transition-colors",
                    backgroundColor === null
                      ? "border-ink bg-surface text-ink"
                      : "border-line bg-canvas text-ink-muted hover:border-line-strong",
                  )}
                >
                  无背景
                </button>
                {MACARON_PALETTE.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.name}
                    aria-label={`${preset.name} ${preset.commandLight}`}
                    aria-pressed={colorsEqual(
                      backgroundColor,
                      preset.commandLight,
                    )}
                    onClick={() => setBackgroundColor(preset.commandLight)}
                    style={{ backgroundColor: preset.commandLight }}
                    className={cn(
                      "size-6 rounded-md border transition-transform hover:scale-105",
                      colorsEqual(backgroundColor, preset.commandLight)
                        ? "border-ink ring-1 ring-ink/30"
                        : "border-line",
                    )}
                  />
                ))}
                <label className="ml-1 flex items-center gap-1 text-[10px] text-ink-faint">
                  自定义
                  <input
                    type="color"
                    aria-label="自定义背景颜色"
                    value={backgroundColor ?? "#FFFFFF"}
                    onChange={(event) =>
                      setBackgroundColor(
                        normalizeHexColor(event.target.value) ??
                          event.target.value,
                      )
                    }
                    className="h-6 w-7 cursor-pointer rounded border border-line bg-canvas p-0"
                  />
                </label>
              </div>
            </div>

            <label className="flex w-fit cursor-pointer items-center gap-2 text-[11.5px] text-ink-muted">
              <input
                type="checkbox"
                checked={favorite}
                onChange={(event) => setFavorite(event.target.checked)}
                className="accent-[var(--brand)]"
              />
              收藏这条提示词
            </label>

            {error ? (
              <p className="text-[11.5px] leading-4 text-danger" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={requestClose}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? "保存中…" : prompt ? "保存修改" : "保存提示词"}
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="放弃未保存的修改？"
        description="提示词内容有未保存的修改。关闭编辑会后这些修改会丢失。"
        confirmLabel="放弃修改"
        danger
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onClose={() => setConfirmDiscard(false)}
      />
    </>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] font-medium text-ink-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
