import { cn } from "@/utils/cn";

interface StatusDotProps {
  tone?: "success" | "warning" | "neutral";
  className?: string;
}

export function StatusDot({ tone = "success", className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-amber",
        tone === "neutral" && "bg-ink-faint",
        className,
      )}
    />
  );
}
