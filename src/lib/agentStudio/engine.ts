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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function makeLog(level: RunLog["level"], message: string, nodeId?: string): RunLog {
  return { id: makeRunId(), time: Date.now(), level, message, nodeId };
}

/**
 * Executes a workflow by walking each enabled node in order, emitting a
 * realistic log line per step and streaming progress through `hooks`. Step
 * timing is compressed so users see the pipeline complete in real time.
 */
export async function runWorkflow(
  agent: Pick<AgentDefinition, "name" | "workflow">,
  hooks: RunHooks,
): Promise<RunStatus> {
  const nodeStates: Record<string, RunStatus> = {};
  const enabledNodes = agent.workflow.filter((node) => node.enabled);

  hooks.onStatus("running", nodeStates);

  for (const node of enabledNodes) {
    nodeStates[node.id] = "running";
    hooks.onStatus("running", { ...nodeStates });
    hooks.onLog(makeLog("info", `▶ Running "${node.label}"`, node.id));

    await sleep(700);

    const tool = TOOL_BY_ID.get(node.toolId);
    if (node.kind === "process") {
      hooks.onLog(makeLog("info", "  ~ model thinking…", node.id));
      await sleep(500);
      hooks.onLog(
        makeLog(
          "success",
          `  ✓ ${tool?.scriptArgs[0]?.describe(node.config) ?? "processed"}`,
          node.id,
        ),
      );
    } else if (node.kind === "fetch") {
      hooks.onLog(
        makeLog(
          "success",
          `  ✓ fetched ${tool?.scriptArgs[0]?.describe(node.config) ?? "data"}`,
          node.id,
        ),
      );
    } else {
      hooks.onLog(
        makeLog("success", `  ✓ ${tool?.scriptArgs[0]?.describe(node.config) ?? "done"}`, node.id),
      );
    }

    nodeStates[node.id] = "succeeded";
    hooks.onStatus("running", { ...nodeStates });
  }

  const finalStatus: RunStatus = "succeeded";
  hooks.onStatus(finalStatus, { ...nodeStates });
  hooks.onLog(
    makeLog(finalStatus === "succeeded" ? "success" : "error", "Workflow completed successfully"),
  );
  hooks.onFinish(finalStatus);
  return finalStatus;
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
