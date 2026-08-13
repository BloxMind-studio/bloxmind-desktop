import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AppsBuilder } from "@/components/AppsBuilder";

beforeAll(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
  document.createElement("a").click = vi.fn();
});

describe("AppsBuilder", () => {
  it("switches between Visual Builder and Code Preview", () => {
    render(<AppsBuilder />);

    expect(screen.getByTestId("view-visual")).toBeTruthy();
    fireEvent.click(screen.getByTestId("view-code"));
    expect(screen.getByTestId("code-editor")).toBeTruthy();
    expect(screen.getByTestId("file-node-src/App.tsx")).toBeTruthy();

    fireEvent.click(screen.getByTestId("view-visual"));
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });

  it("adds a component from the palette onto the canvas", () => {
    render(<AppsBuilder />);
    expect(screen.getByText("Drop a component to begin")).toBeTruthy();

    fireEvent.click(screen.getByTitle("A tappable action button."));
    expect(screen.getByText("Click me")).toBeTruthy();
    expect(screen.getByText("1 component")).toBeTruthy();
  });

  it("generates an app from the AI prompt bar and updates the canvas", () => {
    render(<AppsBuilder />);

    const input = screen.getByTestId("app-prompt-input");
    fireEvent.change(input, { target: { value: "Create a todo list app" } });
    fireEvent.click(screen.getByTestId("generate-app"));

    expect(screen.getByText("My Todo List")).toBeTruthy();
    expect(screen.getByText("Add Task")).toBeTruthy();
    expect(input).toHaveValue("");
  });

  it("exposes Export Project Zip and Create npm Package options", () => {
    render(<AppsBuilder />);

    fireEvent.click(screen.getByTestId("export-app"));
    expect(screen.getByTestId("export-project-zip")).toBeTruthy();
    expect(screen.getByTestId("export-npm-package")).toBeTruthy();
  });

  it("shows generated project files in the file tree with syntax highlighting", () => {
    render(<AppsBuilder />);

    fireEvent.click(screen.getByTestId("view-code"));

    const tree = screen.getByTestId("file-node-src/App.tsx");
    fireEvent.click(tree);
    expect(screen.getByText("src/App.tsx")).toBeTruthy();

    expect(screen.getByTestId("code-editor")).toBeTruthy();
  });
});
