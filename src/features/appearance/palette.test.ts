import { describe, expect, it } from "vitest";
import {
  MACARON_PALETTE,
  addCustomColor,
  contrastRatio,
  moveCustomColor,
  normalizeCustomColors,
  normalizeHexColor,
  relativeLuminance,
  removeCustomColor,
  resolveCategoryIconColors,
  resolveCommandSurface,
} from "./palette";

describe("appearance palette", () => {
  it("normalizes only valid opaque hex colors", () => {
    expect(normalizeHexColor(" #edf3fc ")).toBe("#EDF3FC");
    expect(normalizeHexColor("fceef0")).toBe("#FCEEF0");
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
    for (const invalid of ["", "#", "#12", "#1234", "#GGGGGG", "red", "red;--x"]) {
      expect(normalizeHexColor(invalid)).toBeNull();
    }
  });

  it("keeps preset light and dark tokens exact", () => {
    const mint = resolveCommandSurface("#EDF8F2");
    expect(mint).toEqual({ light: "#EDF8F2", dark: "#1F2B25" });
    const pink = resolveCommandSurface("#fceef0");
    expect(pink?.light).toBe("#FCEEF0");
  });

  it("keeps a saturated custom accent subtle in dark mode", () => {
    const blue = resolveCommandSurface("#2844CC");
    expect(blue).not.toBeNull();
    expect(relativeLuminance(blue!.dark)).toBeLessThan(0.05);
    expect(contrastRatio("#F5F5F5", blue!.dark)).toBeGreaterThan(10);
    expect(blue!.dark).not.toBe("#263EB1");
  });

  it("adapts arbitrary colors to readable light and dark surfaces", () => {
    for (const color of ["#FF0000", "#0000FF", "#FFFF00", "#000000", "#FFFFFF", "#808080"]) {
      const surface = resolveCommandSurface(color);
      expect(surface).not.toBeNull();
      expect(relativeLuminance(surface!.light)).toBeGreaterThan(0.85);
      expect(contrastRatio("#202020", surface!.light)).toBeGreaterThan(10);
      expect(relativeLuminance(surface!.dark)).toBeLessThan(0.12);
      expect(contrastRatio("#F5F5F5", surface!.dark)).toBeGreaterThan(7);
    }
  });

  it("keeps folder icon colors above 3:1 contrast in both themes", () => {
    const colors = [
      ...MACARON_PALETTE.map((preset) => preset.commandLight),
      "#FFFFFF",
      "#000000",
      "#FF00FF",
      "#FFFF00",
      "#808080",
    ];
    for (const color of colors) {
      const resolved = resolveCategoryIconColors(color);
      expect(resolved).not.toBeNull();
      expect(
        contrastRatio(resolved!.light, "#F9F9F7"),
        `${color} light`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(resolved!.dark, "#171717"),
        `${color} dark`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("deduplicates, caps and reorders the personal palette", () => {
    expect(addCustomColor([], "#edf3fc")).toEqual(["#EDF3FC"]);
    expect(addCustomColor(["#EDF3FC"], "#edf3fc")).toBeNull();
    expect(addCustomColor([], "nope")).toBeNull();
    expect(removeCustomColor(["#EDF3FC", "#FCEEF0"], "#edf3fc")).toEqual([
      "#FCEEF0",
    ]);
    expect(moveCustomColor(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveCustomColor(["a", "b"], 0, 9)).toEqual(["a", "b"]);
    expect(
      normalizeCustomColors(["#edf3fc", "#EDF3FC", "oops", "#fff"]),
    ).toEqual(["#EDF3FC", "#FFFFFF"]);
  });
});
