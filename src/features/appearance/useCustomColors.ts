import { useCallback, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { getUserErrorMessage } from "@/utils/errors";
import {
  addCustomColor,
  MAX_CUSTOM_COLORS,
  moveCustomColor,
  normalizeCustomColors,
  removeCustomColor,
} from "./palette";

/**
 * Shared personal palette stored in settings.json. Both the command color
 * popover and the category appearance popover use this same hook, so a color
 * saved in one place is immediately available in the other.
 */
export function useCustomColors() {
  const snapshot = useAppStore((state) => state.snapshot);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const showNotice = useAppStore((state) => state.showNotice);
  const colors = useMemo(
    () => normalizeCustomColors(snapshot?.settings.customColors ?? []),
    [snapshot],
  );

  const persist = useCallback(
    async (next: string[]) => {
      try {
        await updateSettings({ customColors: next });
        return true;
      } catch (error) {
        showNotice({ kind: "error", message: getUserErrorMessage(error) });
        return false;
      }
    },
    [showNotice, updateSettings],
  );

  const add = useCallback(
    async (color: string) => {
      const next = addCustomColor(colors, color);
      if (!next) {
        return false;
      }
      return persist(next);
    },
    [colors, persist],
  );

  const remove = useCallback(
    async (color: string) => persist(removeCustomColor(colors, color)),
    [colors, persist],
  );

  const move = useCallback(
    async (from: number, to: number) => {
      const next = moveCustomColor(colors, from, to);
      if (next === colors) {
        return false;
      }
      return persist(next);
    },
    [colors, persist],
  );

  return {
    colors,
    add,
    remove,
    move,
    canAdd: colors.length < MAX_CUSTOM_COLORS,
  };
}
