import type { Event } from "@opencode-ai/sdk/v2/client";
import { describe, expect, it } from "vitest";
import {
  BUILD_PHASES,
  BUILD_STEP_LABELS,
  buildPhaseFromEvent,
  buildPhaseIndex,
  extractAgentState,
} from "@/lib/appsBuilder/buildProgress";

function event(type: string, sessionID: string): Event {
  return { id: "evt", type, properties: { sessionID } } as unknown as Event;
}

describe("buildProgress", () => {
  it("defines ordered phases with one checklist label each", () => {
    expect(BUILD_PHASES).toEqual([
      "analyzing",
      "designing",
      "writing",
      "transpiling",
      "finalizing",
    ]);
    expect(BUILD_STEP_LABELS).toHaveLength(BUILD_PHASES.length);
    expect(buildPhaseIndex("analyzing")).toBe(0);
    expect(buildPhaseIndex("writing")).toBe(2);
    expect(buildPhaseIndex("finalizing")).toBe(4);
  });

  it("maps session stream events to LLM phases", () => {
    const sessionID = "sess-1";
    expect(buildPhaseFromEvent(event("session.next.prompted", sessionID), sessionID)).toBe(
      "analyzing",
    );
    expect(buildPhaseFromEvent(event("session.next.prompt.admitted", sessionID), sessionID)).toBe(
      "analyzing",
    );
    expect(buildPhaseFromEvent(event("session.next.step.started", sessionID), sessionID)).toBe(
      "designing",
    );
    expect(buildPhaseFromEvent(event("session.next.reasoning.delta", sessionID), sessionID)).toBe(
      "designing",
    );
    expect(buildPhaseFromEvent(event("session.next.text.started", sessionID), sessionID)).toBe(
      "writing",
    );
    expect(buildPhaseFromEvent(event("session.next.text.delta", sessionID), sessionID)).toBe(
      "writing",
    );
    expect(buildPhaseFromEvent(event("session.next.tool.called", sessionID), sessionID)).toBe(
      "writing",
    );
    expect(buildPhaseFromEvent(event("session.next.step.ended", sessionID), sessionID)).toBe(
      "writing",
    );
    expect(buildPhaseFromEvent(event("session.idle", sessionID), sessionID)).toBe("writing");
  });

  it("ignores events from other sessions and non-progress events", () => {
    expect(buildPhaseFromEvent(event("session.next.text.delta", "sess-2"), "sess-1")).toBeNull();
    expect(buildPhaseFromEvent(event("session.updated", "sess-1"), "sess-1")).toBeNull();
    expect(buildPhaseFromEvent(event("message.part.updated", "sess-1"), "sess-1")).toBeNull();
  });

  it("extracts live agent state labels from tool.called events", () => {
    const sessionID = "sess-1";
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.called",
          properties: {
            sessionID,
            tool: "write",
            input: { path: "src/main.tsx" },
          },
        } as unknown as Event,
        sessionID,
      ),
    ).toEqual({ kind: "writing", label: "Creating src/main.tsx" });
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.called",
          properties: {
            sessionID,
            tool: "edit",
            input: { filePath: "src/App.tsx" },
          },
        } as unknown as Event,
        sessionID,
      ),
    ).toEqual({ kind: "editing", label: "Editing src/App.tsx" });
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.called",
          properties: { sessionID, tool: "read", input: { path: "src/App.tsx" } },
        } as unknown as Event,
        sessionID,
      ),
    ).toEqual({ kind: "reading", label: "Reading project files…" });
  });

  it("labels installing, testing, and error-fixing states", () => {
    const sessionID = "sess-1";
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.called",
          properties: { sessionID, tool: "bash", input: { command: "npm install" } },
        } as unknown as Event,
        sessionID,
      ),
    ).toEqual({ kind: "running", label: "Installing npm packages…" });
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.called",
          properties: { sessionID, tool: "bash", input: { command: "npm test" } },
        } as unknown as Event,
        sessionID,
      ),
    ).toEqual({ kind: "testing", label: "Running tests…" });
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.failed",
          properties: { sessionID },
        } as unknown as Event,
        sessionID,
      ),
    ).toEqual({ kind: "fixing", label: "Fixing an error…" });
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.retried",
          properties: { sessionID },
        } as unknown as Event,
        sessionID,
      ),
    ).toEqual({ kind: "fixing", label: "Retrying…" });
  });

  it("ignores agent state from other sessions and neutral events", () => {
    const sessionID = "sess-1";
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.called",
          properties: { sessionID: "sess-2", tool: "write", input: { path: "x.ts" } },
        } as unknown as Event,
        sessionID,
      ),
    ).toBeNull();
    expect(
      extractAgentState(
        {
          id: "evt",
          type: "session.next.tool.success",
          properties: { sessionID },
        } as unknown as Event,
        sessionID,
      ),
    ).toBeNull();
  });
});
