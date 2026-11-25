import { describe, expect, it, vi } from "vitest";
import { type CallStudioTool, editExplorerObject } from "../../electron/studioQueries";

const callTool = (text: string, isError = false) =>
  vi.fn<CallStudioTool>(async () => ({
    content: [{ type: "text" as const, text }],
    isError,
  }));

describe("Explorer edits", () => {
  it("writes a property as one Studio change and keeps the object's name", async () => {
    const tool = callTool(JSON.stringify({ name: "Workspace" }));
    const result = await editExplorerObject(tool, "studio-1", {
      action: "setField",
      kind: "property",
      field: "StreamingEnabled",
      value: "true",
      valueType: "boolean",
      path: "game.Workspace",
      className: "Workspace",
    });

    expect(result).toEqual({ name: "Workspace" });
    expect(tool).toHaveBeenCalledOnce();
    const [name, args] = tool.mock.calls[0];
    expect(name).toBe("execute_luau");
    const code = String(args.code);
    expect(code).toContain('instance["StreamingEnabled"] = valueFromText("boolean"');
    expect(code).toContain("local name = instance.Name");
    expect(args.datamodel_type).toBe("Edit");
  });

  it("finds the named object before changing it", async () => {
    const tool = callTool(JSON.stringify({ name: "Crate" }));
    await editExplorerObject(tool, "studio-1", {
      action: "setField",
      kind: "attribute",
      field: "Health",
      value: "75",
      valueType: "number",
      path: "game.Workspace.Crate",
      className: "Part",
    });
    const code = String(tool.mock.calls[0][1].code);
    expect(code).toContain('instance:GetAttribute("Health")');
    expect(code).toContain('instance.ClassName ~= "Part"');
  });

  it("reports Studio's answer when the edit is refused", async () => {
    const tool = callTool("You can't change that in playtest", true);
    await expect(
      editExplorerObject(tool, "studio-1", {
        action: "setField",
        kind: "property",
        field: "Position",
        value: "1, 2, 3",
        valueType: "Vector3",
        path: "game.Workspace.Part",
        className: "Part",
      }),
    ).rejects.toThrow("You can't change that in playtest");
  });
});
