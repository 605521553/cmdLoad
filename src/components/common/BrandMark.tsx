import { cn } from "@/utils/cn";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** Monochrome app mark. Colours follow the active theme tokens. */
export function BrandMark({ size = 32, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Pata Commands"
      className={cn("shrink-0", className)}
    >
      <rect width="64" height="64" rx="13" fill="var(--ink)" />
      <path
        d="M21.5 24.5 31.5 32 21.5 39.5"
        fill="none"
        stroke="var(--canvas)"
        strokeWidth="5.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M37 40.5h9"
        fill="none"
        stroke="var(--canvas)"
        strokeWidth="5.25"
        strokeLinecap="round"
        opacity="0.62"
      />
    </svg>
  );
}
