import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommandPrimary } from "./CommandPrimary";
import { commandLabel, getCommandAnnotation } from "./commandDisplay";

const base = {
  command: "docker ps -a",
  title: "查看容器",
};

describe("command display hierarchy", () => {
  it("shows the command first and a meaningful short annotation below", () => {
    const { container } = render(<CommandPrimary command={base} />);
    const block = container.querySelector('[data-command-primary="true"]');
    expect(block?.textContent).toContain("docker ps -a");
    expect(block?.textContent).toContain("查看容器");
    expect(block?.textContent?.indexOf("docker ps -a")).toBeLessThan(
      block?.textContent?.indexOf("查看容器") ?? -1,
    );
  });

  it("suppresses an auto-generated title that duplicates the command", () => {
    expect(getCommandAnnotation(base)).toBe("查看容器");
    expect(
      getCommandAnnotation({ command: "docker ps -a", title: "docker ps -a" }),
    ).toBeNull();
    expect(
      getCommandAnnotation({ command: "Git Status", title: "git status" }),
    ).toBeNull();
    expect(
      getCommandAnnotation({
        command: "a".repeat(100),
        title: `${"a".repeat(80)}…`,
      }),
    ).toBeNull();
  });

  it("renders only the command when no annotation adds information", () => {
    render(
      <CommandPrimary
        command={{ command: "docker ps -a", title: "docker ps -a" }}
      />,
    );
    expect(screen.getAllByText("docker ps -a")).toHaveLength(1);
  });

  it("shows a lightweight AI pending state without a placeholder annotation", () => {
    render(
      <CommandPrimary
        command={{
          ...base,
          title: "docker ps -a",
          aiAnnotationStatus: "pending",
          aiAnnotation: null,
        }}
      />,
    );
    expect(screen.getByText("AI 生成中")).toBeInTheDocument();
    expect(screen.getByText("docker ps -a")).toBeInTheDocument();
  });

  it("builds short labels from the annotation or the first command line", () => {
    expect(commandLabel(base)).toBe("查看容器");
    expect(
      commandLabel({ command: "git status", title: "git status" }),
    ).toBe("git status");
    expect(
      commandLabel({
        command: "a".repeat(80),
        title: "",
      }),
    ).toHaveLength(45);
  });
});
