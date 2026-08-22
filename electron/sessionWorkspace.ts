import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

// ── Per-session workspace isolation ─────────────────────────────────────
// Each OpenCode session gets its own directory under the app's userData so
// the OpenCode engine (and the Rojo server) operate on exactly one session's
// files without leaking anything from earlier sessions (ForceR6,
// CombatAnimations, etc.).

/** Root directory holding one folder per session. */
export function sessionsRoot(): string {
  return join(app.getPath("userData"), "sessions");
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

/** Source folders referenced by the project tree ($path). */
export const PROJECT_SOURCE_DIRS = ["src", "server", "client"] as const;

/** The Rojo project served per session. The tree is deliberately minimal so a
 * new session can never inherit legacy references from an earlier place. */
export const SESSION_PROJECT_JSON = {
  name: "BloxMind Project",
  tree: {
    $className: "DataModel",
    ReplicatedStorage: {
      $className: "ReplicatedStorage",
      BloxMind: {
        $path: "src",
      },
    },
    ServerScriptService: {
      $className: "ServerScriptService",
      Server: {
        $path: "server",
      },
    },
    StarterPlayer: {
      $className: "StarterPlayer",
      StarterPlayerScripts: {
        $className: "StarterPlayerScripts",
        Client: {
          $path: "client",
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
