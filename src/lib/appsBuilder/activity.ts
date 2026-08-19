import type { Event } from "@opencode-ai/sdk/v2/client";

/** A single entry in the live agent Activity Log. */
export interface ActivityEntry {
  /** Stable id used as a React key. */
  id: number;
  /** The tool call this entry tracks, when the event carried one. */
  callID?: string;
  /** Status drives the badge + color. */
  status: "running" | "success" | "error";
  /** Short, human action verb, e.g. "Creating file", "Building project". */
  title: string;
  /** The exact file path or subject of the action, when known. */
  path?: string;
  /** Verbose detail — e.g. the underlying shell command or error message. */
  detail?: string;
}

/** The accumulated, ordered feed plus a callID → entry index for resolution. */
export interface ActivityFeed {
  /** Entries in the order they occurred; newest last. */
  entries: ActivityEntry[];
  /** Maps a tool callID to the entry currently tracking it. */
  byCallID: Map<string, number>;
}

export function createActivityFeed(): ActivityFeed {
  return { entries: [], byCallID: new Map() };
}

/** Guess a shell command's intent for the title line. */
function shellTitle(command: string): string {
  const cmd = command.toLowerCase();
  if (/\b(npm|pnpm|yarn|bun)\b/.test(cmd) && /\b(install|add|i)\b/.test(cmd)) {
    return "Installing packages";
  }
  if (/\b(test|vitest|jest|playwright|cypress)\b/.test(cmd)) {
    return "Running tests";
  }
  if (/\b(build|tsc|vite build)\b/.test(cmd)) {
    return "Building project";
  }
  if (/\b(dev|lint|format|biome)\b/.test(cmd)) {
    return "Running project command";
  }
  return "Running shell command";
}

/** Extract a file path from a tool input object using any of the common keys. */
function filePathFromInput(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  if (typeof input.path === "string") return input.path;
  if (typeof input.filePath === "string") return input.filePath;
  if (typeof input.filename === "string") return input.filename;
  return undefined;
}

/** True when the event belongs to the given session (mirrors other extractors). */
function isForSession(event: Event, sessionID: string): boolean {
  const props = event.properties as { sessionID?: string };
  return props.sessionID === sessionID;
}

/** Append an entry, returning a brand-new feed so React sees a new reference. */
function append(feed: ActivityFeed, entry: ActivityEntry): ActivityFeed {
  return { entries: [...feed.entries, entry], byCallID: feed.byCallID };
}

/** Replace one entry by id, returning a new feed. */
function replace(feed: ActivityFeed, id: number, entry: ActivityEntry): ActivityFeed {
  return {
    entries: feed.entries.map((item) => (item.id === id ? entry : item)),
    byCallID: feed.byCallID,
  };
}

/**
 * Apply a session stream event to the activity feed for the given session.
 * Tool calls append a `running` entry; their success/failure events resolve
 * that same entry by callID so badges flip instead of stacking. Step failures
 * and retries append standalone error entries. Returns a NEW feed reference on
 * any change so callers can use it directly as React state.
 */
export function applyActivityEvent(
  feed: ActivityFeed,
  event: Event,
  sessionID: string,
): ActivityFeed {
  if (!isForSession(event, sessionID)) return feed;

  switch (event.type) {
    case "session.next.reasoning.started":
    case "session.next.reasoning.delta":
      if (event.type === "session.next.reasoning.delta" && feed.entries[feed.entries.length - 1]?.title === "Thinking through the approach…") {
        return feed;
      }
      return append(feed, {
        id: feed.entries.length + 1,
        status: "running",
        title: "Thinking through the approach…",
      });
    case "session.next.step.started":
      return append(feed, {
        id: feed.entries.length + 1,
        status: "running",
        title: "Planning the next step…",
      });
    case "session.next.text.started":
      return append(feed, {
        id: feed.entries.length + 1,
        status: "running",
        title: "Writing code…",
      });
    case "session.next.tool.input.started":
      return append(feed, {
        id: feed.entries.length + 1,
        status: "running",
        title: "Preparing a tool call…",
      });
    case "session.next.tool.called": {
      const props = event.properties as {
        callID?: string;
        tool?: string;
        input?: Record<string, unknown>;
      };
      const tool = props.tool ?? "";
      const input = props.input;
      const callID = props.callID;
      const path = filePathFromInput(input);
      let title = "Running tool";
      let detail: string | undefined;
      switch (tool) {
        case "write":
          title = "Creating file";
          break;
        case "edit":
          title = "Editing file";
          break;
        case "read":
          title = "Reading file";
          break;
        case "glob":
          title = "Listing files";
          break;
        case "grep":
          title = "Searching files";
          break;
        case "bash": {
          const command = typeof input?.command === "string" ? input.command : "";
          title = shellTitle(command);
          detail = command;
          break;
        }
        case "websearch":
          title = "Searching the web";
          break;
        case "skill":
          title = "Loading skill";
          break;
        case "task":
          title = "Delegating subtask";
          break;
        default:
          title = "Running tool";
          detail = tool;
          break;
      }
      const entry: ActivityEntry = {
        id: feed.entries.length + 1,
        callID,
        status: "running",
        title,
        path,
        detail,
      };
      const next = append(feed, entry);
      if (callID) next.byCallID = new Map(next.byCallID).set(callID, entry.id);
      return next;
    }
    case "session.next.tool.success": {
      const props = event.properties as { callID?: string };
      if (!props.callID) return feed;
      const target = feed.byCallID.get(props.callID);
      const entry =
        target !== undefined ? feed.entries.find((item) => item.id === target) : undefined;
      if (entry?.status !== "running") return feed;
      return replace(feed, entry.id, {
        ...entry,
        status: "success",
        title: `${entry.title} — done`,
      });
    }
    case "session.next.tool.failed": {
      const props = event.properties as {
        callID?: string;
        error?: { message?: string };
      };
      if (props.callID) {
        const target = feed.byCallID.get(props.callID);
        const entry =
          target !== undefined ? feed.entries.find((item) => item.id === target) : undefined;
        if (entry && entry.status === "running") {
          return replace(feed, entry.id, {
            ...entry,
            status: "error",
            title: `${entry.title} failed`,
            detail: props.error?.message ?? entry.detail,
          });
        }
      }
      return append(feed, {
        id: feed.entries.length + 1,
        status: "error",
        title: "Tool failed",
        detail: props.error?.message,
      });
    }
    case "session.next.step.failed": {
      const props = event.properties as { error?: { message?: string } };
      return append(feed, {
        id: feed.entries.length + 1,
        status: "error",
        title: "Step failed",
        detail: props.error?.message,
      });
    }
    case "session.next.retried": {
      const props = event.properties as { error?: { message?: string } };
      return append(feed, {
        id: feed.entries.length + 1,
        status: "error",
        title: "Retrying after error",
        detail: props.error?.message,
      });
    }
    default:
      return feed;
  }
}
