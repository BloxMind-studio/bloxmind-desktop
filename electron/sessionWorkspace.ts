import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

// ── Per-session workspace isolation ─────────────────────────────────────
// `~/BloxMind` is the absolute single source of truth for session workspaces.
// Each OpenCode session gets its own directory under `~/BloxMind/sessions`,
// so the OpenCode engine (and the Rojo server) operate on exactly one
// session's files without leaking anything from earlier sessions
// (ForceR6, CombatAnimations, etc.).

/** Root directory holding one folder per session. */
export function sessionsRoot(): string {
  return join(app.getPath("home"), "BloxMind", "sessions");
}

/** Reserved top-level entries in `~/BloxMind` that must survive the legacy purge. */
const RESERVED_ROOT_ENTRIES = new Set(["sessions"]);

/**
 * Safely clean the unified app workspace root (`~/BloxMind`) on first launch /
 * migration: removes every stale top-level entry that is NOT a session folder,
 * while preserving `sessions/` and any engine-owned dot-directories
 * (e.g. `.opencode`, `.cache`). Non-recursive, per-entry, so a corrupt or
 * locked file can never abort the entire purge.
 */
export async function purgeLegacyRootWorkspace(): Promise<void> {
  const root = join(app.getPath("home"), "BloxMind");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return; // directory doesn't exist yet; nothing to purge
  }
  for (const entry of entries) {
    if (RESERVED_ROOT_ENTRIES.has(entry) || entry.startsWith(".")) continue;
    try {
      await rm(join(root, entry), { recursive: true, force: true });
    } catch {
      // Best-effort: a locked or in-use file must not block startup.
    }
  }
}

/**
 * Sanitize a session id for use as a filesystem segment. OpenCode ids are
 * URL-safe, but this guards against any path-traversal surprises anyway.
 */
export function sanitizeSessionId(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe === "" ? "session" : safe;
}

/** The isolated workspace directory for a given session. */
export function sessionWorkspaceDir(sessionId: string): string {
  return join(sessionsRoot(), sanitizeSessionId(sessionId));
}

// ── Source tree layout ───────────────────────────────────────────────────
// Mirrors the unified project layout Rojo publishes, but lives inside each
// session folder so every session starts with a clean source tree and a fresh
// default.project.json — no stale references from earlier sessions.
export const PROJECT_SOURCE_DIRS = ["src/server", "src/client", "src/shared"] as const;

/** The Rojo project served per session. The tree is deliberately minimal so a
 * new session can never inherit legacy references from an earlier place. */
export const SESSION_PROJECT_JSON = {
  name: "BloxMind Project",
  tree: {
    $className: "DataModel",
    ReplicatedStorage: {
      $className: "ReplicatedStorage",
      BloxMind: {
        $path: "src/shared",
      },
    },
    ServerScriptService: {
      $className: "ServerScriptService",
      Server: {
        $path: "src/server",
      },
    },
    StarterPlayer: {
      $className: "StarterPlayer",
      StarterPlayerScripts: {
        $className: "StarterPlayerScripts",
        Client: {
          $path: "src/client",
        },
      },
    },
  },
};

/**
 * Create a session's isolated workspace on disk BEFORE the session exists:
 * the folder itself, the source folders Rojo's $path entries point at, and a
 * fresh default.project.json. Returns the absolute directory so the renderer
 * can pass it as the session's location on creation.
 */
export async function ensureSessionWorkspace(sessionId: string): Promise<string> {
  const dir = sessionWorkspaceDir(sessionId);
  await mkdir(dir, { recursive: true });
  for (const sub of PROJECT_SOURCE_DIRS) {
    await mkdir(join(dir, sub), { recursive: true });
  }
  await writeFile(
    join(dir, "default.project.json"),
    JSON.stringify(SESSION_PROJECT_JSON, null, 2),
    "utf8",
  );
  return dir;
}
