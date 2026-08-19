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
import type { AiRunRequest } from "@/lib/agentStudio/execution";
import {
  createBlankAgent,
  generateAgentFromPrompt,
  makeAgentId,
  makeRunId,
} from "@/lib/agentStudio/generator";
import { loadAgents, loadRuns, saveAgents, saveRuns } from "@/lib/agentStudio/storage";
import type { AgentDefinition, AgentRun, RunLog, RunStatus } from "@/lib/agentStudio/types";
import { splitModelKey } from "@/lib/splitModelKey";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";

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

  const { client } = useOpenCodeClient();
  const { selectedModel, selectedVariant } = useModelPreferences();
  /** AbortController per in-flight run so Stop actually cancels execution. */
  const runControllersRef = useRef<Map<string, AbortController>>(new Map());

  /**
   * Executes an AI process step (summarize/classify) against the engine in a
   * throwaway private session. All tools/permissions are denied so the step can
   * only return text. Fails honestly when no engine is connected.
   */
  const runAi = useCallback(
    async ({ prompt, system, signal }: AiRunRequest): Promise<string> => {
      if (!client) throw new Error("The AI engine isn't ready yet.");
      let model: { providerID: string; modelID: string } | undefined;
      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) model = { providerID, modelID };
      }

      const created = await client.session.create(
        {
          title: "Agent workflow step",
          metadata: { BloxMindHidden: true, purpose: "agent-studio-ai-step" },
          permission: [{ permission: "*", pattern: "*", action: "deny" }],
        },
        { throwOnError: true, signal },
      );
      const sessionID = created.data?.id;
      if (!sessionID) throw new Error("Couldn't start the AI step.");
      try {
        const res = await client.session.prompt(
          {
            sessionID,
            model,
            variant: selectedVariant ?? undefined,
            system:
              system ?? "You are a concise automation assistant. Answer directly with no preamble.",
            parts: [{ type: "text", text: prompt }],
          },
          { throwOnError: true, signal },
        );
        const parts = (res.data?.parts ?? []) as ReadonlyArray<{ type: string; text?: string }>;
        const text = parts
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text as string)
          .join("\n")
          .trim();
        if (!text) throw new Error("The model returned an empty response.");
        return text;
      } finally {
        await client.session.delete({ sessionID }).catch(() => undefined);
      }
    },
    [client, selectedModel, selectedVariant],
  );

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

      const controller = new AbortController();
      runControllersRef.current.set(run.id, controller);

      let completed = false;
      const finalize = (status: RunStatus) => {
        if (completed) return;
        completed = true;
        runControllersRef.current.delete(run.id);
        setRuns((prev) =>
          prev.map((candidate) =>
            candidate.id === run.id ? { ...candidate, status, finishedAt: Date.now() } : candidate,
          ),
        );
      };

      void runWorkflow(
        agent,
        {
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
        },
        { signal: controller.signal, ai: runAi },
      ).catch((err: unknown) => {
        console.error("Workflow run failed:", err);
        finalize("failed");
      });

      toast.success(`Started "${agent.name}"`, {
        description: `Trigger: ${agent.trigger}`,
      });
    },
    [agents, runAi],
  );

  const stopRun = useCallback((runId: string) => {
    // Cancel any in-flight execution; runWorkflow stops at the next step and
    // reports "stopped" (it will no longer flip the run back to "succeeded").
    runControllersRef.current.get(runId)?.abort();
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
