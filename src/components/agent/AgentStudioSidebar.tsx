import { ChevronDown, ChevronRight, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { iconFor } from "@/lib/agentStudio/icons";
import { AGENT_TEMPLATES } from "@/lib/agentStudio/templates";
import { TOOLS_BY_CATEGORY } from "@/lib/agentStudio/tools";
import type { AgentDefinition, AgentTemplate, ToolDefinition } from "@/lib/agentStudio/types";

interface AgentStudioSidebarProps {
  agents: readonly AgentDefinition[];
  activeAgentId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectAgent: (agent: AgentDefinition) => void;
  onDeleteAgent: (id: string) => void;
  onCreateAgent: () => void;
  onTemplate: (template: AgentTemplate) => void;
}

const CATEGORY_LABELS: Record<ToolDefinition["category"], string> = {
  trigger: "Triggers",
  fetch: "Fetch data",
  process: "Process with AI",
  action: "Actions",
};

export function AgentStudioSidebar({
  agents,
  activeAgentId,
  search,
  onSearchChange,
  onSelectAgent,
  onDeleteAgent,
  onCreateAgent,
  onTemplate,
}: AgentStudioSidebarProps) {
  const [toolsOpen, setToolsOpen] = useState(true);

  return (
    <div className="flex w-56 shrink-0 flex-col border-r bg-card">
      <div className="flex h-9 items-center justify-between border-b px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Studio
        </span>
        <button
          type="button"
          onClick={onCreateAgent}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-hover/12"
          title="New agent"
        >
          <Plus aria-hidden="true" size={13} />
        </button>
      </div>

      <div className="px-3 py-2">
        <label className="relative block">
          <Search
            aria-hidden="true"
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search agents"
            className="h-7 w-full rounded-md border bg-background pl-7 pr-2 text-[11px] placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
        <div className="space-y-1 px-2">
          {agents.map((agent) => {
            const active = agent.id === activeAgentId;
            return (
              <div
                key={agent.id}
                className={`group flex w-full items-center gap-0.5 rounded-md transition-colors ${
                  active ? "bg-selected/15" : "hover:bg-hover/12"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectAgent(agent)}
                  title={agent.name}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    active
                      ? "font-medium text-selected-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteAgent(agent.id);
                  }}
                  title={`Delete ${agent.name}`}
                  className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive focus:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Trash2 aria-hidden="true" size={12} />
                </button>
              </div>
            );
          })}
          {agents.length === 0 && (
            <p className="px-2 py-3 text-center text-[10.5px] text-muted-foreground">
              No agents yet.
              <br />
              Create one to start automating.
            </p>
          )}
        </div>

        <div className="mt-3 border-t border-border/60">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Templates
            </span>
          </div>
          <div className="space-y-1 px-2">
            {AGENT_TEMPLATES.map((template) => {
              const Icon = iconFor(template.icon);
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onTemplate(template)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover/12"
                  title={template.description}
                >
                  <Icon
                    aria-hidden="true"
                    size={12}
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-foreground">
                      {template.name}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {template.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 border-t border-border/60">
          <button
            type="button"
            onClick={() => setToolsOpen((open) => !open)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
            aria-expanded={toolsOpen}
          >
            {toolsOpen ? (
              <ChevronDown aria-hidden="true" size={11} className="text-muted-foreground" />
            ) : (
              <ChevronRight aria-hidden="true" size={11} className="text-muted-foreground" />
            )}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tools & Integrations
            </span>
          </button>
          {toolsOpen && (
            <div className="space-y-2 px-3 pb-2">
              {(Object.keys(TOOLS_BY_CATEGORY) as Array<keyof typeof TOOLS_BY_CATEGORY>).map(
                (category) => (
                  <div key={category}>
                    <p className="mb-1 text-[10px] capitalize text-muted-foreground/70">
                      {CATEGORY_LABELS[category]}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {TOOLS_BY_CATEGORY[category].map((tool) => {
                        const Icon = iconFor(tool.icon);
                        return (
                          <span
                            key={tool.id}
                            title={tool.description}
                            className="inline-flex items-center gap-1 rounded-md border bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            <Icon aria-hidden="true" size={10} />
                            {tool.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
