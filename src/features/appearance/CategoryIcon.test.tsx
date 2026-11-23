import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryIcon } from "./CategoryIcon";
import { resolveCategoryIconColors } from "./palette";

describe("CategoryIcon", () => {
  it("uses the stored Lucide icon and theme-resolved color", () => {
    const { container } = render(
      <CategoryIcon iconName="database" color="#EDF8F2" size={16} />,
    );
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("data-category-icon", "database");
    expect(icon).toHaveClass("lucide-database");
    expect(icon).toHaveClass("category-icon-tint");
    const colors = resolveCategoryIconColors("#EDF8F2");
    expect(icon?.style.getPropertyValue("--category-icon-light")).toBe(
      colors?.light,
    );
    expect(icon?.style.getPropertyValue("--category-icon-dark")).toBe(
      colors?.dark,
    );
  });

  it("falls back to the neutral folder icon for unknown names", () => {
    const { container } = render(
      <CategoryIcon iconName="not-a-real-icon" size={12} />,
    );
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("data-category-icon", "folder");
    expect(icon).toHaveClass("lucide-folder");
    expect(icon).not.toHaveClass("category-icon-tint");
  });
});
