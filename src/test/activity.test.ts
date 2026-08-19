import type { Event } from "@opencode-ai/sdk/v2/client";
import { describe, expect, it } from "vitest";
import {
  type ActivityFeed,
  applyActivityEvent,
  createActivityFeed,
} from "@/lib/appsBuilder/activity";

function toolEvent(type: string, sessionID: string, props: Record<string, unknown> = {}): Event {
  return {
    id: "evt",
    type,
    properties: { sessionID, ...props },
  } as unknown as Event;
}

describe("activity feed", () => {
  it("surfaces reasoning, step, and text events so the log is never bare", () => {
    let feed: ActivityFeed = createActivityFeed();
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.reasoning.started", "s1", {}),
      "s1",
    );
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.reasoning.delta", "s1", { delta: "design the arena" }),
      "s1",
    );
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]?.title).toBe("Thinking through the approach…");

    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.step.started", "s1", {}),
      "s1",
    );
    expect(feed.entries[1]?.title).toBe("Planning the next step…");

    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.text.started", "s1", {}),
      "s1",
    );
    expect(feed.entries[2]?.title).toBe("Writing code…");
  });

  it("appends running entries for tool calls with exact paths", () => {
    let feed: ActivityFeed = createActivityFeed();
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", {
        tool: "write",
        callID: "c1",
        input: { path: "src/main.tsx" },
      }),
      "s1",
    );
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]).toMatchObject({
      status: "running",
      title: "Creating file",
      path: "src/main.tsx",
      callID: "c1",
    });
  });

  it("labels edits, bash installs/tests, and unknown tools", () => {
    let feed: ActivityFeed = createActivityFeed();
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", {
        tool: "edit",
        callID: "e1",
        input: { filePath: "src/App.tsx" },
      }),
      "s1",
    );
    expect(feed.entries[0]?.title).toBe("Editing file");
    expect(feed.entries[0]?.path).toBe("src/App.tsx");

    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", {
        tool: "bash",
        callID: "b1",
        input: { command: "npm install three" },
      }),
      "s1",
    );
    expect(feed.entries[1]?.title).toBe("Installing packages");

    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", {
        tool: "bash",
        callID: "b2",
        input: { command: "npm test" },
      }),
      "s1",
    );
    expect(feed.entries[2]?.title).toBe("Running tests");

    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", { tool: "mystery", callID: "m1", input: {} }),
      "s1",
    );
    expect(feed.entries[3]?.title).toBe("Running tool");
  });

  it("flips a running entry to success when its callID resolves", () => {
    let feed: ActivityFeed = createActivityFeed();
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", {
        tool: "write",
        callID: "c1",
        input: { path: "src/App.tsx" },
      }),
      "s1",
    );
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.success", "s1", { callID: "c1" }),
      "s1",
    );
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]?.status).toBe("success");
    expect(feed.entries[0]?.title).toBe("Creating file — done");
  });

  it("marks a running entry as failed and keeps the error message", () => {
    let feed: ActivityFeed = createActivityFeed();
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", {
        tool: "write",
        callID: "c1",
        input: { path: "src/SkyRacer.tsx" },
      }),
      "s1",
    );
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.failed", "s1", {
        callID: "c1",
        error: { message: "line 42: cannot read property" },
      }),
      "s1",
    );
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]?.status).toBe("error");
    expect(feed.entries[0]?.title).toBe("Creating file failed");
    expect(feed.entries[0]?.detail).toBe("line 42: cannot read property");
  });

  it("appends standalone error entries for step failures and retries", () => {
    let feed: ActivityFeed = createActivityFeed();
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.step.failed", "s1", {
        error: { message: "compile failed" },
      }),
      "s1",
    );
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.retried", "s1", { error: { message: "retry" } }),
      "s1",
    );
    expect(feed.entries.map((entry) => entry.status)).toEqual(["error", "error"]);
    expect(feed.entries[0]?.detail).toBe("compile failed");
  });

  it("ignores events from other sessions and non-activity events", () => {
    let feed: ActivityFeed = createActivityFeed();
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s2", {
        tool: "write",
        callID: "c1",
        input: { path: "src/other.tsx" },
      }),
      "s1",
    );
    feed = applyActivityEvent(
      feed,
      toolEvent("session.next.text.delta", "s1", { delta: "hi" }),
      "s1",
    );
    expect(feed.entries).toHaveLength(0);
  });

  it("returns a fresh reference on every mutation for React state", () => {
    const feed: ActivityFeed = createActivityFeed();
    const next = applyActivityEvent(
      feed,
      toolEvent("session.next.tool.called", "s1", {
        tool: "write",
        callID: "c1",
        input: { path: "src/App.tsx" },
      }),
      "s1",
    );
    expect(next).not.toBe(feed);
  });
});
