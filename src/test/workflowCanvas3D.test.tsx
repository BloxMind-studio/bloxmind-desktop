import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas3D, type WorkflowCanvas3DProps } from "@/components/agent/WorkflowCanvas3D";
import type { AgentDefinition, IsoWorldPos } from "@/lib/agentStudio/types";

const agent: AgentDefinition = {
  id: "agent-1",
  name: "Roblox Data Fetcher",
  role: "Fetches data",
  systemInstructions: "",
  trigger: "Every hour",
  workflow: [
    {
      id: "n1",
      kind: "trigger",
      toolId: "trigger.schedule",
      label: "Schedule / Cron",
      config: { schedule: "every hour" },
      enabled: true,
    },
    {
      id: "n2",
      kind: "fetch",
      toolId: "fetch.httpRequest",
      label: "HTTP Request",
      config: { url: "", method: "GET" },
      enabled: true,
    },
    {
      id: "n3",
      kind: "process",
      toolId: "process.aiSummarize",
      label: "AI Summarize",
      config: { instructions: "Summarize the key points." },
      enabled: true,
    },
  ],
  createdAt: 0,
  updatedAt: 0,
};

function Harness({
  agent: agentProp,
  onSelectNode,
  ...rest
}: Omit<WorkflowCanvas3DProps, "selectedNodeId"> & {
  onSelectNode: (id: string | null) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <WorkflowCanvas3D
      agent={agentProp}
      selectedNodeId={selectedId}
      onSelectNode={(id) => {
        setSelectedId(id);
        onSelectNode(id);
      }}
      {...rest}
    />
  );
}

function setup(overrides: Partial<Omit<WorkflowCanvas3DProps, "selectedNodeId">> = {}) {
  const onSelectNode = vi.fn();
  const onPositionsChange = vi.fn();
  const onLinkNodes = vi.fn();
  const onUnlinkEdge = vi.fn();
  const updateNode = vi.fn();
  const removeNode = vi.fn();
  const onOpenAdd = vi.fn();

  const { container } = render(
    <Harness
      agent={agent}
      onSelectNode={onSelectNode}
      updateNode={updateNode}
      removeNode={removeNode}
      onOpenAdd={onOpenAdd}
      positions={{}}
      onPositionsChange={onPositionsChange}
      onLinkNodes={onLinkNodes}
      onUnlinkEdge={onUnlinkEdge}
      {...overrides}
    />,
  );
  return { container, onSelectNode, onPositionsChange, onLinkNodes, onUnlinkEdge, removeNode };
}

describe("WorkflowCanvas3D interaction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("commits a dragged block position on release", () => {
    const { container, onPositionsChange } = setup();
    const block = container.querySelector('[data-node-id="n2"]');
    const svg = container.querySelector("svg");
    expect(block).not.toBeNull();
    expect(svg).not.toBeNull();

    // Layout origin for n2 is (120, 0): dragging +60/+30px moves it deeper
    // along both isometric axes.
    fireEvent.pointerDown(block as Element, { button: 0 });
    fireEvent.pointerMove(svg as Element, { clientX: 60, clientY: 30 });
    fireEvent.pointerUp(svg as Element, { clientX: 60, clientY: 30 });

    expect(onPositionsChange).toHaveBeenCalledTimes(1);
    const next = onPositionsChange.mock.calls[0][0] as Record<string, IsoWorldPos>;
    expect(next.n2).toBeDefined();
    expect(next.n2.x).toBeGreaterThan(120);
    expect(next.n2.z).toBeLessThan(0);
  });

  it("selects on click and deselects on a second click", () => {
    const { container, onSelectNode } = setup();
    const block = container.querySelector('[data-node-id="n1"]');

    fireEvent.pointerDown(block as Element, { button: 0 });
    fireEvent.pointerUp(container.querySelector("svg") as Element, { button: 0 });
    expect(onSelectNode).toHaveBeenLastCalledWith("n1");

    fireEvent.pointerDown(block as Element, { button: 0 });
    fireEvent.pointerUp(container.querySelector("svg") as Element, { button: 0 });
    expect(onSelectNode).toHaveBeenLastCalledWith(null);
  });

  it("renders every node as a solid cube body with face meshes", () => {
    const { container } = setup();
    for (const nodeId of ["n1", "n2", "n3"]) {
      const block = container.querySelector(`[data-node-id="${nodeId}"]`);
      expect(block).not.toBeNull();
      // Faces are <path> meshes filled with color (see the invisible-cube fix),
      // not stroked outlines.
      const faces = block?.querySelectorAll('path[fill^="#"]') ?? [];
      expect(faces.length).toBeGreaterThanOrEqual(3);
      // Both side handles are attached to this node's cube body.
      expect(block?.querySelector('[data-port="entry"]')).not.toBeNull();
      expect(block?.querySelector('[data-port="exit"]')).not.toBeNull();
    }
  });

  it("starts a connection drag from the exit socket and cancels on empty drop", () => {
    const { container, onLinkNodes } = setup();
    const socket = container.querySelector('[data-node-id="n1"] [data-port="exit"]');
    const svg = container.querySelector("svg");
    expect(socket).not.toBeNull();

    fireEvent.pointerDown(socket as Element, { button: 0 });
    expect(screen.getByTestId("connect-drag-line")).toBeTruthy();

    fireEvent.pointerUp(svg as Element, { button: 0 });
    expect(onLinkNodes).not.toHaveBeenCalled();
    expect(screen.queryByTestId("connect-drag-line")).toBeNull();
  });

  it("locks pipe anchors to the exact port handle coordinates", () => {
    const { container } = setup();
    // Sequential wiring renders n1→n2 and n2→n3.
    for (const [from, to] of [
      ["n1", "n2"],
      ["n2", "n3"],
    ] as const) {
      const out = container.querySelector(`[data-node-id="${from}"] [data-port="exit"]`);
      const input = container.querySelector(`[data-node-id="${to}"] [data-port="entry"]`);
      const pipe = container.querySelector(`[data-testid="pipe-${from}-${to}"] .blox-pipe-flow`);
      expect(out).not.toBeNull();
      expect(input).not.toBeNull();
      expect(pipe).not.toBeNull();

      const d = pipe?.getAttribute("d") ?? "";
      const start = d.match(/^M ([-\d.]+) ([-\d.]+)/);
      expect(start).not.toBeNull();
      const outX = parseFloat(out?.getAttribute("cx") ?? "0");
      const outY = parseFloat(out?.getAttribute("cy") ?? "0");
      // The pipe path is rounded to 1 decimal, so compare within that tolerance.
      expect(Math.abs(parseFloat(start?.[1] ?? "") - outX)).toBeLessThan(0.06);
      expect(Math.abs(parseFloat(start?.[2] ?? "") - outY)).toBeLessThan(0.06);

      const end = d.match(/ ([-\d.]+) ([-\d.]+)$/);
      expect(end).not.toBeNull();
      const inX = parseFloat(input?.getAttribute("cx") ?? "0");
      const inY = parseFloat(input?.getAttribute("cy") ?? "0");
      expect(Math.abs(parseFloat(end?.[1] ?? "") - inX)).toBeLessThan(0.06);
      expect(Math.abs(parseFloat(end?.[2] ?? "") - inY)).toBeLessThan(0.06);
    }
  });

  it("gleams the input/output handles when a pipe is connected to them", () => {
    const { container } = setup();
    const glowOf = (nodeId: string, port: "entry" | "exit") =>
      container
        .querySelector(`[data-node-id="${nodeId}"] [data-port="${port}"]`)
        ?.getAttribute("filter");

    // n1 only sends: its output glows, its input does not.
    expect(glowOf("n1", "exit")).toContain("blox-port-glow");
    expect(glowOf("n1", "entry")).toBeFalsy();
    // n2 both receives and sends.
    expect(glowOf("n2", "entry")).toContain("blox-port-glow");
    expect(glowOf("n2", "exit")).toContain("blox-port-glow");
    // n3 only receives.
    expect(glowOf("n3", "entry")).toContain("blox-port-glow");
    expect(glowOf("n3", "exit")).toBeFalsy();
  });

  it("removes an explicit pipe on double-click", () => {
    const wired = { ...agent, connections: [{ from: "n1", to: "n3" }] };
    const { container, onUnlinkEdge } = setup({ agent: wired });

    const pipe = container.querySelector('[data-testid="pipe-n1-n3"] .blox-pipe-flow');
    expect(pipe).not.toBeNull();

    fireEvent.doubleClick(pipe as Element);
    expect(onUnlinkEdge).toHaveBeenCalledWith("n1", "n3");
  });

  it("deletes the selected block with the Delete key", () => {
    const { container, removeNode } = setup();
    const block = container.querySelector('[data-node-id="n2"]');

    fireEvent.pointerDown(block as Element, { button: 0 });
    fireEvent.pointerUp(container.querySelector("svg") as Element, { button: 0 });
    expect(screen.getByText("Step properties")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Delete" });
    expect(removeNode).toHaveBeenCalledWith("n2");
  });
});
