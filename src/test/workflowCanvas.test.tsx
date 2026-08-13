import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvas } from "@/components/agent/WorkflowCanvas";
import type { AgentDefinition } from "@/lib/agentStudio/types";

const { updateAgentMock, runAgentMock } = vi.hoisted(() => ({
  updateAgentMock: vi.fn(),
  runAgentMock: vi.fn(),
}));

vi.mock("@/providers/AgentStudioProvider", () => ({
  useAgentStudio: () => ({
    updateAgent: updateAgentMock,
    runAgent: runAgentMock,
  }),
}));

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

function renderCanvas() {
  return render(<WorkflowCanvas agent={agent} />);
}

describe("WorkflowCanvas dual view", () => {
  afterEach(() => {
    updateAgentMock.mockClear();
    runAgentMock.mockClear();
  });

  it("defaults to the 3D isometric view", () => {
    renderCanvas();
    expect(screen.getByTestId("workflow-canvas-3d")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Workflow view mode" })).toBeTruthy();
  });

  it("switches between 2D and 3D views", () => {
    const { container } = renderCanvas();
    expect(screen.getByTestId("workflow-canvas-3d")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /2d/i }));
    expect(screen.queryByTestId("workflow-canvas-3d")).toBeNull();
    expect(container.querySelectorAll('[data-testid="workflow-canvas-3d"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /3d/i }));
    expect(screen.getByTestId("workflow-canvas-3d")).toBeTruthy();
  });

  it("renders a block per node in 3D", () => {
    const { container } = renderCanvas();
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(3);
  });

  it("opens and edits block properties on click in 3D, syncing back to state", () => {
    const { container } = renderCanvas();
    const block = container.querySelector('[data-node-id="n2"]');
    expect(block).not.toBeNull();

    fireEvent.pointerDown(block as Element);
    expect(screen.getByText("Step properties")).toBeTruthy();

    const urlInput = screen.getByDisplayValue("") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://api.example.com/data" } });

    const updated = updateAgentMock.mock.calls[0][0] as AgentDefinition;
    const httpNode = updated.workflow.find((node) => node.id === "n2");
    expect(httpNode?.config.url).toBe("https://api.example.com/data");
  });

  it("keeps the selection in sync when flipping to 2D and back", () => {
    const { container } = renderCanvas();
    fireEvent.pointerDown(container.querySelector('[data-node-id="n3"]') as Element);
    expect(screen.getByText("Step properties")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /2d/i }));
    expect(document.querySelector('[data-testid="workflow-canvas-3d"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /3d/i }));
    expect(screen.getByText("Step properties")).toBeTruthy();
  });

  it("deselects with the Escape key", () => {
    const { container } = renderCanvas();
    fireEvent.pointerDown(container.querySelector('[data-node-id="n1"]') as Element);
    expect(screen.getByText("Step properties")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Step properties")).toBeNull();
  });
});
