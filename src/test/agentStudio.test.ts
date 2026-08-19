import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRun,
  generateScript,
  levelForStatus,
  type RunHooks,
  runWorkflow,
} from "@/lib/agentStudio/engine";
import { createBlankAgent, generateAgentFromPrompt } from "@/lib/agentStudio/generator";

function collectHooks() {
  const logs: Array<{ level: string; message: string }> = [];
  const statuses: string[] = [];
  let finished: string | null = null;
  const hooks: RunHooks = {
    onLog: (log) => logs.push({ level: log.level, message: log.message }),
    onStatus: (status) => statuses.push(status),
    onFinish: (status) => {
      finished = status;
    },
  };
  return { hooks, logs, statuses, getFinished: () => finished };
}

describe("generateAgentFromPrompt", () => {
  it("builds a trigger-fetch-process-action pipeline from plain English", () => {
    const agent = generateAgentFromPrompt(
      "Create an agent that reads player feedback every hour, filters for negative feedback, and posts a warning to Discord",
    );

    expect(agent.workflow[0].kind).toBe("trigger");
    expect(agent.workflow[0].toolId).toBe("trigger.schedule");

    expect(agent.workflow.some((node) => node.toolId === "fetch.robloxData")).toBe(true);
    expect(agent.workflow.some((node) => node.toolId === "process.filter")).toBe(true);
    expect(agent.workflow.some((node) => node.toolId === "action.discordPost")).toBe(true);
    expect(agent.workflow.every((node) => node.enabled)).toBe(true);
  });

  it("falls back to sensible defaults when the prompt is ambiguous", () => {
    const agent = generateAgentFromPrompt("make something cool");

    expect(agent.workflow[0].toolId).toBe("trigger.schedule");
    expect(agent.workflow.some((node) => node.kind === "process")).toBe(true);
    expect(agent.workflow.some((node) => node.kind === "action")).toBe(true);
  });

  it("assigns the full prompt as the role and keeps a non-empty name", () => {
    const agent = generateAgentFromPrompt("An agent that summarizes feedback");
    expect(agent.name.length).toBeGreaterThan(0);
    expect(agent.role).toContain("summarize");
  });
});

describe("createBlankAgent", () => {
  it("produces a minimal runnable workflow", () => {
    const agent = createBlankAgent();
    expect(agent.name).toBe("New Agent");
    expect(agent.workflow.map((node) => node.kind)).toEqual(["trigger", "action"]);
  });
});

describe("generateScript", () => {
  it("skips disabled nodes and emits runnable Python", () => {
    const agent = createBlankAgent();
    const script = generateScript(agent);
    expect(script).toContain("def run():");
    expect(script).toContain('schedule("every hour")');
    expect(script).toContain("log(payload)");
  });
});

describe("runWorkflow", () => {
  it("executes every enabled node in order and finishes succeeded", async () => {
    const agent = createBlankAgent();
    const { hooks, logs, getFinished } = collectHooks();

    const status = await runWorkflow(agent, hooks);

    expect(status).toBe("succeeded");
    expect(getFinished()).toBe("succeeded");
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs[0].message).toContain("▶ Running");
    expect(levelForStatus("succeeded")).toBe("success");
  });

  it("keeps disabled nodes out of the run", async () => {
    const agent = createBlankAgent();
    agent.workflow[1].enabled = false;
    const { hooks } = collectHooks();

    await runWorkflow(agent, hooks);
  });
});

describe("createRun", () => {
  it("seeds the run as queued with the script attached", () => {
    const run = createRun(
      { id: "agent-1", name: "Feedback Bot", trigger: "Every hour" },
      "def run():\n    pass",
    );

    expect(run.status).toBe("queued");
    expect(run.agentName).toBe("Feedback Bot");
    expect(run.script).toContain("def run():");
    expect(run.logs[0].level).toBe("info");
    expect(run.nodeStates).toEqual({});
  });
});

describe("runWorkflow real execution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const node = (
    id: string,
    kind: "trigger" | "fetch" | "process" | "action",
    toolId: string,
    config: Record<string, string> = {},
  ) => ({ id, kind, toolId, label: toolId, config, enabled: true });

  it("performs a real HTTP fetch and threads the payload", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const agent = createBlankAgent();
    agent.workflow = [
      node("t", "trigger", "trigger.schedule", { schedule: "every hour" }),
      node("f", "fetch", "fetch.httpRequest", { url: "https://example.com/api", method: "GET" }),
      node("a", "action", "action.log"),
    ];

    const { hooks, logs } = collectHooks();
    const status = await runWorkflow(agent, hooks);

    expect(status).toBe("succeeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.some((log) => log.message.includes("HTTP 200"))).toBe(true);
  });

  it("fails honestly when an AI process step has no engine", async () => {
    const agent = createBlankAgent();
    agent.workflow = [
      node("t", "trigger", "trigger.schedule"),
      node("p", "process", "process.aiSummarize"),
    ];

    const { hooks, getFinished } = collectHooks();
    const status = await runWorkflow(agent, hooks);

    expect(status).toBe("failed");
    expect(getFinished()).toBe("failed");
  });

  it("a filter that drops the payload short-circuits the remaining steps", async () => {
    const agent = createBlankAgent();
    agent.workflow = [
      node("f", "process", "process.filter", { field: "sentiment", equals: "negative" }),
      node("a", "action", "action.log"),
    ];

    const { hooks, logs, getFinished } = collectHooks();
    const status = await runWorkflow(agent, hooks, { target: { sentiment: "positive" } });

    expect(status).toBe("succeeded");
    expect(logs.some((log) => log.message.includes("Filtered out"))).toBe(true);
    expect(logs.some((log) => log.message.includes("remaining steps skipped"))).toBe(true);
    expect(getFinished()).toBe("succeeded");
  });

  it("an aborted signal stops the run and reports stopped (not succeeded)", async () => {
    const agent = createBlankAgent();
    agent.workflow = Array.from({ length: 4 }, (_, i) => node(`n${i}`, "action", "action.log"));

    const controller = new AbortController();
    controller.abort();

    const { hooks, getFinished, statuses } = collectHooks();
    const status = await runWorkflow(agent, hooks, { signal: controller.signal });

    expect(status).toBe("stopped");
    expect(getFinished()).toBe("stopped");
    expect(statuses.includes("stopped")).toBe(true);
    // The run must never flip back to "succeeded".
    expect(statuses.includes("succeeded")).toBe(false);
  });
});
