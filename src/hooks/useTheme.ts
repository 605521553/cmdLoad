import { useEffect, useState } from "react";
import type { ThemePreference } from "@/types/app";

type ResolvedTheme = "light" | "dark";

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme(preference: ThemePreference | undefined): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    preference === "dark" ? "dark" : preference === "light" ? "light" : systemTheme(),
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next =
        preference === "dark"
          ? "dark"
          : preference === "light"
            ? "light"
            : media.matches
              ? "dark"
              : "light";
      setResolved(next);
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  return resolved;
}
