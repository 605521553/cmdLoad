import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "@/types/app";
import { cn } from "@/utils/cn";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

interface ThemePickerProps {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
  disabled?: boolean;
}

export function ThemePicker({ value, onChange, disabled }: ThemePickerProps) {
  return (
    <div
      className="flex items-center rounded-md border border-line bg-surface p-0.5"
      role="group"
      aria-label="界面主题"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
            aria-pressed={selected}
            title={option.label}
            className={cn(
              "flex h-6 items-center justify-center gap-1 rounded px-1.5 text-[11px] transition-colors",
              selected
                ? "bg-muted font-medium text-ink"
                : "text-ink-muted hover:text-ink",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Icon className="size-3" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
