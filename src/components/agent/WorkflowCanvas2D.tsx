import { ArrowDown } from "lucide-react";
import { iconFor } from "@/lib/agentStudio/icons";
import { TOOL_BY_ID } from "@/lib/agentStudio/tools";
import type { AgentDefinition, WorkflowNode } from "@/lib/agentStudio/types";
import { NodeEditor } from "./NodeEditor";

export interface WorkflowCanvas2DProps {
  agent: AgentDefinition;
  selectedNodeId: string | null;
  updateNode: (node: WorkflowNode) => void;
  removeNode: (nodeId: string) => void;
  moveNode: (index: number, direction: -1 | 1) => void;
  onOpenAdd: () => void;
}

function flowLabel(node: WorkflowNode): string {
  if (node.kind === "trigger") return "When";
  if (node.kind === "fetch") return "Fetch";
  if (node.kind === "process") return "Process";
  return "Then";
}

/**
 * Flat 2D vertical pipeline view. Each step is an inline editable card with
 * move-up/move-down controls; the card matching the active 3D selection is
 * outlined distinctively so selection stays in sync with the 3D view.
 */
export function WorkflowCanvas2D({
  agent,
  selectedNodeId,
  updateNode,
  removeNode,
  moveNode,
  onOpenAdd,
}: WorkflowCanvas2DProps) {
  if (agent.workflow.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card/50 py-8 text-center text-xs text-muted-foreground">
        This agent has no steps yet.{" "}
        <button
          type="button"
          onClick={onOpenAdd}
          className="text-accent underline underline-offset-2"
        >
          Add your first step
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {agent.workflow.map((node, index) => {
        const Icon = iconFor(TOOL_BY_ID.get(node.toolId)?.icon);
        const selected = node.id === selectedNodeId;
        return (
          <div key={node.id}>
            {index > 0 && (
              <div className="my-0.5 flex h-6 items-center justify-center gap-1.5 text-muted-foreground/50">
                <span className="h-px w-8 bg-border" />
                <span className="text-[10px]">{flowLabel(node)}</span>
                <span className="h-px w-8 bg-border" />
              </div>
            )}
            <div className="group relative">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => moveNode(index, -1)}
                  title="Move up"
                  className="absolute -left-9 top-1/2 hidden -translate-y-1/2 rounded-md border bg-background p-1 text-muted-foreground transition-colors hover:bg-hover/12 group-hover:block"
                >
                  <ArrowDown aria-hidden="true" size={12} className="rotate-180" />
                </button>
              )}
              {index < agent.workflow.length - 1 && (
                <button
                  type="button"
                  onClick={() => moveNode(index, 1)}
                  title="Move down"
                  className="absolute -left-9 top-1/2 hidden -translate-y-1/2 rounded-md border bg-background p-1 text-muted-foreground transition-colors hover:bg-hover/12 group-hover:block"
                >
                  <ArrowDown aria-hidden="true" size={12} />
                </button>
              )}
              <div className="flex items-start gap-2.5">
                <div className="mt-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-accent">
                  <Icon aria-hidden="true" size={13} />
                </div>
                <div
                  className={`min-w-0 flex-1 rounded-xl transition-shadow ${
                    selected ? "ring-2 ring-destructive/70" : "ring-1 ring-transparent"
                  }`}
                >
                  <NodeEditor
                    node={node}
                    onUpdate={updateNode}
                    onDelete={() => removeNode(node.id)}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
