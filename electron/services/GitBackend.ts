/**
 * GitBackend — embedded git for CheckpointService.
 *
 * BloxMind must capture/restore workspace checkpoints on end-user machines that
 * may not have a `git` binary installed. We keep the battle-tested system-git
 * path as the default (faithful `stash create` / `checkout`), and transparently
 * fall back to an embedded pure-JS implementation (isomorphic-git) that does
 * not require any system dependency.
 *
 * The operations exposed mirror exactly what CheckpointService needs:
 *   - isGitRepo   : is the workspace a git repository?
 *   - ensureBaseline : guarantee a root commit exists (needed by any backend)
 *   - snapshot    : create a restore-point ref capturing the workspace state
 *   - restore     : apply a previously-snapshot ref back onto the files
 *   - listFiles   : enumerate tracked files to decide what to prune on restore
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import * as isomorphicGit from "isomorphic-git";

const exec = promisify(execFile);

/** Author identity used by the embedded fallback. */
const EMBEDDED_AUTHOR = { name: "BloxMind", email: "bloxmind@local" };

export class GitBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitBackendError";
  }
}

export interface GitBackend {
  readonly isGitRepo: (workspace: string) => Promise<boolean>;
  readonly ensureBaseline: (workspace: string) => Promise<void>;
  readonly snapshot: (workspace: string, label: string) => Promise<string>;
  readonly restore: (workspace: string, ref: string, paths: string[]) => Promise<void>;
  readonly listFiles: (workspace: string) => Promise<string[]>;
}

// ── System-git backend (preferred) ──────────────────────────────────────

async function runGit(workspace: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd: workspace,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (cause) {
    throw new GitBackendError(
      `git ${args.join(" ")} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/** True when a usable `git` binary is discoverable (via `git --version`). */
async function systemGitAvailable(): Promise<boolean> {
  try {
    await exec("git", ["--version"], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const systemBackend: GitBackend = {
  async isGitRepo(workspace) {
    try {
      const out = await runGit(workspace, ["rev-parse", "--is-inside-work-tree"]);
      return out.trim() === "true";
    } catch {
      return false;
    }
  },

  async ensureBaseline(workspace) {
    const head = await runGit(workspace, ["rev-parse", "--verify", "HEAD"]).catch(() => "");
    if (head.trim()) return;
    const email = await runGit(workspace, ["config", "user.email"]).catch(() => "");
    const name = await runGit(workspace, ["config", "user.name"]).catch(() => "");
    if (!email.trim() || !name.trim()) return;
    await runGit(workspace, ["commit", "--allow-empty", "--no-verify", "-m", "bloxmind: baseline"]);
  },

  async snapshot(workspace, label) {
    await runGit(workspace, ["add", "-A", "--"]);
    const ref = (await runGit(workspace, ["stash", "create", label])).trim();
    await runGit(workspace, ["reset", "--quiet"]).catch(() => "");
    if (!ref) throw new GitBackendError("stash create produced no ref");
    return ref;
  },

  async restore(workspace, ref, paths) {
    await runGit(workspace, ["checkout", ref, "--", ...paths]);
  },

  async listFiles(workspace) {
    const out = await runGit(workspace, ["ls-files"]);
    return out.split("\n").filter(Boolean);
  },
};
// ── Embedded isomorphic-git backend (fallback) ───────────────────────────

import { stat } from "node:fs/promises";

type FsPromises = typeof import("node:fs").promises;

/** `node:fs/promises` has no `existsSync`; use stat-based existence check. */
async function fsExists(path: string): Promise<void> {
  await stat(path);
}

async function getFs(): Promise<FsPromises> {
  return (await import("node:fs")).promises;
}

/** Directories that must never be journaled into a snapshot (noise / derived). */
const EMBEDDED_SKIP = new Set([
  ".git",
  ".gitmodules",
  ".opencode",
  "node_modules",
  "dist",
  "dist-electron",
  ".bloxmind",
  ".vite",
  "build",
  "coverage",
]);

/** Recursively returns relative file paths under the workspace (no .git). */
async function listFilesUnder(workspace: string): Promise<string[]> {
  const fs = await getFs();
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(join(workspace, dir), { withFileTypes: true });
    for (const entry of entries) {
      if (EMBEDDED_SKIP.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  await walk("");
  return files;
}

function exists(path: string): Promise<boolean> {
  return fsExists(path).then(
    () => true,
    () => false,
  );
}

const embeddedBackend: GitBackend = {
  async isGitRepo(workspace) {
    return exists(join(workspace, ".git"));
  },

  async ensureBaseline(workspace) {
    const fs = await getFs();
    if (!(await exists(join(workspace, ".git")))) {
      await isomorphicGit.init({ fs, dir: workspace, defaultBranch: "master" });
    }
    try {
      await isomorphicGit.resolveRef({ fs, dir: workspace, ref: "HEAD" });
    } catch {
      // Unborn HEAD: commit an empty tree so future snapshots have a base.
      const emptyTree = await isomorphicGit.writeTree({ fs, dir: workspace });
      await isomorphicGit.commit({
        fs,
        dir: workspace,
        author: EMBEDDED_AUTHOR,
        message: "bloxmind: baseline",
        tree: emptyTree,
        // `ref: undefined` updates the default branch ref (MASTER) so HEAD
        // advances past the unborn state. This is the one commit the user's
        // repo genuinely needs.
      });
    }
  },

  async snapshot(workspace, label) {
    const fs = await getFs();
    const relPaths = await listFilesUnder(workspace);
    // isomorphic-git `add` requires a single string filepath.
    for (const rel of relPaths) {
      await isomorphicGit.add({ fs, dir: workspace, filepath: rel });
    }
    // `ref: undefined` (omitting ref) writes the commit WITHOUT moving any
    // branch/HEAD/tag, so the user's working tree and branches stay untouched.
    // The returned oid is the detached snapshot ref we persist.
    const oid = await isomorphicGit.commit({
      fs,
      dir: workspace,
      author: EMBEDDED_AUTHOR,
      message: label,
      // No `ref` => detached commit object; oid returned directly.
    });
    return oid;
  }



  async restore(workspace, ref, paths) {
    const fs = await getFs();
    await isomorphicGit.checkout({
      fs,
      dir: workspace,
      ref,
      filepaths: paths,
      force: true,
    });
  },

  async listFiles(workspace) {
    const fs = await getFs();
    return isomorphicGit.listFiles({ fs, dir: workspace });
  },
};

// ── Resolve the best available backend ───────────────────────────────────

async function detectBackend(): Promise<GitBackend> {
  const systemOk = await systemGitAvailable();
  return systemOk ? systemBackend : embeddedBackend;
}

let cachedBackend: GitBackend | null = null;
/** Detect once per process; the presence of system git is stable at runtime. */
export async function resolveGitBackend(): Promise<GitBackend> {
  if (cachedBackend) return cachedBackend;
  cachedBackend = await detectBackend();
  return cachedBackend;
}

/** Force the embedded backend (used by tests) — clears any cached selection. */
export function forceEmbeddedGitBackend(): void {
  cachedBackend = embeddedBackend;
}
