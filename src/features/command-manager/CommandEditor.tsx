import { X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { getCommandAnnotation } from "@/features/command-display/commandDisplay";
import type {
  CategoryNode,
  Command,
  CommandInput,
  CommandShell,
} from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";

const SHELLS: { value: CommandShell; label: string }[] = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Bash" },
  { value: "sh", label: "Shell" },
  { value: "zsh", label: "Zsh" },
  { value: "other", label: "其他" },
  { value: "unknown", label: "不显示" },
];

interface FlatCategory {
  id: string;
  label: string;
}

function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
  output: FlatCategory[] = [],
): FlatCategory[] {
  for (const node of nodes) {
    output.push({
      id: node.id,
      label: `${"— ".repeat(depth)}${node.name}`,
    });
    flattenCategories(node.children, depth + 1, output);
  }
  return output;
}

function tagsToInput(command?: Command | null): string {
  return command?.tags.map((tag) => tag.name).join(", ") ?? "";
}

function parseTags(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

interface CommandEditorProps {
  open: boolean;
  command: Command | null;
  categories: CategoryNode[];
  defaultCategoryId: string | null;
  onClose: () => void;
  onSave: (input: CommandInput) => Promise<void>;
}

export function CommandEditor({
  open,
  command,
  categories,
  defaultCategoryId,
  onClose,
  onSave,
}: CommandEditorProps) {
  const [title, setTitle] = useState("");
  const [commandText, setCommandText] = useState("");
  const [description, setDescription] = useState("");
  const [shell, setShell] = useState<CommandShell>("unknown");
  const [categoryId, setCategoryId] = useState<string>("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(command ? getCommandAnnotation(command) ?? "" : "");
    setCommandText(command?.command ?? "");
    setDescription(command?.description ?? "");
    setShell(command?.shell ?? "unknown");
    setCategoryId(command?.categoryId ?? defaultCategoryId ?? "");
    setTags(tagsToInput(command));
    setError(null);
    setSaving(false);
  }, [open, command, defaultCategoryId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, saving, onClose]);

  if (!open) {
    return null;
  }

  const flatCategories = flattenCategories(categories);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!commandText.trim()) {
      setError("请填写命令原文。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        command: commandText,
        description: description.trim(),
        shell,
        categoryId: categoryId || null,
        tags: parseTags(tags),
      });
    } catch (saveError) {
      setError(getUserErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 px-4 py-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <form
        onSubmit={(event) => void submit(event)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-editor-title"
        className="w-full max-w-[580px] rounded-lg border border-line bg-surface shadow-window"
      >
        <div className="flex h-11 items-center border-b border-line px-4">
          <h2
            id="command-editor-title"
            className="text-[13px] font-semibold text-ink"
          >
            {command ? "编辑命令" : "添加命令"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink disabled:opacity-50"
            aria-label="关闭编辑器"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-[11px] leading-4 text-ink-faint">
            只有命令原文是必填项。简短注释留空会自动从命令首行生成；Shell
            无法确定时选择“不显示”，列表中就不会出现 Shell 标签。
          </p>

          <Field label="命令原文" htmlFor="command-text">
            <textarea
              id="command-text"
              autoFocus
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              placeholder="docker compose restart api"
              rows={6}
              spellCheck={false}
              className={`${inputClass} resize-y font-mono text-[13px] leading-[1.6]`}
            />
          </Field>

          <Field label="简短注释（可选）" htmlFor="command-title">
            <input
              id="command-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：重启本地 API；留空则从命令首行自动生成"
              maxLength={200}
              className={inputClass}
            />
          </Field>

          <Field label="详细说明（可选）" htmlFor="command-description">
            <textarea
              id="command-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="使用前提、参数解释、注意事项等；可留空。"
              rows={2}
              className={`${inputClass} resize-y`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Shell" htmlFor="command-shell">
              <select
                id="command-shell"
                value={shell}
                onChange={(event) => setShell(event.target.value as CommandShell)}
                className={inputClass}
              >
                {SHELLS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="目录" htmlFor="command-category">
              <select
                id="command-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className={inputClass}
              >
                <option value="">默认</option>
                {flatCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] leading-3.5 text-ink-faint">
                未指定目录时归入系统“默认”目录。
              </p>
            </Field>
          </div>

          <Field label="标签" htmlFor="command-tags">
            <input
              id="command-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="用逗号分隔，例如：docker, 运维"
              className={inputClass}
            />
          </Field>

          {error ? (
            <p className="text-[11.5px] leading-4 text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? "保存中…" : command ? "保存修改" : "保存命令"}
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  "h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-ink-faint";

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
