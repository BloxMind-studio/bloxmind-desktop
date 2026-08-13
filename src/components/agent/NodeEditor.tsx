import { GripVertical, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { TOOL_BY_ID } from "@/lib/agentStudio/tools";
import type { NodeKind, WorkflowNode } from "@/lib/agentStudio/types";

export const NODE_KINDS: ReadonlyArray<{ kind: NodeKind; label: string }> = [
  { kind: "trigger", label: "Trigger" },
  { kind: "fetch", label: "Fetch data" },
  { kind: "process", label: "AI process" },
  { kind: "action", label: "Action" },
];

export function NodeEditor({
  node,
  onUpdate,
  onDelete,
}: {
  node: WorkflowNode;
  onUpdate: (node: WorkflowNode) => void;
  onDelete: () => void;
}) {
  const tool = TOOL_BY_ID.get(node.toolId);

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex w-6 shrink-0 items-center justify-center">
          <GripVertical aria-hidden="true" size={14} className="text-border" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {tool && (
              <>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {NODE_KINDS.find((entry) => entry.kind === node.kind)?.label}
                </span>
                <span className="text-[10px] text-muted-foreground/50">·</span>
              </>
            )}
            <span className="text-xs font-semibold">{tool?.name ?? node.label}</span>
          </div>
          {tool && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{tool.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ ...node, enabled: !node.enabled })}
            className="text-muted-foreground transition-colors hover:text-foreground"
            title={node.enabled ? "Disable step" : "Enable step"}
          >
            {node.enabled ? (
              <ToggleRight aria-hidden="true" size={16} className="text-accent" />
            ) : (
              <ToggleLeft aria-hidden="true" size={16} />
            )}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-muted-foreground transition-colors hover:text-destructive"
            title="Remove step"
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </div>
      </div>

      {tool && tool.fields.length > 0 && (
        <div className="mt-3 grid gap-2 pl-8">
          {tool.fields.map((field) => {
            const value = node.config[field.key] ?? "";
            const updateValue = (next: string) =>
              onUpdate({ ...node, config: { ...node.config, [field.key]: next } });

            if (field.type === "select" && field.options) {
              return (
                <label key={field.key} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[11px] text-muted-foreground">
                    {field.label}
                  </span>
                  <select
                    value={value}
                    onChange={(event) => updateValue(event.target.value)}
                    className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[11px] focus:outline-none"
                  >
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            return (
              <label
                key={field.key}
                htmlFor={`${node.id}-${field.key}`}
                className="flex items-center gap-2"
              >
                <span className="w-24 shrink-0 text-[11px] text-muted-foreground">
                  {field.label}
                </span>
                {field.type === "textarea" ? (
                  <textarea
                    id={`${node.id}-${field.key}`}
                    value={value}
                    onChange={(event) => updateValue(event.target.value)}
                    placeholder={field.placeholder}
                    rows={2}
                    className="min-w-0 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none"
                  />
                ) : (
                  <input
                    id={`${node.id}-${field.key}`}
                    value={value}
                    onChange={(event) => updateValue(event.target.value)}
                    placeholder={field.placeholder}
                    type={field.type === "number" ? "number" : "text"}
                    className="h-7 flex-1 rounded-md border bg-background px-2 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none"
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
