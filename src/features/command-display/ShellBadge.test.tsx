import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShellBadge } from "./ShellBadge";
import { getShellLabel } from "./shellDisplay";

describe("ShellBadge", () => {
  it("renders nothing for unknown, null, empty and unrecognized shells", () => {
    const { container, rerender } = render(<ShellBadge shell="unknown" />);
    expect(container).toBeEmptyDOMElement();

    for (const value of [null, undefined, "", "   ", "default", "unknown"]) {
      rerender(<ShellBadge shell={value} />);
      expect(container).toBeEmptyDOMElement();
      expect(getShellLabel(value)).toBeNull();
    }
  });

  it.each([
    ["powershell", "PowerShell"],
    ["cmd", "CMD"],
    ["bash", "Bash"],
    ["sh", "Shell"],
    ["zsh", "Zsh"],
    ["other", "Other"],
  ])("renders %s as %s", (shell, label) => {
    render(<ShellBadge shell={shell} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      document.querySelector(`[data-shell-badge="${shell}"]`),
    ).not.toBeNull();
    expect(getShellLabel(shell)).toBe(label);
  });

  it("normalizes casing and surrounding whitespace", () => {
    render(<ShellBadge shell="  PowerShell " />);
    expect(screen.getByText("PowerShell")).toBeInTheDocument();
  });
});
