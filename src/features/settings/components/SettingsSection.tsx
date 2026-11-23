import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/** Flat settings group. No cards, heavy borders or decorative chrome. */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section
      className={cn(
        "border-t border-line pt-3.5 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <header className="mb-1">
        <h2 className="text-[13.5px] font-semibold leading-5 text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[11.5px] leading-4 text-ink-muted">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
