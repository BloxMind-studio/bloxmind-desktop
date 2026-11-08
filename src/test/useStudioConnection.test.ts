import { describe, expect, it, vi } from "vitest";

import {
  checkStudioConnection,
  STUDIO_CHECK_TIMEOUT_MS,
  studioMcpProblem,
} from "@/hooks/useStudioConnection";

describe("studioMcpProblem", () => {
  it("only surfaces states that need the user to act", () => {
    expect(studioMcpProblem(undefined)).toBeNull();
    expect(studioMcpProblem({ state: "starting" })).toBeNull();
    expect(studioMcpProblem({ state: "connected" })).toBeNull();
    expect(studioMcpProblem({ state: "not_installed" })).toBe("not_installed");
    expect(studioMcpProblem({ state: "unavailable" })).toBe("unavailable");
  });
});

describe("checkStudioConnection", () => {
  it("reports an existing Studio connection without reconnecting", async () => {
    const client = {
      mcp: {
        status: vi.fn().mockResolvedValue({
          data: { "roblox-studio": { status: "connected" } },
        }),
        connect: vi.fn(),
      },
    };

    await expect(checkStudioConnection(client as never)).resolves.toBe("connected");
    expect(client.mcp.connect).not.toHaveBeenCalled();
  });

  it("retries the Studio connection and detects when setup is complete", async () => {
    const client = {
      mcp: {
        status: vi
          .fn()
          .mockResolvedValueOnce({ data: { "roblox-studio": { status: "failed" } } })
          .mockResolvedValueOnce({ data: { "roblox-studio": { status: "connected" } } }),
        connect: vi.fn().mockResolvedValue({}),
      },
    };

    await expect(checkStudioConnection(client as never)).resolves.toBe("connected");
    expect(client.mcp.connect).toHaveBeenCalledWith({ name: "roblox-studio" });
  });

  it("keeps waiting when the MCP still reports a failed connection", async () => {
    const client = {
      mcp: {
        status: vi.fn().mockResolvedValue({ data: { "roblox-studio": { status: "failed" } } }),
        connect: vi.fn().mockResolvedValue({}),
      },
    };

    await expect(checkStudioConnection(client as never)).resolves.toBe("waiting");
  });

  it("keeps waiting when Studio is unavailable", async () => {
    const client = {
      mcp: {
        status: vi.fn().mockRejectedValue(new Error("Studio is closed")),
        connect: vi.fn(),
      },
    };

    await expect(checkStudioConnection(client as never)).resolves.toBe("waiting");
  });
});

describe("checkStudioConnection concurrency", () => {
  it("shares one in-flight check instead of piling up calls on the client", async () => {
    vi.useFakeTimers();
    try {
      const status = vi.fn().mockReturnValue(new Promise(() => {}));
      const client = { mcp: { status, connect: vi.fn() } };

      const first = checkStudioConnection(client as never);
      const second = checkStudioConnection(client as never);

      expect(client.mcp.status).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(STUDIO_CHECK_TIMEOUT_MS);
      await expect(first).resolves.toBe("waiting");
      await expect(second).resolves.toBe("waiting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up waiting after the timeout and lets the next poll start fresh", async () => {
    vi.useFakeTimers();
    try {
      const status = vi.fn().mockReturnValue(new Promise(() => {}));
      const client = { mcp: { status, connect: vi.fn() } };

      const first = checkStudioConnection(client as never);
      await vi.advanceTimersByTimeAsync(STUDIO_CHECK_TIMEOUT_MS);
      await expect(first).resolves.toBe("waiting");

      const second = checkStudioConnection(client as never);
      await vi.advanceTimersByTimeAsync(STUDIO_CHECK_TIMEOUT_MS);
      await expect(second).resolves.toBe("waiting");

      expect(status).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
