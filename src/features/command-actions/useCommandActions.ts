import { useCallback } from "react";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { Command, MoveCommandsResult } from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";

/**
 * Shared command mutations for the manager and the quick panel. Both windows
 * use the same Tauri Command Service and the same user-feedback behavior.
 */
export function useCommandActions() {
  const showNotice = useAppStore((state) => state.showNotice);

  const copyCommands = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return null;
      }
      try {
        const outcome = await appApi.copyCommands(ids);
        const label =
          outcome.copiedCount > 1
            ? `已复制 ${outcome.copiedCount} 条命令`
            : "命令已复制到系统剪贴板";
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
    async (command: Command) => {
      try {
        const updated = await appApi.toggleCommandFavorite(command.id);
        showNotice({
          kind: "success",
          message: updated.isFavorite ? "已加入收藏" : "已取消收藏",
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
    ): Promise<MoveCommandsResult | null> => {
      if (ids.length === 0) {
        return null;
      }
      try {
        const result = await appApi.moveCommandsToCategory(ids, categoryId);
        if (result.moved === 0) {
          showNotice({
            kind: "info",
            message: `所选命令已经在「${categoryLabel}」中。`,
          });
          return result;
        }
        showNotice({
          kind: "success",
          message: `已将 ${result.moved} 条命令移动到「${categoryLabel}」。`,
          actionLabel: "撤销",
          onAction: async () => {
            try {
              await appApi.restoreCommandPlacements(result.previous);
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

  const deleteCommand = useCallback(
    async (command: Command) => {
      try {
        await appApi.deleteCommand(command.id);
        showNotice({
          kind: "success",
          message: `已删除「${command.title}」，原始记录已保留。`,
        });
        return true;
      } catch (error) {
        showNotice({ kind: "error", message: getUserErrorMessage(error) });
        return false;
      }
    },
    [showNotice],
  );

  return { copyCommands, toggleFavorite, moveToCategory, deleteCommand };
}
