import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Command } from "@/types/app";
import { cn } from "@/utils/cn";
import { getDisplayAnnotation } from "./commandDisplay";

type CommandLike = Pick<Command, "command" | "title"> &
  Partial<Pick<Command, "aiAnnotation" | "aiAnnotationStatus">>;

export type CommandDensity = "quick" | "manager" | "tree";

const COMMAND_TEXT_SIZE: Record<CommandDensity, string> = {
  quick: "text-[14px] leading-[1.5]",
  manager: "text-[13.5px] leading-[1.5]",
  tree: "text-[13px] leading-[1.5]",
};

const ANNOTATION_TEXT_SIZE: Record<CommandDensity, string> = {
  quick: "text-[12.5px]",
  manager: "text-[12px]",
  tree: "text-[11.5px]",
};

interface CommandPrimaryProps {
  command: CommandLike;
  density?: CommandDensity;
  lines?: 1 | 2 | 3;
  trailing?: ReactNode;
  annotationTrailing?: ReactNode;
  className?: string;
  commandClassName?: string;
  annotationClassName?: string;
  showAnnotation?: boolean;
}

/**
 * Shared command-first block used by the quick panel, the manager list and the
 * tree view. The command is the primary line; the short annotation is the
 * secondary line, and auxiliary badges live on the right of the first line.
 */
export function CommandPrimary({
  command,
  density = "manager",
  lines = 2,
  trailing,
  annotationTrailing,
  className,
  commandClassName,
  annotationClassName,
  showAnnotation = true,
}: CommandPrimaryProps) {
  const annotation = showAnnotation ? getDisplayAnnotation(command) : null;
  const aiPending = showAnnotation && command.aiAnnotationStatus === "pending";
  const clampClass =
    lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : "line-clamp-3";

  return (
    <div className={cn("min-w-0", className)} data-command-primary="true">
      <div className="flex min-w-0 items-start gap-2">
        <p
          title={command.command}
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-ink",
            COMMAND_TEXT_SIZE[density],
            clampClass,
            commandClassName,
          )}
        >
          {command.command}
        </p>
        {trailing ? (
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            {trailing}
          </div>
        ) : null}
      </div>
      {annotation || aiPending || annotationTrailing ? (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {annotation ? (
            <p
              title={annotation}
              className={cn(
                "min-w-0 flex-1 truncate text-ink-muted",
                ANNOTATION_TEXT_SIZE[density],
                annotationClassName,
              )}
            >
              {annotation}
            </p>
          ) : aiPending ? (
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 truncate text-ink-faint",
                ANNOTATION_TEXT_SIZE[density],
              )}
              title="AI 正在生成简短注释"
            >
              <LoaderCircle className="size-2.5 shrink-0 animate-spin" />
              AI 生成中
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {annotationTrailing ? (
            <div className="shrink-0">{annotationTrailing}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
