import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useNodePositions } from "@/lib/agentStudio/useNodePositions";

describe("useNodePositions", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("starts with no positions for a fresh agent", () => {
    const { result } = renderHook(() => useNodePositions("agent-a"));
    expect(result.current.positions).toEqual({});
  });

  it("persists dragged positions under the agent key and restores them on remount", () => {
    const first = renderHook(() => useNodePositions("agent-a"));
    act(() => {
      first.result.current.setPositions({ "node-1": { x: 5, z: 9 } });
    });

    // Simulates the canvas remounting (view/mode toggle, page re-entry).
    first.unmount();
    const second = renderHook(() => useNodePositions("agent-a"));
    expect(second.result.current.positions).toEqual({ "node-1": { x: 5, z: 9 } });
  });

  it("supports functional updates that merge on top of stored positions", () => {
    const first = renderHook(() => useNodePositions("agent-a"));
    act(() => {
      first.result.current.setPositions({ "node-1": { x: 1, z: 1 } });
    });
    act(() => {
      first.result.current.setPositions((current) => ({
        ...current,
        "node-2": { x: 2, z: 2 },
      }));
    });

    const remounted = renderHook(() => useNodePositions("agent-a"));
    expect(remounted.result.current.positions).toEqual({
      "node-1": { x: 1, z: 1 },
      "node-2": { x: 2, z: 2 },
    });
  });

  it("keeps agents isolated so switching agents never leaks a self layout", () => {
    const agentA = renderHook(() => useNodePositions("agent-a"));
    act(() => {
      agentA.result.current.setPositions({ "node-1": { x: 3, z: 0 } });
    });

    const agentB = renderHook(() => useNodePositions("agent-b"));
    expect(agentB.result.current.positions).toEqual({});
  });

  it("drops a removed node's position without touching the rest", () => {
    const hook = renderHook(() => useNodePositions("agent-a"));
    act(() => {
      hook.result.current.setPositions({
        "node-1": { x: 1, z: 1 },
        "node-2": { x: 2, z: 2 },
      });
    });
    act(() => {
      hook.result.current.removePosition("node-1");
    });

    const remounted = renderHook(() => useNodePositions("agent-a"));
    expect(remounted.result.current.positions).toEqual({ "node-2": { x: 2, z: 2 } });
  });

  it("resets to the default layout and forgets the saved positions", () => {
    const hook = renderHook(() => useNodePositions("agent-a"));
    act(() => {
      hook.result.current.setPositions({ "node-1": { x: 1, z: 1 } });
    });
    act(() => {
      hook.result.current.resetPositions();
    });

    const remounted = renderHook(() => useNodePositions("agent-a"));
    expect(remounted.result.current.positions).toEqual({});
  });

  it("ignores corrupted storage and starts from the default layout", () => {
    window.localStorage.setItem("BloxMind-agent-positions:agent-a", "{not json");
    const hook = renderHook(() => useNodePositions("agent-a"));
    expect(hook.result.current.positions).toEqual({});
  });
});
