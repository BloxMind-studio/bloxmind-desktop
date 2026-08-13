import type { AgentDefinition, AgentRun } from "./types";

const AGENTS_KEY = "BloxMind-agent-studio-agents";
const RUNS_KEY = "BloxMind-agent-studio-runs";

export function loadAgents(): AgentDefinition[] {
  try {
    const raw = window.localStorage.getItem(AGENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (agent): agent is AgentDefinition =>
        agent &&
        typeof agent.id === "string" &&
        typeof agent.name === "string" &&
        Array.isArray(agent.workflow),
    );
  } catch {
    return [];
  }
}

export function saveAgents(agents: readonly AgentDefinition[]): void {
  try {
    window.localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
  } catch {
    // localStorage can throw in restricted contexts; the in-memory state lives
    // on regardless.
  }
}

export function loadRuns(): AgentRun[] {
  try {
    const raw = window.localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: readonly AgentRun[]): void {
  try {
    window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch {
    // best-effort persistence
  }
}
