import type { Part } from "@opencode-ai/sdk/v2/client";
import { describe, expect, it } from "vitest";

import { latestActivity } from "@/lib/activity";

function toolPart(tool: string): Part {
  return {
    id: "p1",
    sessionID: "s1",
    messageID: "m1",
    type: "tool",
    callID: "c1",
    tool,
    state: { status: "completed" },
  } as unknown as Part;
}

describe("latestActivity", () => {
  it("returns null for empty parts", () => {
    expect(latestActivity(undefined).line).toBeNull();
    expect(latestActivity([]).line).toBeNull();
  });

  it("summarizes a tool part by name", () => {
    const out = latestActivity([toolPart("bash")]);
    expect(out.line).toBe("running a command");
  });

  it("labels MCP tools without the mcp_ prefix", () => {
    const out = latestActivity([toolPart("mcp_roblox_studio_execute_luau")]);
    expect(out.line).toBe("using studio_execute_luau");
  });

  it("prefers the newest reasoning tail as the liveness line", () => {
    const reasoning = {
      id: "p2",
      sessionID: "s1",
      messageID: "m1",
      type: "reasoning",
      text: "Planning zone flow\nNow checking spawn sightlines",
    } as unknown as Part;
    const out = latestActivity([toolPart("read"), reasoning, toolPart("write")]);
    expect(out.line).toBe("Now checking spawn sightlines");
  });

  it("truncates long reasoning lines", () => {
    const long = "x".repeat(200);
    const reasoning = {
      id: "p3",
      sessionID: "s1",
      messageID: "m1",
      type: "reasoning",
      text: long,
    } as unknown as Part;
    const out = latestActivity([reasoning]);
    expect(out.line?.length).toBeLessThanOrEqual(88);
    expect(out.line?.endsWith("…")).toBe(true);
  });

  it("returns null for parts with no reasoning or tool content", () => {
    const step = {
      id: "p4",
      sessionID: "s1",
      messageID: "m1",
      type: "step-start",
    } as unknown as Part;
    expect(latestActivity([step]).line).toBeNull();
  });
});
