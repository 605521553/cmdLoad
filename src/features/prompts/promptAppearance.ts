import type { CSSProperties } from "react";
import type { Prompt } from "@/types/app";
import { resolveCommandSurface } from "@/features/appearance/palette";

export interface PromptTint {
  hasTint: boolean;
  style: CSSProperties | undefined;
}

/**
 * Prompts default to a neutral surface. A macaron tint is applied only when the
 * user explicitly chose one, which keeps long-form reading calm.
 */
export function resolvePromptTint(
  prompt: Pick<Prompt, "backgroundColor">,
): PromptTint {
  const surface = resolveCommandSurface(prompt.backgroundColor);
  if (!surface || !prompt.backgroundColor) {
    return { hasTint: false, style: undefined };
  }
  return {
    hasTint: true,
    style: {
      "--prompt-tint-light": surface.light,
      "--prompt-tint-dark": surface.dark,
    } as CSSProperties,
  };
}

export function promptDisplayTitle(
  prompt: Pick<Prompt, "title" | "content">,
  maxLength = 60,
): string {
  const title = prompt.title.trim();
  if (title) {
    return title;
  }
  const firstLine =
    prompt.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const text = firstLine || "未命名提示词";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function promptPreview(prompt: Pick<Prompt, "content">): string {
  return prompt.content.trim().length > 0
    ? prompt.content
    : "（空白提示词）";
}
