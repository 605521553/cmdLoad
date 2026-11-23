const MODIFIER_LABELS = new Set(["Ctrl", "Alt", "Shift", "Super"]);

const KEY_CODE_NAMES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Escape",
};

export interface ShortcutParts {
  modifiers: string[];
  key: string;
}

export interface ShortcutCaptureResult {
  status: "ready" | "modifier-only" | "unsupported";
  shortcut?: string;
  parts?: ShortcutParts;
  message?: string;
}

/** Display parts for the human-facing shortcut notation used by the app. */
export function parseShortcut(shortcut: string): ShortcutParts {
  const tokens = shortcut
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const token of tokens) {
    if (MODIFIER_LABELS.has(token)) {
      modifiers.push(token);
    } else {
      keys.push(token);
    }
  }

  return { modifiers, key: keys.join("+") };
}

export function formatShortcut(parts: ShortcutParts): string {
  return [...parts.modifiers, parts.key].join("+");
}

export function keyFromKeyboardCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code;
  }
  return KEY_CODE_NAMES[code] ?? null;
}

/**
 * Convert a keyboard event into the stable notation understood by the Rust
 * hotkey service. Letter/digit/F-key shortcuts are intentionally supported
 * first; punctuation and layout-dependent keys need backend parser coverage.
 */
export function captureShortcut(event: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): ShortcutCaptureResult {
  if (
    event.code.startsWith("Control") ||
    event.code.startsWith("Shift") ||
    event.code.startsWith("Alt") ||
    event.code.startsWith("Meta")
  ) {
    return { status: "modifier-only" };
  }

  const key = keyFromKeyboardCode(event.code);
  if (!key) {
    return {
      status: "unsupported",
      message: "暂不支持这个按键，请使用字母、数字或 F1–F24。",
    };
  }

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");

  if (!modifiers.some((modifier) => modifier !== "Shift")) {
    return {
      status: "unsupported",
      message: "请至少包含 Ctrl、Alt 或 Win 键，避免与其他程序的单键操作冲突。",
    };
  }

  const parts = { modifiers, key };
  return {
    status: "ready",
    shortcut: formatShortcut(parts),
    parts,
  };
}

export function shortcutPartsForDisplay(shortcut: string): ShortcutParts {
  return parseShortcut(shortcut);
}

export function isSameShortcut(a: string, b: string): boolean {
  const parse = (value: string) => {
    const parts = parseShortcut(value);
    return formatShortcut({
      modifiers: [...parts.modifiers].sort(),
      key: parts.key.toUpperCase(),
    }).toLowerCase();
  };
  return parse(a) === parse(b);
}
