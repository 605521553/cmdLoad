import { useCallback } from "react";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { MovePromptsResult, Prompt } from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";
import { promptDisplayTitle } from "./promptAppearance";

/** Shared prompt mutations for the prompt manager and the quick panel. */
export function usePromptActions() {
  const showNotice = useAppStore((state) => state.showNotice);

  const copyPrompts = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return null;
      }
      try {
        const outcome = await appApi.copyPrompts(ids);
        const label =
          outcome.copiedCount > 1
            ? `已复制 ${outcome.copiedCount} 条提示词`
            : "提示词已复制到系统剪贴板";
        showNotice({
          kind: outcome.warning ? "info" : "success",
          message: outcome.warning ? `${label}。${outcome.warning}` : label,
        });
        return outcome;
      } catch (error) {
        showNotice({ kind: "error", message: getUserErrorMessage(error) });
        return null;
      }
    },
    [showNotice],
  );

  const toggleFavorite = useCallback(
    async (prompt: Prompt) => {
      try {
        const updated = await appApi.togglePromptFavorite(prompt.id);
        showNotice({
          kind: "success",
          message: updated.isFavorite ? "已收藏提示词" : "已取消收藏",
        });
        return updated;
      } catch (error) {
        showNotice({ kind: "error", message: getUserErrorMessage(error) });
        return null;
      }
    },
    [showNotice],
  );

  const moveToCategory = useCallback(
    async (
      ids: string[],
      categoryId: string | null,
      categoryLabel: string,
    ): Promise<MovePromptsResult | null> => {
      if (ids.length === 0) {
        return null;
      }
      try {
        const result = await appApi.movePromptsToCategory(ids, categoryId);
        if (result.moved === 0) {
          showNotice({
            kind: "info",
            message: `所选提示词已经在「${categoryLabel}」中。`,
          });
          return result;
        }
        showNotice({
          kind: "success",
          message: `已将 ${result.moved} 条提示词移动到「${categoryLabel}」。`,
          actionLabel: "撤销",
          onAction: async () => {
            try {
              await appApi.restorePromptPlacements(result.previous);
              showNotice({ kind: "success", message: "已撤销目录移动" });
            } catch (error) {
              showNotice({
                kind: "error",
                message: `撤销失败：${getUserErrorMessage(error)}`,
              });
            }
          },
        });
        return result;
      } catch (error) {
        showNotice({ kind: "error", message: getUserErrorMessage(error) });
        return null;
      }
    },
    [showNotice],
  );

  const deletePrompt = useCallback(
    async (prompt: Prompt) => {
      try {
        await appApi.deletePrompt(prompt.id);
        showNotice({
          kind: "success",
          message: `已删除「${promptDisplayTitle(prompt)}」，原始记录已保留。`,
        });
        return true;
      } catch (error) {
        showNotice({ kind: "error", message: getUserErrorMessage(error) });
        return false;
      }
    },
    [showNotice],
  );

  return { copyPrompts, toggleFavorite, moveToCategory, deletePrompt };
}
