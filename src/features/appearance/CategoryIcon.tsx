import { createElement, type CSSProperties } from "react";
import { Folder, type LucideProps } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  DEFAULT_CATEGORY_ICON,
  getCategoryIconOption,
} from "./categoryIcons";
import { resolveCategoryIconColors } from "./palette";

interface CategoryIconProps {
  iconName?: string | null;
  color?: string | null;
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

/**
 * The single renderer used by the sidebar, tree, move picker, category manager,
 * command detail and quick panel. It also adapts the icon color for light/dark
 * themes through CSS variables.
 */
export function CategoryIcon({
  iconName,
  color,
  size = 14,
  strokeWidth = 1.8,
  className,
  title,
}: CategoryIconProps) {
  const colors = resolveCategoryIconColors(color);
  const option = getCategoryIconOption(iconName);
  const style = colors
    ? ({
        "--category-icon-light": colors.light,
        "--category-icon-dark": colors.dark,
      } as CSSProperties)
    : undefined;
  const props = {
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
    "aria-label": title,
    size,
    strokeWidth,
    "data-category-icon": option?.name ?? DEFAULT_CATEGORY_ICON,
    className: cn("shrink-0", colors && "category-icon-tint", className),
    style,
  } as unknown as LucideProps;
  return createElement(option?.icon ?? Folder, props);
}
