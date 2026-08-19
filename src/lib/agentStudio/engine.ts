import { type AiRunner, executeNode, type Payload } from "./execution";
import { makeRunId } from "./generator";
import { TOOL_BY_ID } from "./tools";
import type { AgentDefinition, AgentRun, RunLog, RunStatus } from "./types";

/**
 * Generates the underlying automation script (Python/Node flavoured) that the
 * workflow nodes describe. This is the "Python & Tool Execution Layer" — the
 * node canvas is a no-code front-end over a real, runnable script.
 */
export function generateScript(agent: Pick<AgentDefinition, "name" | "workflow">): string {
  const lines: string[] = [];
  lines.push(`# ${agent.name} — generated automation workflow`);
  lines.push("# Built visually in BloxMind Agent Studio.");
  lines.push("");

  const steps: string[] = [];
  for (const node of agent.workflow) {
    if (!node.enabled) continue;
    const tool = TOOL_BY_ID.get(node.toolId);
    const arg = tool?.scriptArgs[0]?.describe(node.config);
    steps.push(`    ${arg ?? "pass"}`);
  }

  if (steps.length === 0) {
    lines.push("def run():\n    pass");
    return lines.join("\n");
  }

  lines.push("def run():");
  lines.push(...steps);
  lines.push("");
  lines.push('if __name__ == "__main__":');
  lines.push("    run()");
  return lines.join("\n");
}

const LEVEL_BY_STATUS: Record<RunStatus, RunLog["level"]> = {
  queued: "info",
  running: "info",
  succeeded: "success",
  failed: "error",
  stopped: "warn",
};

export interface RunHooks {
  onLog: (log: RunLog) => void;
  onStatus: (status: RunStatus, nodeStates: Record<string, RunStatus>) => void;
  onFinish: (status: RunStatus) => void;
}

function makeLog(level: RunLog["level"], message: string, nodeId?: string): RunLog {
  return { id: makeRunId(), time: Date.now(), level, message, nodeId };
}

export interface RunOptions {
  /** When aborted, the run stops cleanly and reports "stopped". */
  signal?: AbortSignal;
  /** Initial payload threaded through the pipeline. */
  target?: Payload;
  /** Optional AI runner so process nodes execute against the engine. */
  ai?: AiRunner | null;
}

/**
 * Executes a workflow by running each enabled node in order through the real
 * node executor, threading a payload through the pipeline and streaming
 * progress via `hooks`. Honours an AbortSignal so a run can be stopped without
 * being falsely reported as succeeded.
 */
export async function runWorkflow(
  agent: Pick<AgentDefinition, "name" | "workflow">,
  hooks: RunHooks,
  options: RunOptions = {},
): Promise<RunStatus> {
  const { signal, target, ai } = options;
  const nodeStates: Record<string, RunStatus> = {};
  const enabledNodes = agent.workflow.filter((node) => node.enabled);
  let payload: Payload = target ? { ...target } : {};

  hooks.onStatus("running", nodeStates);

  for (const node of enabledNodes) {
    if (signal?.aborted) return finishStopped(hooks, nodeStates);

    nodeStates[node.id] = "running";
    hooks.onStatus("running", { ...nodeStates });
    hooks.onLog(makeLog("info", `▶ Running "${node.label}"`, node.id));

    try {
      const result = await executeNode(node, payload, {
        signal: signal ?? new AbortController().signal,
        ai,
      });
      payload = result.payload;
      nodeStates[node.id] = "succeeded";
      hooks.onStatus("running", { ...nodeStates });
      hooks.onLog(makeLog(result.filtered ? "warn" : "success", result.message, node.id));

      // A filter that dropped the payload short-circuits the rest of the pipeline.
      if (result.filtered) {
        hooks.onLog(makeLog("info", "Filtered — remaining steps skipped", node.id));
        const finalStatus: RunStatus = "succeeded";
        hooks.onStatus(finalStatus, { ...nodeStates });
        hooks.onFinish(finalStatus);
        return finalStatus;
      }
    } catch (err) {
      nodeStates[node.id] = "failed";
      const message = err instanceof Error ? err.message : String(err);
      hooks.onLog(makeLog("error", `✗ ${node.label}: ${message}`, node.id));
      const finalStatus: RunStatus = "failed";
      hooks.onStatus(finalStatus, { ...nodeStates });
      hooks.onFinish(finalStatus);
      return finalStatus;
    }
  }

  const finalStatus: RunStatus = "succeeded";
  hooks.onStatus(finalStatus, { ...nodeStates });
  hooks.onLog(makeLog("success", "Workflow completed successfully"));
  hooks.onFinish(finalStatus);
  return finalStatus;
}

function finishStopped(hooks: RunHooks, nodeStates: Record<string, RunStatus>): RunStatus {
  const status: RunStatus = "stopped";
  hooks.onLog(makeLog("warn", "Run stopped by user"));
  hooks.onStatus(status, { ...nodeStates });
  hooks.onFinish(status);
  return status;
}

export function createRun(
  agent: Pick<AgentDefinition, "id" | "name" | "trigger">,
  script: string,
): AgentRun {
  const now = Date.now();
  return {
    id: makeRunId(),
    agentId: agent.id,
    agentName: agent.name,
    trigger: agent.trigger,
    status: "queued",
    startedAt: now,
    finishedAt: null,
    logs: [
      { id: makeRunId(), time: now, level: "info", message: `Queued agent "${agent.name}"` },
      { id: makeRunId(), time: now, level: "script", message: script },
    ],
    script,
    nodeStates: {},
  };
}

export function levelForStatus(status: RunStatus): RunLog["level"] {
  return LEVEL_BY_STATUS[status];
}
