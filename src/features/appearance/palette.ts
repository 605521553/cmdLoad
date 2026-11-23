/**
 * Central appearance design tokens.
 *
 * Preset colors are intentionally very light for command rows. Each token also
 * carries a dark-theme surface and a higher-contrast pair for folder icons, so
 * components never need to invent their own color math. Custom user colors go
 * through the same resolvers, which keeps contrast and dark-theme adaptation
 * consistent everywhere.
 */

export interface MacaronColor {
  id: string;
  name: string;
  commandLight: string;
  commandDark: string;
  folderLight: string;
  folderDark: string;
}

export const MACARON_PALETTE: MacaronColor[] = [
  {
    id: "cream-pink",
    name: "奶油粉",
    commandLight: "#FCEEF0",
    commandDark: "#2C2225",
    folderLight: "#C47888",
    folderDark: "#E7A9B5",
  },
  {
    id: "mist-blue",
    name: "雾霾蓝",
    commandLight: "#EDF3FC",
    commandDark: "#212833",
    folderLight: "#5D82B8",
    folderDark: "#9DB9E4",
  },
  {
    id: "mint",
    name: "薄荷绿",
    commandLight: "#EDF8F2",
    commandDark: "#1F2B25",
    folderLight: "#4E9B78",
    folderDark: "#86C9AA",
  },
  {
    id: "cream-yellow",
    name: "奶油黄",
    commandLight: "#FFF8E8",
    commandDark: "#2C2719",
    folderLight: "#A8842E",
    folderDark: "#DDBA6A",
  },
  {
    id: "lavender",
    name: "淡紫",
    commandLight: "#F4EFFB",
    commandDark: "#272234",
    folderLight: "#8771B8",
    folderDark: "#B8A4E2",
  },
  {
    id: "apricot",
    name: "浅杏",
    commandLight: "#FFF0E8",
    commandDark: "#2C241D",
    folderLight: "#B97A55",
    folderDark: "#E2AC8B",
  },
  {
    id: "ice",
    name: "冰青",
    commandLight: "#EBF8F8",
    commandDark: "#1E2A2A",
    folderLight: "#3E9191",
    folderDark: "#7FC7C7",
  },
  {
    id: "warm-gray",
    name: "暖灰",
    commandLight: "#F3F2EF",
    commandDark: "#262522",
    folderLight: "#7D7A70",
    folderDark: "#B3AEA2",
  },
];

export const MAX_CUSTOM_COLORS = 24;

const PRESET_BY_COLOR = new Map(
  MACARON_PALETTE.map((preset) => [preset.commandLight, preset]),
);

export function findPresetColor(
  color: string | null | undefined,
): MacaronColor | null {
  const normalized = normalizeHexColor(color ?? "");
  return normalized ? PRESET_BY_COLOR.get(normalized) ?? null : null;
}

/** Canonical `#RRGGBB`, or `null` for anything else. */
export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (digits.length === 3) {
    if (!/^[0-9a-fA-F]{3}$/.test(digits)) {
      return null;
    }
    const expanded = digits
      .split("")
      .map((character) => character + character)
      .join("");
    return `#${expanded.toUpperCase()}`;
  }
  if (digits.length === 6 && /^[0-9a-fA-F]{6}$/.test(digits)) {
    return `#${digits.toUpperCase()}`;
  }
  return null;
}

export function colorsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) {
    return !left && !right;
  }
  return normalizeHexColor(left) === normalizeHexColor(right);
}

export function addCustomColor(
  colors: string[],
  color: string,
): string[] | null {
  const normalized = normalizeHexColor(color);
  if (!normalized || colors.includes(normalized)) {
    return null;
  }
  if (colors.length >= MAX_CUSTOM_COLORS) {
    return null;
  }
  return [...colors, normalized];
}

export function removeCustomColor(colors: string[], color: string): string[] {
  const normalized = normalizeHexColor(color);
  return colors.filter((item) => item !== normalized);
}

export function moveCustomColor(
  colors: string[],
  from: number,
  to: number,
): string[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= colors.length ||
    to >= colors.length
  ) {
    return colors;
  }
  const next = [...colors];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function normalizeCustomColors(colors: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const value of colors) {
    const color = normalizeHexColor(value);
    if (color && !normalized.includes(color)) {
      normalized.push(color);
    }
    if (normalized.length >= MAX_CUSTOM_COLORS) {
      break;
    }
  }
  return normalized;
}

/** Theme-resolved backgrounds for command rows and cards. */
export interface CommandSurface {
  light: string;
  dark: string;
}

export interface CategoryIconColors {
  light: string;
  dark: string;
}

const commandSurfaceCache = new Map<string, CommandSurface>();
const categoryColorCache = new Map<string, CategoryIconColors>();

export function resolveCommandSurface(
  color: string | null | undefined,
): CommandSurface | null {
  const normalized = normalizeHexColor(color ?? "");
  if (!normalized) {
    return null;
  }
  const cached = commandSurfaceCache.get(normalized);
  if (cached) {
    return cached;
  }
  const preset = PRESET_BY_COLOR.get(normalized);
  const resolved = preset
    ? { light: preset.commandLight, dark: preset.commandDark }
    : {
        light: lightenUntil(normalized, 0.9),
        dark: darkenUntil(normalized, 0.075),
      };
  commandSurfaceCache.set(normalized, resolved);
  return resolved;
}

export function resolveCategoryIconColors(
  color: string | null | undefined,
): CategoryIconColors | null {
  const normalized = normalizeHexColor(color ?? "");
  if (!normalized) {
    return null;
  }
  const cached = categoryColorCache.get(normalized);
  if (cached) {
    return cached;
  }
  const preset = PRESET_BY_COLOR.get(normalized);
  const resolved = preset
    ? { light: preset.folderLight, dark: preset.folderDark }
    : {
        light: contrastOn(normalized, "#F9F9F7"),
        dark: contrastOn(normalized, "#171717"),
      };
  categoryColorCache.set(normalized, resolved);
  return resolved;
}

/** Foreground text color for a solid swatch/thumbnail. */
export function readableInkFor(hex: string): "#FFFFFF" | "#202020" {
  return relativeLuminance(hex) > 0.5 ? "#202020" : "#FFFFFF";
}

function lightenUntil(hex: string, targetLuminance: number): string {
  if (relativeLuminance(hex) >= targetLuminance) {
    return hex;
  }
  for (let ratio = 0.1; ratio <= 1; ratio += 0.05) {
    const candidate = mixHex(hex, "#FFFFFF", ratio);
    if (relativeLuminance(candidate) >= targetLuminance) {
      return candidate;
    }
  }
  return "#FFFFFF";
}

const DARK_SURFACE_BASE = "#1B1B1B";

/**
 * Custom colors need more than a luminance cap in dark mode: a saturated blue
 * can have a low luminance but still look like a bright, harsh block. Always
 * blend at least this much with the dark surface so the result reads as a
 * subtle tint rather than the original accent color.
 */
const MIN_DARK_BLEND = 0.75;

function darkenUntil(hex: string, targetLuminance: number): string {
  let candidate = mixHex(hex, DARK_SURFACE_BASE, MIN_DARK_BLEND);
  for (let ratio = MIN_DARK_BLEND; ratio <= 1; ratio += 0.04) {
    candidate = mixHex(hex, DARK_SURFACE_BASE, ratio);
    if (relativeLuminance(candidate) <= targetLuminance) {
      return candidate;
    }
  }
  return DARK_SURFACE_BASE;
}

/** Return a same-hue color with at least 3:1 contrast on the given surface. */
export function contrastOn(hex: string, surface: string): string {
  if (contrastRatio(hex, surface) >= 3) {
    return hex;
  }
  const { h, s } = rgbToHsl(hexToRgb(hex));
  const surfaceLuminance = relativeLuminance(surface);
  const shouldDarken = surfaceLuminance > 0.5;
  const saturation = Math.max(s, 0.35);
  const steps = shouldDarken
    ? Array.from({ length: 40 }, (_, index) => 0.58 - index * 0.012)
    : Array.from({ length: 40 }, (_, index) => 0.55 + index * 0.011);
  for (const lightness of steps) {
    if (lightness <= 0.08 || lightness >= 0.96) {
      continue;
    }
    const candidate = hslToHex(h, saturation, lightness);
    if (contrastRatio(candidate, surface) >= 3) {
      return candidate;
    }
  }
  return shouldDarken ? "#3F3F3F" : "#D4D4D4";
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex) ?? "#000000";
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** Linear RGB relative luminance (WCAG 2.x). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(left: string, right: string): number {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixHex(left: string, right: string, ratio: number): string {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  const t = Math.max(0, Math.min(1, ratio));
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function rgbToHsl({ r, g, b }: Rgb): {
  h: number;
  s: number;
  l: number;
} {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }
  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return { h: hue / 6, s: saturation, l: lightness };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hueToChannel = (p: number, q: number, t: number) => {
    let value = t;
    if (value < 0) {
      value += 1;
    }
    if (value > 1) {
      value -= 1;
    }
    if (value < 1 / 6) {
      return p + (q - p) * 6 * value;
    }
    if (value < 1 / 2) {
      return q;
    }
    if (value < 2 / 3) {
      return p + (q - p) * (2 / 3 - value) * 6;
    }
    return p;
  };
  if (s === 0) {
    const value = l * 255;
    return rgbToHex({ r: value, g: value, b: value });
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex({
    r: hueToChannel(p, q, h + 1 / 3) * 255,
    g: hueToChannel(p, q, h) * 255,
    b: hueToChannel(p, q, h - 1 / 3) * 255,
  });
}
