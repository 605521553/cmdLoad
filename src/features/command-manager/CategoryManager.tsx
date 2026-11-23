import {
  Check,
  CornerDownRight,
  FolderPlus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { CategoryIcon } from "@/features/appearance/CategoryIcon";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  CategoryChildAction,
  CategoryCommandAction,
  CategoryNode,
} from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";

interface FlatCategory {
  node: CategoryNode;
  depth: number;
}

function flatten(
  nodes: CategoryNode[],
  depth = 0,
  output: FlatCategory[] = [],
): FlatCategory[] {
  for (const node of nodes) {
    output.push({ node, depth });
    flatten(node.children, depth + 1, output);
  }
  return output;
}

interface CategoryManagerProps {
  open: boolean;
  /** Which independent library the tree belongs to. */
  scope?: "command" | "prompt";
  categories: CategoryNode[];
  onClose: () => void;
  onChanged: () => void;
  initialParentId?: string | null;
  initialEditId?: string | null;
  initialDeleteId?: string | null;
}

function findCategory(
  nodes: CategoryNode[],
  id: string | null | undefined,
): CategoryNode | null {
  if (!id) {
    return null;
  }
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findCategory(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function subtreeCommandCount(node: CategoryNode): number {
  return (
    node.commandCount +
    node.children.reduce((total, child) => total + subtreeCommandCount(child), 0)
  );
}

function descendantCategoryCount(node: CategoryNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + descendantCategoryCount(child),
    0,
  );
}

export function CategoryManager({
  open,
  scope = "command",
  categories,
  onClose,
  onChanged,
  initialParentId = null,
  initialEditId = null,
  initialDeleteId = null,
}: CategoryManagerProps) {
  const showNotice = useAppStore((state) => state.showNotice);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CategoryNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [commandAction, setCommandAction] =
    useState<CategoryCommandAction>("unclassified");
  const [childAction, setChildAction] =
    useState<CategoryChildAction>("promote");
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  const flat = useMemo(() => flatten(categories), [categories]);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    const editTarget = findCategory(categories, initialEditId);
    const deleteTargetNode = findCategory(categories, initialDeleteId);
    setName("");
    setParentId(initialParentId ?? "");
    setEditingId(editTarget?.id ?? null);
    setEditingName(editTarget?.name ?? "");
    setDeleteTarget(deleteTargetNode);
    setCommandAction(
      deleteTargetNode?.parentId ? "moveToParent" : "unclassified",
    );
    setChildAction("promote");
    if (initialParentId) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, categories, initialParentId, initialEditId, initialDeleteId]);

  const focusCreate = (parent: string) => {
    setParentId(parent);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (!open) {
    return null;
  }

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      showNotice({ kind: "error", message: "请填写目录名称。" });
      return;
    }
    setCreating(true);
    try {
      const input = {
        name: name.trim(),
        parentId: parentId || null,
      };
      if (scope === "prompt") {
        await appApi.createPromptCategory(input);
      } else {
        await appApi.createCategory(input);
      }
      setName("");
      showNotice({ kind: "success", message: "目录已创建" });
      onChanged();
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setCreating(false);
    }
  };

  const saveRename = async (id: string) => {
    if (!editingName.trim()) {
      showNotice({ kind: "error", message: "目录名称不能为空。" });
      return;
    }
    setSavingRename(true);
    try {
      if (scope === "prompt") {
        await appApi.updatePromptCategory(id, { name: editingName.trim() });
      } else {
        await appApi.updateCategory(id, { name: editingName.trim() });
      }
      setEditingId(null);
      showNotice({ kind: "success", message: "目录已重命名" });
      onChanged();
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setSavingRename(false);
    }
  };

  const openDeleteTarget = (node: CategoryNode) => {
    setDeleteTarget(node);
    setCommandAction(node.parentId ? "moveToParent" : "unclassified");
    setChildAction("promote");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      const options = { commandAction, childAction };
      if (scope === "prompt") {
        const report = await appApi.deletePromptCategoryWithOptions(
          deleteTarget.id,
          options,
        );
        showNotice({
          kind: "success",
          message:
            report.deletedCategories > 1
              ? `已删除 ${report.deletedCategories} 个目录，${report.movedPrompts} 条提示词已移动。`
              : report.movedPrompts > 0
                ? `目录已删除，${report.movedPrompts} 条提示词已移动。`
                : "目录已删除。",
        });
      } else {
        const report = await appApi.deleteCategoryWithOptions(
          deleteTarget.id,
          options,
        );
        showNotice({
          kind: "success",
          message:
            report.deletedCategories > 1
              ? `已删除 ${report.deletedCategories} 个目录，${report.movedCommands} 条命令已移动。`
              : report.movedCommands > 0
                ? `目录已删除，${report.movedCommands} 条命令已移动。`
                : "目录已删除。",
        });
      }
      setDeleteTarget(null);
      onChanged();
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setDeleting(false);
    }
  };

  const itemLabel = scope === "prompt" ? "提示词" : "命令";

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 px-4 py-10"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-manager-title"
          className="w-full max-w-[500px] rounded-lg border border-line bg-surface shadow-window"
        >
          <div className="flex h-10 items-center border-b border-line px-3.5">
            <h2
              id="category-manager-title"
              className="text-[13px] font-semibold text-ink"
            >
              目录结构
              <span className="ml-1.5 text-[10px] font-normal text-ink-faint">
                {itemLabel}
              </span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-muted hover:text-ink"
              aria-label="关闭目录结构"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <form
            onSubmit={(event) => void create(event)}
            className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5"
          >
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="新目录名称"
              maxLength={80}
              className="h-7 min-w-[140px] flex-1 rounded-md border border-line bg-canvas px-2 text-[12px] text-ink outline-none focus:border-ink-faint"
              aria-label="新目录名称"
            />
            <select
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              aria-label="父目录"
              className="h-7 max-w-[170px] rounded-md border border-line bg-canvas px-1.5 text-[11px] text-ink-muted outline-none"
            >
              <option value="">根目录</option>
              {flat.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>
                  {"— ".repeat(depth)}
                  {node.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" size="sm" disabled={creating}>
              <FolderPlus />
              {creating ? "添加中…" : "添加"}
            </Button>
          </form>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {flat.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-ink-faint">
                还没有目录。可以先创建一级目录，再添加子目录。
              </p>
            ) : (
              flat.map(({ node, depth }) => (
                <div
                  key={node.id}
                  className="group flex min-h-8 items-center gap-1 px-3.5 py-0.5 hover:bg-muted/40"
                  style={{ paddingLeft: 14 + depth * 16 }}
                >
                  <CategoryIcon
                    iconName={node.iconName}
                    color={node.color}
                    size={13}
                    className={node.color ? undefined : "text-ink-faint"}
                  />
                  {editingId === node.id ? (
                    <>
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveRename(node.id);
                          }
                          if (event.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        maxLength={80}
                        aria-label={`重命名 ${node.name}`}
                        className="h-6 min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 text-[11.5px] text-ink outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void saveRename(node.id)}
                        disabled={savingRename}
                        className="rounded p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-50"
                        aria-label={`保存目录名称 ${node.name}`}
                      >
                        <Check className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded p-1 text-ink-faint hover:bg-surface hover:text-ink"
                        aria-label={`取消重命名 ${node.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                        {node.name}
                      </span>
                      <span className="text-[10px] text-ink-faint">
                        {subtreeCommandCount(node)}
                      </span>
                      <button
                        type="button"
                        onClick={() => focusCreate(node.id)}
                        className="rounded p-1 text-ink-faint opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100 focus:opacity-100"
                        aria-label={`在 ${node.name} 下添加子目录`}
                        title="添加子目录"
                      >
                        <CornerDownRight className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(node.id);
                          setEditingName(node.name);
                        }}
                        className="rounded p-1 text-ink-faint opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100 focus:opacity-100"
                        aria-label={`重命名目录 ${node.name}`}
                        title="重命名"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeleteTarget(node)}
                        className="rounded p-1 text-ink-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100 focus:opacity-100"
                        aria-label={`删除目录 ${node.name}`}
                        title="删除"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-line px-3.5 py-2 text-[10.5px] leading-4 text-ink-faint">
            删除目录时可选择{itemLabel}去向；子目录可提升到父级，或随整棵子树删除。不会删除任何永久{itemLabel}。
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除目录"
        description={
          deleteTarget ? (
            <div className="space-y-2.5">
              <p>
                将删除目录「{deleteTarget.name}」。
                {deleteTarget.commandCount > 0
                  ? ` 直接包含 ${deleteTarget.commandCount} 条${itemLabel}。`
                  : ""}
                {deleteTarget.children.length > 0
                  ? ` 包含 ${descendantCategoryCount(deleteTarget)} 个子目录、子树共 ${subtreeCommandCount(deleteTarget)} 条${itemLabel}。`
                  : ""}
              </p>

              {(childAction === "deleteSubtree"
                ? subtreeCommandCount(deleteTarget)
                : deleteTarget.commandCount) > 0 ? (
                <fieldset className="space-y-1 rounded border border-line bg-canvas px-2 py-1.5">
                  <legend className="px-1 text-[10px] text-ink-faint">
                    {itemLabel}移动到
                  </legend>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="category-command-action"
                      checked={commandAction === "moveToParent"}
                      disabled={!deleteTarget.parentId}
                      onChange={() => setCommandAction("moveToParent")}
                    />
                    父目录
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="category-command-action"
                      checked={commandAction === "unclassified"}
                      onChange={() => setCommandAction("unclassified")}
                    />
                    默认
                  </label>
                </fieldset>
              ) : null}

              {deleteTarget.children.length > 0 ? (
                <fieldset className="space-y-1 rounded border border-line bg-canvas px-2 py-1.5">
                  <legend className="px-1 text-[10px] text-ink-faint">
                    子目录处理
                  </legend>
                  <label className="flex items-start gap-1.5">
                    <input
                      type="radio"
                      name="category-child-action"
                      className="mt-0.5"
                      checked={childAction === "promote"}
                      onChange={() => setChildAction("promote")}
                    />
                    <span>保留并提升到父级（{itemLabel}留在子目录）</span>
                  </label>
                  <label className="flex items-start gap-1.5">
                    <input
                      type="radio"
                      name="category-child-action"
                      className="mt-0.5"
                      checked={childAction === "deleteSubtree"}
                      onChange={() => setChildAction("deleteSubtree")}
                    />
                    <span>
                      删除整棵子目录树，子目录中的{itemLabel}一并移动到上方目标
                    </span>
                  </label>
                </fieldset>
              ) : null}

              <p className="text-[10.5px] text-ink-faint">
                永久{itemLabel}只会改变目录或排序，不会被删除；此操作不可撤销。
              </p>
            </div>
          ) : null
        }
        confirmLabel="删除目录"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
      />
    </>
  );
}
