import { Kbd } from "@/components/ui/Kbd";
import { parseShortcut } from "@/utils/hotkeys";
import { cn } from "@/utils/cn";

const DISPLAY_LABELS: Record<string, string> = {
  Super: "Win",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
};

interface ShortcutKeysProps {
  shortcut: string;
  className?: string;
  muted?: boolean;
}

export function ShortcutKeys({
  shortcut,
  className,
  muted = false,
}: ShortcutKeysProps) {
  const parts = parseShortcut(shortcut);
  const tokens = [...parts.modifiers, parts.key].filter(Boolean);

  if (tokens.length === 0) {
    return <span className="text-xs text-ink-faint">未设置</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1",
        muted && "opacity-75",
        className,
      )}
    >
      {tokens.map((token, index) => (
        <span key={`${token}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden="true" className="text-[10px] text-ink-faint">
              +
            </span>
          ) : null}
          <Kbd>{DISPLAY_LABELS[token] ?? token}</Kbd>
        </span>
      ))}
    </span>
  );
}
