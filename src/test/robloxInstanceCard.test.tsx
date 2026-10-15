/**
 * Component tests for RobloxInstanceCard.
 *
 * The component parses raw JSON from the `inspect_instance` Studio tool,
 * which arrives in several envelope shapes (plain, MCP content/json,
 * MCP content/text). These tests lock in the parsing + fallback behavior.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RobloxInstanceCard } from "@/components/RobloxInstanceCard";

describe("RobloxInstanceCard", () => {
  it("renders a parsed instance header with its class name", () => {
    const output = JSON.stringify({
      className: "Part",
      path: "game.Workspace.Part",
      Visible: true,
    });
    render(<RobloxInstanceCard output={output} />);

    expect(screen.getByText("Part")).toBeInTheDocument();
  });

  it("expands to show breadcrumbs and properties", () => {
    const output = JSON.stringify({
      className: "Part",
      path: "game.Workspace.Part",
      Anchored: true,
      Transparency: 0.5,
    });
    const { container } = render(<RobloxInstanceCard output={output} />);

    // Collapsed by default — properties not visible yet.
    expect(screen.queryByText("Anchored")).not.toBeInTheDocument();

    fireEvent.click(container.querySelector("button") as HTMLButtonElement);

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Anchored")).toBeInTheDocument();
  });

  it("unwraps the MCP content/json envelope", () => {
    const output = JSON.stringify({
      content: [
        {
          json: { className: "Folder", path: "game.ReplicatedStorage.Folder" },
        },
      ],
    });
    render(<RobloxInstanceCard output={output} />);

    expect(screen.getByText("Folder")).toBeInTheDocument();
  });

  it("unwraps the MCP content/text envelope with an embedded JSON string", () => {
    const inner = JSON.stringify({ className: "Model", path: "game.Workspace.Model" });
    const output = JSON.stringify({ content: [{ text: inner }] });
    render(<RobloxInstanceCard output={output} />);

    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("merges nested `properties` objects into the property list", () => {
    const output = JSON.stringify({
      className: "Part",
      path: "game.Workspace.Part",
      properties: { CanCollide: false },
    });
    const { container } = render(<RobloxInstanceCard output={output} />);

    fireEvent.click(container.querySelector("button") as HTMLButtonElement);
    expect(screen.getByText("CanCollide")).toBeInTheDocument();
  });

  it("falls back to a raw output disclosure when parsing fails", () => {
    const output = "this is not json at all";
    render(<RobloxInstanceCard output={output} />);

    // Fallback header without a class name.
    const toggle = screen.getByText("Inspect Instance");
    expect(screen.queryByText(output)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText(output)).toBeInTheDocument();
  });
});
