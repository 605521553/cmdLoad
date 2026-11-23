import type { PointerEvent as ReactPointerEvent } from "react";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import { getUserErrorMessage } from "@/utils/errors";

const INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, [role='button'], [data-no-window-drag]";

/**
 * Native window moves are initiated from an explicit in-app strip instead of
 * relying on focus/blur. The Rust side suppresses auto-hide for the duration
 * required by the move loop.
 */
export function useWindowDrag() {
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }
    event.preventDefault();
    void appApi.startWindowDrag().catch((error) => {
      useAppStore.getState().showNotice({
        kind: "error",
        message: getUserErrorMessage(error),
      });
    });
  };
}
