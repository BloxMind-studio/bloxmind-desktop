import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { createRun, generateScript, runWorkflow } from "@/lib/agentStudio/engine";
import {
  createBlankAgent,
  generateAgentFromPrompt,
  makeAgentId,
  makeRunId,
} from "@/lib/agentStudio/generator";
import { loadAgents, loadRuns, saveAgents, saveRuns } from "@/lib/agentStudio/storage";
import type { AgentDefinition, AgentRun, RunLog, RunStatus } from "@/lib/agentStudio/types";

interface AgentStudioContextValue {
  agents: AgentDefinition[];
  runs: AgentRun[];
  activeAgentId: string | null;
  setActiveAgentId: (id: string | null) => void;
  createAgentFromPrompt: (prompt: string) => string;
  createBlankAgentDraft: () => string;
  updateAgent: (agent: AgentDefinition) => void;
  deleteAgent: (id: string) => void;
  runAgent: (id: string) => void;
  stopRun: (runId: string) => void;
  clearRuns: () => void;
}

const AgentStudioContext = createContext<AgentStudioContextValue | null>(null);

export function useAgentStudio() {
  const context = useContext(AgentStudioContext);
  if (!context) throw new Error("useAgentStudio must be used within an AgentStudioProvider");
  return context;
}

export function AgentStudioProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentDefinition[]>(() => loadAgents());
  const [runs, setRuns] = useState<AgentRun[]>(() => loadRuns());
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  useEffect(() => {
    saveAgents(agents);
  }, [agents]);

  useEffect(() => {
    saveRuns(runs);
  }, [runs]);

  const createAgentFromPrompt = useCallback((prompt: string): string => {
    const generated = generateAgentFromPrompt(prompt);
    const agent: AgentDefinition = {
      id: makeAgentId(),
      name: generated.name,
      role: generated.role,
      systemInstructions: generated.systemInstructions,
      trigger: generated.trigger,
      workflow: generated.workflow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setAgents((prev) => [agent, ...prev]);
    setActiveAgentId(agent.id);
    return agent.id;
  }, []);

  const createBlankAgentDraft = useCallback((): string => {
    const blank = createBlankAgent();
    const agent: AgentDefinition = {
      id: makeAgentId(),
      name: blank.name,
      role: blank.role,
      systemInstructions: blank.systemInstructions,
      trigger: blank.trigger,
      workflow: blank.workflow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setAgents((prev) => [agent, ...prev]);
    setActiveAgentId(agent.id);
    return agent.id;
  }, []);

  const updateAgent = useCallback((agent: AgentDefinition) => {
    setAgents((prev) =>
      prev.map((existing) =>
        existing.id === agent.id ? { ...agent, updatedAt: Date.now() } : existing,
      ),
    );
  }, []);

  const deleteAgent = useCallback((id: string) => {
    setAgents((prev) => prev.filter((agent) => agent.id !== id));
    setActiveAgentId((current) => {
      if (current !== id) return current;
      const remaining = agentsRef.current.filter((agent) => agent.id !== id);
      return remaining.length > 0 ? remaining[0].id : null;
    });
  }, []);

  const runAgent = useCallback(
    (id: string) => {
      const agent = agents.find((candidate) => candidate.id === id);
      if (!agent) return;

      const script = generateScript(agent);
      const run = createRun(agent, script);
      setRuns((prev) => [run, ...prev]);

      let completed = false;
      const finalize = (status: RunStatus) => {
        if (completed) return;
        completed = true;
        setRuns((prev) =>
          prev.map((candidate) =>
            candidate.id === run.id ? { ...candidate, status, finishedAt: Date.now() } : candidate,
          ),
        );
      };

      void runWorkflow(agent, {
        onLog: (log: RunLog) => {
          setRuns((prev) =>
            prev.map((candidate) =>
              candidate.id === run.id
                ? { ...candidate, logs: [...candidate.logs, log] }
                : candidate,
            ),
          );
        },
        onStatus: (status: RunStatus, nodeStates: Record<string, RunStatus>) => {
          setRuns((prev) =>
            prev.map((candidate) =>
              candidate.id === run.id ? { ...candidate, status, nodeStates } : candidate,
            ),
          );
        },
        onFinish: finalize,
      }).catch((err: unknown) => {
        console.error("Workflow run failed:", err);
        finalize("failed");
      });

      toast.success(`Started "${agent.name}"`, {
        description: `Trigger: ${agent.trigger}`,
      });
    },
    [agents],
  );

  const stopRun = useCallback((runId: string) => {
    setRuns((prev) =>
      prev.map((run) =>
        run.id === runId && run.status === "running"
          ? {
              ...run,
              status: "stopped",
              finishedAt: Date.now(),
              logs: [
                ...run.logs,
                {
                  id: makeRunId(),
                  time: Date.now(),
                  level: "warn" as const,
                  message: "Run stopped by user",
                },
              ],
            }
          : run,
      ),
    );
  }, []);

  const clearRuns = useCallback(() => {
    setRuns([]);
  }, []);

  const value = useMemo<AgentStudioContextValue>(
    () => ({
      agents,
      runs,
      activeAgentId,
      setActiveAgentId,
      createAgentFromPrompt,
      createBlankAgentDraft,
      updateAgent,
      deleteAgent,
      runAgent,
      stopRun,
      clearRuns,
    }),
    [
      agents,
      runs,
      activeAgentId,
      createAgentFromPrompt,
      createBlankAgentDraft,
      updateAgent,
      deleteAgent,
      runAgent,
      stopRun,
      clearRuns,
    ],
  );

  return <AgentStudioContext.Provider value={value}>{children}</AgentStudioContext.Provider>;
}
