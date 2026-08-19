import { Box, List, Play, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { iconFor } from "@/lib/agentStudio/icons";
import { TOOL_BY_ID, TOOLS } from "@/lib/agentStudio/tools";
import type { AgentDefinition, NodeKind, WorkflowNode } from "@/lib/agentStudio/types";
import { useNodePositions } from "@/lib/agentStudio/useNodePositions";
import { useAgentStudio } from "@/providers/AgentStudioProvider";
import { NODE_KINDS } from "./NodeEditor";
import { WorkflowCanvas2D } from "./WorkflowCanvas2D";
import { WorkflowCanvas3D } from "./WorkflowCanvas3D";

export type WorkflowViewMode = "2d" | "3d";

/**
 * Top-level workflow builder. Hosts a shared toolbar (add step, Run, and the
 * 2D/3D view toggle) and renders the pipeline in either the flat 2D list or
 * the isometric 3D canvas. Both views operate on the same workflow state, so
 * any edit is mirrored instantly between them.
 */
export function WorkflowCanvas({
  agent,
  className = "",
}: {
  agent: AgentDefinition;
  className?: string;
}) {
  const { updateAgent, runAgent } = useAgentStudio();
  const [viewMode, setViewMode] = useState<WorkflowViewMode>("3d");
  const [addingKind, setAddingKind] = useState<NodeKind | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /** Block positions dragged by the user on the 3D floor plane. */
  const {
    positions,
    setPositions: savePositions,
    removePosition,
    resetPositions,
  } = useNodePositions(agent.id);

  const addTool = useMemo(() => TOOLS.filter((tool) => tool.category === addingKind), [addingKind]);

  const updateNode = (updated: WorkflowNode) => {
    updateAgent({
      ...agent,
      workflow: agent.workflow.map((node) => (node.id === updated.id ? updated : node)),
    });
  };

  const removeNode = useCallback(
    (nodeId: string) => {
      updateAgent({
        ...agent,
        workflow: agent.workflow.filter((node) => node.id !== nodeId),
        connections: agent.connections?.filter(
          (edge) => edge.from !== nodeId && edge.to !== nodeId,
        ),
      });
      removePosition(nodeId);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [agent, updateAgent, removePosition, selectedNodeId],
  );

  const linkNodes = (from: string, to: string) => {
    if (from === to) return;
    const connections = [
      ...(agent.connections ?? []).filter((edge) => edge.to !== to),
      { from, to },
    ];
    updateAgent({ ...agent, connections });
  };

  const unlinkEdge = (from: string, to: string) => {
    const connections = (agent.connections ?? []).filter(
      (edge) => edge.from !== from || edge.to !== to,
    );
    updateAgent({ ...agent, connections });
  };

  function addNode(toolId: string) {
    const tool = TOOL_BY_ID.get(toolId);
    if (!tool) return;
    const node: WorkflowNode = {
      id: `node-${Math.random().toString(36).slice(2, 10)}`,
      kind: tool.category,
      toolId,
      label: tool.name,
      config: { ...tool.defaultConfig },
      enabled: true,
    };
    updateAgent({ ...agent, workflow: [...agent.workflow, node] });
    setAddingKind(null);
    setSelectedNodeId(node.id);
  }

  function moveNode(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= agent.workflow.length) return;
    const next = [...agent.workflow];
    const [node] = next.splice(index, 1);
    next.splice(target, 0, node);
    updateAgent({ ...agent, workflow: next });
  }

  const hasEnabled = agent.workflow.some((node) => node.enabled);

  // Keyboard shortcuts: Delete/Backspace removes the selected node, Escape
  // deselects. Shortcuts are suppressed while typing in an input/textarea.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedNodeId) {
          event.preventDefault();
          removeNode(selectedNodeId);
        }
      }

      if (event.key === "Escape") {
        setSelectedNodeId(null);
        setAddingKind(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, removeNode]);

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-sm font-semibold">Workflow</h4>
        <button
          type="button"
          onClick={() => setAddingKind((current) => (current === null ? "action" : null))}
          aria-expanded={addingKind !== null}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-hover/12"
          title="Add a step"
        >
          <Plus aria-hidden="true" size={12} />
          Add step
        </button>

        <div className="ml-auto flex items-center gap-2">
          <fieldset className="inline-flex items-center rounded-lg border bg-card/80 p-0.5">
            <legend className="sr-only">Workflow view mode</legend>
            <button
              type="button"
              onClick={() => setViewMode("2d")}
              aria-pressed={viewMode === "2d"}
              title="2D view"
              className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
                viewMode === "2d"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-hover/12 hover:text-foreground"
              }`}
            >
              <List aria-hidden="true" size={11} />
              2D
            </button>
            <button
              type="button"
              onClick={() => setViewMode("3d")}
              aria-pressed={viewMode === "3d"}
              title="3D isometric view"
              className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
                viewMode === "3d"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-hover/12 hover:text-foreground"
              }`}
            >
              <Box aria-hidden="true" size={11} />
              3D
            </button>
          </fieldset>

          {Object.keys(positions).length > 0 && (
            <button
              type="button"
              onClick={resetPositions}
              title="Reset node positions to the automatic layout"
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-hover/12 hover:text-foreground"
            >
              <RotateCcw aria-hidden="true" size={11} />
              Reset layout
            </button>
          )}

          {hasEnabled && agent.workflow.length > 0 && (
            <button
              type="button"
              onClick={() => runAgent(agent.id)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-85"
            >
              <Play aria-hidden="true" size={12} fill="currentColor" />
              Run workflow
            </button>
          )}
        </div>
      </div>

      {addingKind !== null && (
        <div className="mb-3 grid gap-1.5 rounded-xl border bg-card/70 p-2 sm:grid-cols-2">
          <div className="col-span-full flex items-center gap-1">
            {NODE_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setAddingKind(kind)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  addingKind === kind
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-hover/12"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {addTool.map((tool) => {
            const Icon = iconFor(tool.icon);
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => addNode(tool.id)}
                disabled={
                  tool.category === "trigger" && agent.workflow.some((n) => n.kind === "trigger")
                }
                className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left transition-colors hover:bg-hover/12 disabled:opacity-40"
                title={tool.description}
              >
                <Icon aria-hidden="true" size={13} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[11px]">{tool.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {viewMode === "3d" ? (
        <WorkflowCanvas3D
          agent={agent}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          updateNode={updateNode}
          removeNode={removeNode}
          onOpenAdd={() => setAddingKind("fetch")}
          positions={positions}
          onPositionsChange={savePositions}
          onLinkNodes={linkNodes}
          onUnlinkEdge={unlinkEdge}
        />
      ) : (
        <WorkflowCanvas2D
          agent={agent}
          selectedNodeId={selectedNodeId}
          updateNode={updateNode}
          removeNode={removeNode}
          moveNode={moveNode}
          onOpenAdd={() => setAddingKind("fetch")}
        />
      )}
    </div>
  );
}
