import type { CSSProperties } from "react";
import type { Command } from "@/types/app";
import { resolveCommandSurface } from "./palette";

export interface CommandTint {
  hasTint: boolean;
  source: string | null;
  followingCategory: boolean;
  style: CSSProperties | undefined;
}

/**
 * Resolve the effective command background.
 *
 * `useCategoryColor` is a live mode: the command follows its category color
 * until the user turns it off, at which point the stored own color applies
 * again. Components only consume the resolved CSS variables, so every view
 * (list, tree, quick panel) renders the same command identically.
 */
export function resolveCommandTint(
  command: Pick<
    Command,
    "backgroundColor" | "useCategoryColor" | "categoryColor"
  >,
): CommandTint {
  const source = command.useCategoryColor
    ? command.categoryColor
    : command.backgroundColor;
  const surface = resolveCommandSurface(source);
  if (!surface || !source) {
    return {
      hasTint: false,
      source: null,
      followingCategory: command.useCategoryColor,
      style: undefined,
    };
  }
  return {
    hasTint: true,
    source,
    followingCategory: command.useCategoryColor,
    style: {
      "--command-tint-light": surface.light,
      "--command-tint-dark": surface.dark,
    } as CSSProperties,
  };
}

/** True when the category color currently has no visible effect. */
export function isFollowingMissingCategoryColor(
  command: Pick<Command, "useCategoryColor" | "categoryColor">,
): boolean {
  return command.useCategoryColor && !command.categoryColor;
}
