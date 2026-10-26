import { describe, expect, it } from "vitest";
import { baseToolName } from "@/lib/toolName";

describe("baseToolName", () => {
  it("leaves builtin tool names alone", () => {
    expect(baseToolName("bash")).toBe("bash");
    expect(baseToolName("todowrite")).toBe("todowrite");
  });

  it("strips a server name without underscores", () => {
    expect(baseToolName("mcp_roblox-studio_inspect_instance")).toBe("inspect_instance");
  });

  it("strips a server name containing underscores", () => {
    expect(baseToolName("mcp_my_server_todowrite")).toBe("todowrite");
  });

  it("strips a multi-segment server name", () => {
    expect(baseToolName("mcp_team_roblox_studio_read")).toBe("read");
  });

  it("prefers the longest matching tool name", () => {
    expect(baseToolName("mcp_my_server_todowrite")).toBe("todowrite");
    expect(baseToolName("mcp_todowrite_write")).toBe("write");
  });

  it("leaves unknown MCP tools untouched", () => {
    expect(baseToolName("mcp_my_server_run_code")).toBe("mcp_my_server_run_code");
  });
});
