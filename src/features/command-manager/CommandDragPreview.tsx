import { getCommandAnnotation } from "@/features/command-display/commandDisplay";
import type { Command } from "@/types/app";

/**
 * Builds the native HTML5 drag image. Native drag images follow the pointer
 * without adding a second overlay layer, and are snapshotted synchronously at
 * dragstart so the browser never sees an empty ghost.
 */
export function createCommandDragPreview(
  command: Command,
  count: number,
): HTMLElement {
  const card = document.createElement("div");
  card.setAttribute("data-command-drag-preview", "true");
  card.style.position = "fixed";
  card.style.top = "-1000px";
  card.style.left = "-1000px";
  card.style.width = "280px";
  card.style.boxSizing = "border-box";
  card.style.padding = "8px 10px";
  card.style.border = "1px solid var(--line-strong, #c9c9c9)";
  card.style.borderRadius = "8px";
  card.style.background = "var(--surface, #ffffff)";
  card.style.color = "var(--ink, #1f1f1f)";
  card.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.18)";
  card.style.fontFamily =
    'Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif';
  card.style.pointerEvents = "none";

  if (count > 1) {
    const stack = document.createElement("div");
    stack.style.position = "absolute";
    stack.style.inset = "3px -3px -3px 3px";
    stack.style.border = "1px solid var(--line, #dddddd)";
    stack.style.borderRadius = "8px";
    stack.style.background = "var(--surface, #ffffff)";
    stack.style.zIndex = "-1";
    card.appendChild(stack);
  }

  const titleRow = document.createElement("div");
  titleRow.style.display = "flex";
  titleRow.style.alignItems = "center";
  titleRow.style.gap = "8px";

  const commandText = document.createElement("span");
  commandText.textContent = command.command.replace(/\s+/g, " ").trim();
  commandText.style.minWidth = "0";
  commandText.style.flex = "1";
  commandText.style.overflow = "hidden";
  commandText.style.textOverflow = "ellipsis";
  commandText.style.whiteSpace = "nowrap";
  commandText.style.fontFamily =
    '"Cascadia Code", "SFMono-Regular", Consolas, monospace';
  commandText.style.fontSize = "11.5px";
  commandText.style.fontWeight = "600";
  titleRow.appendChild(commandText);

  const badge = document.createElement("span");
  badge.textContent = count > 1 ? `共 ${count} 条命令` : "移动";
  badge.style.flexShrink = "0";
  badge.style.borderRadius = "999px";
  badge.style.background = count > 1 ? "var(--brand, #1f1f1f)" : "transparent";
  badge.style.color =
    count > 1 ? "var(--brand-contrast, #ffffff)" : "var(--ink-faint, #777777)";
  badge.style.padding = count > 1 ? "1px 6px" : "0";
  badge.style.fontSize = "9.5px";
  titleRow.appendChild(badge);
  card.appendChild(titleRow);

  const annotation = getCommandAnnotation(command);
  if (annotation) {
    const preview = document.createElement("div");
    preview.textContent = annotation;
    preview.style.marginTop = "2px";
    preview.style.overflow = "hidden";
    preview.style.textOverflow = "ellipsis";
    preview.style.whiteSpace = "nowrap";
    preview.style.fontSize = "10.5px";
    preview.style.lineHeight = "14px";
    preview.style.color = "var(--ink-muted, #666666)";
    card.appendChild(preview);
  }

  return card;
}
