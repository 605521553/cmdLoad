import { useLayoutEffect, useState, type RefObject } from "react";

export interface PopoverAnchor {
  x: number;
  y: number;
}

interface UsePopoverPositionOptions {
  open: boolean;
  anchor: PopoverAnchor;
  panelRef: RefObject<HTMLElement | null>;
  fallbackWidth: number;
  fallbackHeight: number;
}

const VIEWPORT_MARGIN = 8;

/**
 * Keep a fixed-position popover inside the current WebView viewport.
 *
 * A ResizeObserver re-runs the clamp when the content grows (for example when
 * the custom color section expands), so the panel never extends below the
 * quick-panel window. If the content is taller than the viewport, it is
 * top-aligned and the panel's own `max-height`/scroll handles the overflow.
 */
export function usePopoverPosition({
  open,
  anchor,
  panelRef,
  fallbackWidth,
  fallbackHeight,
}: UsePopoverPositionOptions): PopoverAnchor {
  const [coords, setCoords] = useState<PopoverAnchor>(anchor);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const update = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : fallbackWidth;
      const height = rect && rect.height > 0 ? rect.height : fallbackHeight;
      const maxHeight = Math.max(VIEWPORT_MARGIN, window.innerHeight - 16);
      const maxX = Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - width - VIEWPORT_MARGIN,
      );
      const maxY = Math.max(
        VIEWPORT_MARGIN,
        window.innerHeight - Math.min(height, maxHeight) - VIEWPORT_MARGIN,
      );
      const x = Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, maxX));
      const y = Math.max(VIEWPORT_MARGIN, Math.min(anchor.y, maxY));
      setCoords((current) =>
        current.x === x && current.y === y ? current : { x, y },
      );
    };

    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => update());
    if (observer && panelRef.current) {
      observer.observe(panelRef.current);
    }
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [
    open,
    anchor,
    panelRef,
    fallbackWidth,
    fallbackHeight,
  ]);

  return coords;
}
