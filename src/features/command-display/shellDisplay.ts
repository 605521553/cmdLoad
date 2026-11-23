const SHELL_LABELS: Record<string, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  bash: "Bash",
  sh: "Shell",
  zsh: "Zsh",
  other: "Other",
};

/**
 * Return a user-facing Shell name only for an explicit, supported shell.
 * `unknown`, null, empty/whitespace and unrecognized values are treated as
 * unspecified and must not render a badge.
 */
export function getShellLabel(shell: string | null | undefined): string | null {
  if (shell === null || shell === undefined) {
    return null;
  }
  const normalized = shell.trim().toLocaleLowerCase();
  if (!normalized || normalized === "unknown") {
    return null;
  }
  return SHELL_LABELS[normalized] ?? null;
}

export function isSpecifiedShell(
  shell: string | null | undefined,
): boolean {
  return getShellLabel(shell) !== null;
}
