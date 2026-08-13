import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioMcpUpstream } from "../../electron/services/StudioMcpBroker";
import { startStudioMcpBroker } from "../../electron/services/StudioMcpBroker";

const tools: Tool[] = [
  {
    name: "inspect_place",
    description: "Read the place",
    inputSchema: { type: "object", properties: { depth: { type: "number" } } },
  },
];

function fakeUpstream(overrides: Partial<StudioMcpUpstream> = {}): StudioMcpUpstream {
  return {
    listTools: vi.fn().mockResolvedValue({ tools }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
    onToolsChanged: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function connect(info: { url: string; token: string }) {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(info.url), {
    requestInit: { headers: { Authorization: `Bearer ${info.token}` } },
  });
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

describe("Studio MCP broker", () => {
  it("binds the OpenCode adapter to loopback and returns a separate bearer token", async () => {
    const broker = await startStudioMcpBroker(fakeUpstream());
    cleanups.push(() => broker.close());

    expect(broker.info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(broker.info.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(broker.info.url).not.toContain("token=");
  });

  it("rejects requests without a valid broker token", async () => {
    const broker = await startStudioMcpBroker(fakeUpstream());
    cleanups.push(() => broker.close());

    // No token at all → 401.
    const first = await fetch(broker.info.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }),
    });
    expect(first.status).toBe(401);

    // Wrong token → 401.
    const second = await fetch(broker.info.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-the-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }),
    });
    expect(second.status).toBe(401);
  });

  it("accepts the broker token via the Authorization header", async () => {
    const broker = await startStudioMcpBroker(fakeUpstream());
    cleanups.push(() => broker.close());

    const res = await fetch(broker.info.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${broker.info.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }),
    });
    // Auth passed (any non-401). A raw fetch of initialize is not a complete
    // MCP session exchange, so status may be 400 from the transport.
    expect(res.status).not.toBe(401);
  });

  it("forwards tool discovery and calls over standard MCP transport", async () => {
    const upstream = fakeUpstream();
    const broker = await startStudioMcpBroker(upstream);
    cleanups.push(() => broker.close());
    const client = await connect(broker.info);

    await expect(client.listTools()).resolves.toEqual({ tools });
    await expect(
      client.callTool({ name: "inspect_place", arguments: { depth: 3 } }),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "ok" }] });
    expect(upstream.callTool).toHaveBeenCalledWith("inspect_place", { depth: 3 });
  });

  it("closes the single upstream Studio client", async () => {
    const upstream = fakeUpstream();
    const broker = await startStudioMcpBroker(upstream);

    await broker.close();
    expect(upstream.close).toHaveBeenCalledOnce();
  });
});
