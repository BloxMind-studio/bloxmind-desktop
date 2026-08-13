import { TOOLS } from "./tools";
import type { AgentDefinition, NodeKind, WorkflowNode } from "./types";

export function makeNodeId(): string {
  return `node-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeAgentId(): string {
  return `agent-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeRunId(): string {
  return `run-${Math.random().toString(36).slice(2, 10)}`;
}

interface GeneratedAgent {
  name: string;
  role: string;
  systemInstructions: string;
  trigger: string;
  workflow: WorkflowNode[];
}

const TRIGGER_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [
    /every (minute|hour|day|week)|hourly|daily|weekly|on a schedule|every \d+ (minute|hour|day)/i,
    "trigger.schedule",
  ],
  [/webhook|when a message|when someone posts/i, "trigger.webhook"],
  [/player|studio|joined|left|feedback|in-game|roblox event/i, "trigger.robloxEvent"],
];

const FETCH_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/datastore|ordered data/i, "fetch.robloxData"],
  [/feedback|player feedback|in-game/i, "fetch.robloxData"],
  [/api|json|endpoint|http|rest|http request/i, "fetch.httpRequest"],
  [/search|find the latest|ranked results/i, "fetch.webSearch"],
];

const PROCESS_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/summar|key points|summary/i, "process.aiSummarize"],
  [/classif|triage|category|categorize|bug, feature|praise/i, "process.aiClassify"],
  [/filter|negative|positive|only when/i, "process.filter"],
  [/ai|llm|model|understand|analy|extract/i, "process.aiSummarize"],
];

const ACTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/discord|post the (summary|result)/i, "action.discordPost"],
  [/delay|wait|pause/i, "action.delay"],
  [/notify|alert|log|save/i, "action.log"],
];

function pickTrigger(prompt: string): string {
  for (const [pattern, toolId] of TRIGGER_PATTERNS) {
    if (pattern.test(prompt)) return toolId;
  }
  return "trigger.schedule";
}

function pickTool(prompt: string, patterns: ReadonlyArray<[RegExp, string]>): string | null {
  for (const [pattern, toolId] of patterns) {
    if (pattern.test(prompt)) return toolId;
  }
  return null;
}

/**
 * Convert a plain-English agent description into a concrete agent definition
 * with a structured workflow (trigger → fetch → process → action). The prompt
 * is matched against heuristic patterns so non-coders get a working agent in
 * one click; every node can still be edited in the visual builder afterwards.
 */
export function generateAgentFromPrompt(prompt: string): GeneratedAgent {
  const name =
    /an? agent that (?:is|works? as|summar|classif|watch)/i
      .exec(prompt)?.[0]
      .replace(/^an? agent that/i, "")
      .trim() ??
    prompt
      .replace(/^create an? /i, "")
      .replace(/[.?!]$/u, "")
      .trim()
      .slice(0, 48);

  const nodes: WorkflowNode[] = [];

  const pushNode = (
    kind: NodeKind,
    toolId: string | null,
    label: string,
    config: Record<string, string>,
  ) => {
    if (!toolId) return;
    nodes.push({
      id: makeNodeId(),
      kind,
      toolId,
      label,
      config,
      enabled: true,
    });
  };

  const triggerToolId = pickTrigger(prompt);
  const triggerTool = TOOLS.find((tool) => tool.id === triggerToolId);
  pushNode("trigger", triggerToolId, triggerTool?.name ?? "Trigger", {
    ...triggerTool?.defaultConfig,
  });

  const fetchToolId = pickTool(prompt, FETCH_PATTERNS);
  const fetchTool = TOOLS.find((tool) => tool.id === fetchToolId);
  pushNode("fetch", fetchToolId, fetchTool?.name ?? "Fetch Data", { ...fetchTool?.defaultConfig });

  const processToolId = pickTool(prompt, PROCESS_PATTERNS) ?? "process.aiSummarize";
  const processTool = TOOLS.find((tool) => tool.id === processToolId);
  pushNode("process", processToolId, processTool?.name ?? "AI Process", {
    ...processTool?.defaultConfig,
  });

  const actionToolId = pickTool(prompt, ACTION_PATTERNS) ?? "action.log";
  const actionTool = TOOLS.find((tool) => tool.id === actionToolId);
  pushNode("action", actionToolId, actionTool?.name ?? "Execute Action", {
    ...actionTool?.defaultConfig,
  });

  if (nodes.length === 0) {
    pushNode("trigger", "trigger.schedule", "Schedule / Cron", { schedule: "every hour" });
    pushNode("action", "action.log", "Log Output", {});
  }

  const triggerNode = nodes.find((node) => node.kind === "trigger");
  const triggerDescription =
    triggerNode?.toolId === "trigger.schedule"
      ? `Every hour (${triggerNode.config.schedule ?? "every hour"})`
      : triggerNode?.toolId === "trigger.webhook"
        ? "Webhook"
        : "Roblox event";

  return {
    name: name || "My Agent",
    role: prompt.length > 0 ? prompt : "Automation agent",
    systemInstructions:
      "You are a workflow automation agent. Use the steps in the workflow to fetch, process, and act on data. Keep output concise and factual.",
    trigger: triggerDescription,
    workflow: nodes,
  };
}

/**
 * Build the default "blank agent" definition used when a user starts from the
 * empty template.
 */
export function createBlankAgent(): Pick<
  AgentDefinition,
  "name" | "role" | "systemInstructions" | "trigger" | "workflow"
> {
  const generated = generateAgentFromPrompt("");
  return {
    name: "New Agent",
    role: "",
    systemInstructions: "You are a workflow automation agent.",
    trigger: generated.trigger,
    workflow: [
      {
        id: makeNodeId(),
        kind: "trigger",
        toolId: "trigger.schedule",
        label: "Schedule / Cron",
        config: { schedule: "every hour" },
        enabled: true,
      },
      {
        id: makeNodeId(),
        kind: "action",
        toolId: "action.log",
        label: "Log Output",
        config: {},
        enabled: true,
      },
    ],
  };
}
