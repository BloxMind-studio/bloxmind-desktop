import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

import {
  applyMcpServers,
  blenderMcpServer,
  buildMcpConfigPatch,
  type McpServerConfig,
  normalizeEnvironment,
  parseCommandLine,
  toEngineMcpConfig,
  validateMcpServer,
  validateMcpServers,
} from "@/lib/mcpServers";

function local(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: "blender",
    type: "local",
    command: ["uvx", "mcp-for-blender"],
    url: null,
    enabled: true,
    ...overrides,
  };
}

function remote(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: "notes",
    type: "remote",
    command: null,
    url: "https://example.com/mcp",
    enabled: true,
    ...overrides,
  };
}

describe("validateMcpServer", () => {
  it("accepts a complete local server", () => {
    expect(validateMcpServer(local())).toBeNull();
  });

  it("accepts a complete remote server", () => {
    expect(validateMcpServer(remote())).toBeNull();
  });

  it("rejects names outside the allowed pattern", () => {
    expect(validateMcpServer(local({ name: "" }))).not.toBeNull();
    expect(validateMcpServer(local({ name: "has space" }))).not.toBeNull();
    expect(validateMcpServer(local({ name: "x".repeat(49) }))).not.toBeNull();
  });

  it("protects the built-in Studio server name", () => {
    expect(validateMcpServer(local({ name: "roblox-studio" }))).not.toBeNull();
    expect(validateMcpServer(local({ name: "Roblox-Studio" }))).not.toBeNull();
  });

  it("requires a command for local servers and a URL for remote servers", () => {
    expect(validateMcpServer(local({ command: [] }))).not.toBeNull();
    expect(validateMcpServer(local({ command: null }))).not.toBeNull();
    expect(validateMcpServer(remote({ url: "  " }))).not.toBeNull();
    expect(validateMcpServer(remote({ url: "ftp://example.com" }))).not.toBeNull();
    expect(validateMcpServer(remote({ url: "not a url" }))).not.toBeNull();
  });

  it("reports duplicates across a list", () => {
    const errors = validateMcpServers([local(), local({ command: ["other"] })]);
    expect(errors.get("blender")).toBe("Every server needs a unique name.");
  });
});

describe("parseCommandLine", () => {
  it("splits on whitespace", () => {
    expect(parseCommandLine("uvx mcp-for-blender")).toEqual(["uvx", "mcp-for-blender"]);
  });

  it("keeps quoted paths with spaces together", () => {
    expect(parseCommandLine('"C:\\Program Files\\uv\\uvx.exe" run mcp-for-blender')).toEqual([
      "C:\\Program Files\\uv\\uvx.exe",
      "run",
      "mcp-for-blender",
    ]);
  });

  it("handles single quotes and collapsed whitespace", () => {
    expect(parseCommandLine("  'a b'   c ")).toEqual(["a b", "c"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseCommandLine("   ")).toEqual([]);
  });
});

describe("normalizeEnvironment", () => {
  it("keeps string values and drops blank keys", () => {
    expect(normalizeEnvironment({ A: "1", " ": "x", B: "two" })).toEqual({ A: "1", B: "two" });
  });

  it("returns null for nothing usable", () => {
    expect(normalizeEnvironment(null)).toBeNull();
    expect(normalizeEnvironment(undefined)).toBeNull();
    expect(normalizeEnvironment({})).toBeNull();
  });
});

describe("buildMcpConfigPatch", () => {
  it("writes full entries, including the enabled flag", () => {
    const patch = buildMcpConfigPatch([local({ enabled: false })]);
    expect(patch).toEqual({
      blender: { type: "local", command: ["uvx", "mcp-for-blender"], enabled: false },
    });
  });

  it("skips invalid entries and the reserved Studio name", () => {
    const patch = buildMcpConfigPatch([
      local({ name: "roblox-studio" }),
      local({ name: "broken", command: [] }),
      remote(),
    ]);
    expect(patch).toEqual({
      notes: { type: "remote", url: "https://example.com/mcp", enabled: true },
    });
  });

  it("disables removed servers without clobbering live ones", () => {
    const patch = buildMcpConfigPatch([local()], ["gone", "roblox-studio"]);
    expect(patch).toEqual({
      blender: { type: "local", command: ["uvx", "mcp-for-blender"], enabled: true },
      gone: { enabled: false },
    });
  });
});

describe("toEngineMcpConfig", () => {
  it("copies the command so callers can't mutate the source", () => {
    const server = local();
    const entry = toEngineMcpConfig(server);
    expect(entry).toEqual({
      type: "local",
      command: ["uvx", "mcp-for-blender"],
      enabled: true,
    });
    if (entry.type === "local") entry.command.push("extra");
    expect(server.command).toEqual(["uvx", "mcp-for-blender"]);
  });

  it("passes environment variables through for local servers", () => {
    const entry = toEngineMcpConfig(local({ environment: { DISABLE_TELEMETRY: "1" } }));
    expect(entry).toEqual({
      type: "local",
      command: ["uvx", "mcp-for-blender"],
      environment: { DISABLE_TELEMETRY: "1" },
      enabled: true,
    });
  });

  it("omits empty environments and never sends them for remote servers", () => {
    expect(toEngineMcpConfig(local({ environment: {} }))).toEqual({
      type: "local",
      command: ["uvx", "mcp-for-blender"],
      enabled: true,
    });
    expect(toEngineMcpConfig(local({ environment: null }))).toEqual({
      type: "local",
      command: ["uvx", "mcp-for-blender"],
      enabled: true,
    });
    expect(toEngineMcpConfig(remote({ environment: { A: "1" } }))).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      enabled: true,
    });
  });
});

describe("applyMcpServers", () => {
  function clientWithMcp() {
    const update = vi.fn().mockResolvedValue({});
    const connect = vi.fn().mockResolvedValue({ data: true });
    const disconnect = vi.fn().mockResolvedValue({ data: true });
    const client = {
      global: { config: { update } },
      mcp: { connect, disconnect },
    } as unknown as OpencodeClient;
    return { update, connect, disconnect, client };
  }

  it("patches the engine config, then connects enabled servers", async () => {
    const { update, connect, disconnect, client } = clientWithMcp();
    await applyMcpServers(client, [local(), remote({ enabled: false })]);

    expect(update).toHaveBeenCalledWith(
      {
        config: {
          mcp: {
            blender: { type: "local", command: ["uvx", "mcp-for-blender"], enabled: true },
            notes: { type: "remote", url: "https://example.com/mcp", enabled: false },
          },
        },
      },
      { throwOnError: true },
    );
    expect(connect).toHaveBeenCalledWith({ name: "blender" });
    expect(disconnect).toHaveBeenCalledWith({ name: "notes" });
  });

  it("disconnects removed servers", async () => {
    const { disconnect, client } = clientWithMcp();
    await applyMcpServers(client, [], ["gone"]);
    expect(disconnect).toHaveBeenCalledWith({ name: "gone" });
  });

  it("skips the config update when there is nothing to write", async () => {
    const { update, client } = clientWithMcp();
    await applyMcpServers(client, []);
    expect(update).not.toHaveBeenCalled();
  });

  it("survives individual connect or disconnect failures", async () => {
    const { connect, disconnect, client } = clientWithMcp();
    connect.mockRejectedValue(new Error("not known"));
    disconnect.mockRejectedValue(new Error("not known"));
    await expect(applyMcpServers(client, [local()], ["gone"])).resolves.toBeUndefined();
  });

  it("propagates config update failures to the caller", async () => {
    const { update, connect, client } = clientWithMcp();
    update.mockRejectedValue(new Error("400"));
    await expect(applyMcpServers(client, [local()])).rejects.toThrow("400");
    expect(connect).not.toHaveBeenCalled();
  });

  it("does nothing when the client lacks the mcp surface", async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = { global: { config: { update } } } as unknown as OpencodeClient;
    await expect(applyMcpServers(client, [local()])).resolves.toBeUndefined();
    expect(update).toHaveBeenCalled();
  });
});

describe("blenderMcpServer", () => {
  it("describes the standard bridge server with telemetry off", () => {
    expect(blenderMcpServer()).toEqual({
      name: "blender",
      type: "local",
      command: ["uvx", "mcp-for-blender"],
      url: null,
      enabled: true,
      environment: { DISABLE_TELEMETRY: "1" },
    });
  });

  it("uses the uvx path from the automated setup", () => {
    expect(blenderMcpServer("C:\\Users\\User\\.local\\bin\\uvx.exe").command).toEqual([
      "C:\\Users\\User\\.local\\bin\\uvx.exe",
      "mcp-for-blender",
    ]);
  });
});
