import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SearchInput } from "./SearchInput";

function SearchHarness() {
  const [value, setValue] = useState("");
  return (
    <SearchInput
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClear={() => setValue("")}
      aria-label="搜索命令"
    />
  );
}

describe("SearchInput", () => {
  it("renders exactly one clear control only when there is a query", () => {
    render(<SearchHarness />);
    const input = screen.getByRole("searchbox", { name: "搜索命令" });
    expect(screen.queryByRole("button", { name: "清空搜索" })).toBeNull();

    fireEvent.change(input, { target: { value: "docker" } });
    expect(screen.getAllByRole("button", { name: "清空搜索" })).toHaveLength(1);
    expect(input.className).toContain("search-cancel-button");
  });

  it("clears and refocuses the search field", () => {
    render(<SearchHarness />);
    const input = screen.getByRole("searchbox", { name: "搜索命令" });
    fireEvent.change(input, { target: { value: "docker" } });
    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("does not render a custom clear button without onClear", () => {
    const { rerender } = render(
      <SearchInput value="" onChange={() => undefined} aria-label="搜索" />,
    );
    rerender(
      <SearchInput value="docker" onChange={() => undefined} aria-label="搜索" />,
    );
    expect(screen.queryByRole("button", { name: "清空搜索" })).toBeNull();
  });
});
