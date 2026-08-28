import type { Part } from "@opencode-ai/sdk/v2/client";

/**
 * Small, dependency-free helper that turns the model's most recent activity
 * into a short "still working" line. Kept pure so it is easy to unit-test.
 *
 * The strongest liveness signal during long Roblox builds is the model's
 * reasoning text (it streams continuously while the agent plans a map or
 * animates), so we prefer its tail over a bare tool name.
 */

const TOOL_LABELS: Record<string, string> = {
  bash: "running a command",
  read: "reading a file",
  write: "writing a file",
  edit: "editing a file",
  glob: "searching the project",
  grep: "searching the project",
  task: "breaking down the work",
  todo_write: "updating the task list",
  "todo-write": "updating the task list",
  web_fetch: "fetching a URL",
  "web-fetch": "fetching a URL",
  generate_mesh: "generating a mesh (this can take a few minutes)",
};

function toolLabel(tool: string): string {
  const base = tool.replace(/^mcp_[^_]+_/, "");
  return TOOL_LABELS[base] ?? `using ${base}`;
}

function reasoningTail(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? text.trim();
  return last ? (last.length > 90 ? `${last.slice(0, 87)}…` : last) : "";
}

/**
 * Derives the latest short activity line from the current assistant message's
 * parts. Scans newest-to-oldest: a fresh reasoning part wins (its tail is the
 * most live proof of work), otherwise the newest tool call's name. Returns a
 * plain sentence plus an `epoch` used by the UI to animate on change.
 */
export function latestActivity(parts: readonly Part[] | undefined): {
  line: string | null;
  epoch: number;
} {
  if (!parts || parts.length === 0) return { line: null, epoch: 0 };
  const newest = [...parts].reverse();

  const reasoning = newest.find(
    (p): p is Extract<Part, { type: "reasoning" }> => p.type === "reasoning",
  );
  if (reasoning) {
    const tail = reasoningTail(reasoning.text);
    if (tail) {
      const epoch =
        typeof (reasoning as unknown as { time?: { updated?: number; created?: number } }).time?.updated ===
        "number"
          ? (reasoning as unknown as { time: { updated: number } }).time.updated
          : Date.now();
      return { line: tail, epoch };
    }
  }

  const tool = newest.find((p): p is Extract<Part, { type: "tool" }> => p.type === "tool");
  if (tool) {
    const epoch =
      typeof (tool as unknown as { time?: { updated?: number; created?: number } }).time?.updated ===
      "number"
        ? (tool as unknown as { time: { updated: number } }).time.updated
        : Date.now();
    return { line: toolLabel(tool.tool), epoch };
  }

  return { line: null, epoch: 0 };
}
