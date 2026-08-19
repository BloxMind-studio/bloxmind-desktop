import { Plus, RefreshCw, Settings, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentDefinition } from "@/lib/agentStudio/types";
import { useAgentStudio } from "@/providers/AgentStudioProvider";
import { useAgentPreferences } from "@/providers/PreferencesProvider";
import { ActiveAgentsDashboard } from "./ActiveAgentsDashboard";
import { AgentCreationSuite } from "./AgentCreationSuite";
import { AgentStudioSidebar } from "./AgentStudioSidebar";
import { WorkflowCanvas } from "./WorkflowCanvas";

type StudioView = "create" | "agents";

/**
 * Agent Mode workspace. Left rail holds templates + tools, the center hosts
 * the agent creation suite / workflow canvas, and the right panel shows the
 * active-agents dashboard with live logs.
 */
export function AgentWorkbench({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const agentPrefs = useAgentPreferences();
  const {
    agents,
    activeAgentId,
    setActiveAgentId,
    createAgentFromPrompt,
    createBlankAgentDraft,
    deleteAgent,
    runAgent,
  } = useAgentStudio();
  const [view, setView] = useState<StudioView>("create");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [search, setSearch] = useState("");

  const activeAgent = agents.find((agent) => agent.id === activeAgentId) ?? null;

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agents;
    const needle = search.toLowerCase();
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(needle) || agent.role.toLowerCase().includes(needle),
    );
  }, [agents, search]);

  function handleGenerate() {
    const prompt = draftPrompt.trim();
    if (!prompt) return;
    const newId = createAgentFromPrompt(prompt);
    setDraftPrompt("");
    setView("create");
    if (agentPrefs.autoRunOnCreate) {
      // Run after a tick so the agent is fully registered in state
      setTimeout(() => runAgent(newId), 0);
    }
  }

  function handleSelectAgent(agent: AgentDefinition) {
    setActiveAgentId(agent.id);
    setView("create");
  }

  function handleDeleteAgent(id: string) {
    deleteAgent(id);
  }

  return (
    <div className="flex min-h-0 flex-1">
      {agentPrefs.showAgentSidebar && (
        <AgentStudioSidebar
          agents={filteredAgents}
          activeAgentId={activeAgentId}
          search={search}
          onSearchChange={setSearch}
          onSelectAgent={handleSelectAgent}
          onDeleteAgent={handleDeleteAgent}
          onCreateAgent={() => setView("create")}
          onTemplate={(template) => {
            const newId = template.prompt
              ? createAgentFromPrompt(template.prompt)
              : createBlankAgentDraft();
            setView("create");
            if (agentPrefs.autoRunOnCreate) {
              setTimeout(() => runAgent(newId), 0);
            }
          }}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="grid h-10 shrink-0 grid-cols-[minmax(6rem,2fr)_minmax(0,3fr)] items-center border-b px-3">
          <h3 className="truncate text-xs font-semibold">
            {activeAgent ? activeAgent.name : view === "create" ? "Agent Creation Suite" : "Agents"}
          </h3>
          <div className="flex items-center justify-end gap-2">
            {view === "create" && (
              <button
                type="button"
                onClick={() => setView("agents")}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-hover/12"
              >
                <Zap aria-hidden="true" size={13} />
                Active agents
              </button>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                title="Agent mode settings"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover/12 hover:text-foreground"
              >
                <Settings aria-hidden="true" size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                createBlankAgentDraft();
                setView("create");
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-85"
            >
              <Plus aria-hidden="true" size={13} />
              New agent
            </button>
          </div>
        </div>

        {view === "create" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <AgentCreationSuite
              draftPrompt={draftPrompt}
              onDraftPromptChange={setDraftPrompt}
              onGenerate={handleGenerate}
              onBlank={() => {
                createBlankAgentDraft();
              }}
            />
            {activeAgent && (
              <WorkflowCanvas key={activeAgent.id} agent={activeAgent} className="mt-4" />
            )}
          </div>
        ) : (
          <ActiveAgentsDashboard
            emptyIcon={<RefreshCw aria-hidden="true" size={14} />}
            onCreateAgent={() => setView("create")}
          />
        )}
      </div>
    </div>
  );
}
