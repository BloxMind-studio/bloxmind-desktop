import type { Event } from "@opencode-ai/sdk/v2/client";

/** File operation surfaced from the agent's tool calls. */
export interface FileOperation {
  type: "write" | "edit" | "read" | "glob" | "grep";
  path: string;
}

/** Extract a file operation from a tool.called event, if applicable. */
export function extractFileOperation(event: Event): FileOperation | null {
  if (event.type !== "session.next.tool.called") return null;
  const props = event.properties as {
    sessionID?: string;
    tool?: string;
    input?: Record<string, unknown>;
  };
  const tool = props.tool;
  const input = props.input;
  if (!tool || !input) return null;

  let path: string | undefined;
  if (typeof input.path === "string") path = input.path;
  else if (typeof input.filePath === "string") path = input.filePath;
  else if (typeof input.filename === "string") path = input.filename;

  if (!path) return null;

  const type =
    tool === "write"
      ? "write"
      : tool === "edit"
        ? "edit"
        : tool === "read"
          ? "read"
          : tool === "glob"
            ? "glob"
            : tool === "grep"
              ? "grep"
              : "write";

  return { type, path };
}

/**
 * Live label for what the agent is doing right now, driven by the session
 * stream. Shown as a status line while a build/update runs so the user always
 * knows the current step (creating a file, installing packages, testing, …)
 * instead of just watching a spinner.
 */
export interface AgentState {
  /** Stable key for icons/aria-labels. */
  kind:
    | "thinking"
    | "writing"
    | "editing"
    | "reading"
    | "searching"
    | "installing"
    | "testing"
    | "running"
    | "fixing"
    | "finalizing";
  /** Short human-readable status, e.g. "Creating src/App.tsx". */
  label: string;
}

/** Guess what a shell command is doing so we can label it human-ly. */
function shellCommandLabel(command: string): string {
  const cmd = command.toLowerCase();
  if (/\b(npm|pnpm|yarn|bun)\b/.test(cmd) && /\b(install|add|i)\b/.test(cmd)) {
    return "Installing npm packages…";
  }
  if (/\b(test|vitest|jest|playwright|cypress)\b/.test(cmd)) {
    return "Running tests…";
  }
  if (/\b(build|tsc|vite build)\b/.test(cmd)) {
    return "Building the project…";
  }
  if (/\b(dev|lint|format|biome)\b/.test(cmd)) {
    return "Running a project command…";
  }
  return "Running a shell command…";
}

/**
 * Map a session stream event to the agent's current activity. Returns null for
 * events that don't represent visible progress. Mirrors buildPhaseFromEvent's
 * session scoping so stray events from other sessions never surface.
 */
export function extractAgentState(event: Event, sessionID: string): AgentState | null {
  const props = event.properties as { sessionID?: string };
  if (props.sessionID !== sessionID) return null;

  switch (event.type) {
    case "session.next.reasoning.started":
    case "session.next.reasoning.delta":
      return { kind: "thinking", label: "Thinking through the approach…" };
    case "session.next.tool.input.started":
      return { kind: "thinking", label: "Preparing a tool call…" };
    case "session.next.tool.called": {
      const called = event.properties as { tool?: string; input?: Record<string, unknown> };
      const tool = called.tool;
      const input = called.input;
      if (tool === "write" || tool === "edit") {
        const path =
          typeof input?.path === "string"
            ? input.path
            : typeof input?.filePath === "string"
              ? input.filePath
              : typeof input?.filename === "string"
                ? input.filename
                : undefined;
        if (path) {
          return {
            kind: tool === "write" ? "writing" : "editing",
            label: `${tool === "write" ? "Creating" : "Editing"} ${path}`,
          };
        }
        return {
          kind: tool === "write" ? "writing" : "editing",
          label: tool === "write" ? "Creating a file…" : "Editing a file…",
        };
      }
      if (tool === "read") return { kind: "reading", label: "Reading project files…" };
      if (tool === "glob" || tool === "grep")
        return { kind: "searching", label: "Searching the project…" };
      if (tool === "bash") {
        const command = typeof input?.command === "string" ? input.command : "";
        return {
          kind: command.includes("test") ? "testing" : "running",
          label: command ? shellCommandLabel(command) : "Running a command…",
        };
      }
      if (tool === "websearch") return { kind: "searching", label: "Searching the web…" };
      if (tool === "skill") return { kind: "thinking", label: "Loading a skill…" };
      return { kind: "running", label: "Running a tool…" };
    }
    case "session.next.text.started":
      return { kind: "finalizing", label: "Writing the final reply…" };
    case "session.next.tool.failed":
    case "session.next.step.failed":
      return { kind: "fixing", label: "Fixing an error…" };
    case "session.next.retried":
      return { kind: "fixing", label: "Retrying…" };
    case "session.next.tool.success":
      return null;
    default:
      return null;
  }
}

/** Ordered build phases for the Apps Studio status checklist. */
export const BUILD_PHASES = [
  "analyzing",
  "designing",
  "writing",
  "transpiling",
  "finalizing",
] as const;

export type BuildPhase = (typeof BUILD_PHASES)[number];

/** Checklist labels, one per phase in order. */
export const BUILD_STEP_LABELS = [
  "Analyzing your request",
  "Designing the app",
  "Writing source files",
  "Creating the UI",
  "Finalizing the project",
] as const;

/**
 * Checklist labels for follow-up change requests. The app already exists, so
 * the steps read as edits to it rather than a fresh build.
 */
export const UPDATE_STEP_LABELS = [
  "Analyzing the change",
  "Planning the edits",
  "Applying changes to your files",
  "Refreshing the preview",
  "Finalizing the project",
] as const;

/** Checklist labels for building a brand-new 3D game in Games mode. */
export const GAME_BUILD_STEP_LABELS = [
  "Analyzing your game idea",
  "Designing the 3D world",
  "Writing the game code",
  "Compiling the WebGL scene",
  "Finalizing the game",
] as const;

/** Checklist labels for change requests to an existing game. */
export const GAME_UPDATE_STEP_LABELS = [
  "Analyzing the change",
  "Planning the edits",
  "Applying changes to your game",
  "Rebuilding the WebGL scene",
  "Finalizing the game",
] as const;

/** Short conversational updates streamed into the chat log while building. */
export const BUILD_STATUS_MESSAGES: Record<BuildPhase, string> = {
  analyzing: "Let me think through the right structure for this…",
  designing: "Setting up the layout and component plan…",
  writing: "Writing the components and wiring up the state…",
  transpiling: "Compiling it and running it in the preview…",
  finalizing: "Polishing the final touches — almost ready…",
};

/** Update-flavored narrations for change requests to an existing app. */
export const UPDATE_STATUS_MESSAGES: Record<BuildPhase, string> = {
  analyzing: "Let me figure out exactly what needs to change…",
  designing: "Planning the edits so they fit the existing code…",
  writing: "Applying the changes to your files…",
  transpiling: "Recompiling the updated app in the preview…",
  finalizing: "Polishing the final touches — almost ready…",
};

/** Game-flavored narrations for building a brand-new 3D game. */
export const GAME_BUILD_STATUS_MESSAGES: Record<BuildPhase, string> = {
  analyzing: "Let me think through the right game design…",
  designing: "Setting up the 3D world, physics, and controls…",
  writing: "Writing the game mechanics and scene…",
  transpiling: "Compiling it and running it in the preview…",
  finalizing: "Polishing the final touches — almost ready…",
};

/** Game-flavored narrations for change requests to an existing game. */
export const GAME_UPDATE_STATUS_MESSAGES: Record<BuildPhase, string> = {
  analyzing: "Let me figure out exactly what needs to change…",
  designing: "Planning the edits so they fit the existing game…",
  writing: "Applying the changes to your game…",
  transpiling: "Rebuilding the WebGL scene in the preview…",
  finalizing: "Polishing the final touches — almost ready…",
};

export function buildPhaseIndex(phase: BuildPhase): number {
  return BUILD_PHASES.indexOf(phase);
}

/** Maps live session stream events to the LLM phase they signal. */
const LLM_PHASE_BY_EVENT_TYPE: Record<string, BuildPhase> = {
  "session.next.prompted": "analyzing",
  "session.next.prompt.admitted": "analyzing",
  "session.next.step.started": "designing",
  "session.next.reasoning.started": "designing",
  "session.next.reasoning.delta": "designing",
  "session.next.text.started": "writing",
  "session.next.text.delta": "writing",
  "session.next.text.ended": "writing",
  "session.next.tool.input.started": "writing",
  "session.next.tool.input.delta": "writing",
  "session.next.tool.input.ended": "writing",
  "session.next.tool.called": "writing",
  "session.next.tool.progress": "writing",
  "session.next.tool.success": "writing",
  "session.next.step.ended": "writing",
  "session.idle": "writing",
};

/**
 * Maps a session stream event to the build phase it signals for the given
 * session. Returns null for events that don't represent progress (other
 * sessions, heartbeats, plumbing). Transpiling/finalizing are driven by the
 * client-side preview compile and are never emitted from stream events.
 */
export function buildPhaseFromEvent(event: Event, sessionID: string): BuildPhase | null {
  const phase = LLM_PHASE_BY_EVENT_TYPE[event.type];
  if (!phase) return null;
  const props = event.properties as { sessionID?: string };
  if (props.sessionID !== sessionID) return null;
  return phase;
}
