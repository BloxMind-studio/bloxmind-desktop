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
import { stat } from "node:fs/promises";
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
  /**
   * List every file recorded in the repository.
   * - Without `ref`: currently tracked/index files (legacy behaviour).
   * - With `ref` (a commit-ish/OID, e.g. a dangling snapshot commit): every
   *   file in THAT tree, used by CheckpointService's diff-based prune to
   *   decide which on-disk files were created after the snapshot.
   */
  readonly listFiles: (workspace: string, ref?: string) => Promise<string[]>;
  readonly getChangedFiles: (workspace: string) => Promise<string[]>;
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
    const stashRef = (await runGit(workspace, ["stash", "create", label]).catch(() => "")).trim();
    await runGit(workspace, ["reset", "--quiet"]).catch(() => "");
    if (stashRef) return stashRef;
    // `git stash create` produces NO commit on a completely clean worktree
    // (nothing modified/staged). That must still yield a restorable snapshot —
    // pre-task captures happen exactly when the tree is clean. Fall back to a
    // dangling commit built from the current index tree (`write-tree` +
    // `commit-tree -p HEAD`), mirroring the embedded backend's
    // `noUpdateBranch` semantics: no branch is moved, HEAD untouched.
    const tree = (await runGit(workspace, ["write-tree"])).trim();
    const ref = (
      await runGit(workspace, ["commit-tree", tree, "-p", "HEAD", "-m", label])
    ).trim();
    if (!ref) throw new GitBackendError("snapshot produced no ref");
    return ref;
  },

  async restore(workspace, ref, paths) {
    await runGit(workspace, ["checkout", ref, "--", ...paths]);
  },

  async listFiles(workspace, ref?) {
    if (!ref) {
      const tracked = await runGit(workspace, ["ls-files"]);
      return tracked.split("\n").filter(Boolean);
    }
    const out = await runGit(workspace, ["ls-tree", "-r", "--name-only", ref]);
    return out.split("\n").filter(Boolean);
  },

  async getChangedFiles(workspace) {
    // Union of unstaged, staged, and untracked paths = the full dirty set,
    // i.e. exactly the files a task-scoped checkpoint must track.
    const [unstaged, staged, untracked] = await Promise.all([
      runGit(workspace, ["diff", "--name-only"]).catch(() => ""),
      runGit(workspace, ["diff", "--cached", "--name-only"]).catch(() => ""),
      runGit(workspace, ["ls-files", "--others", "--exclude-standard"]).catch(() => ""),
    ]);
    const all = [...unstaged.split("\n"), ...staged.split("\n"), ...untracked.split("\n")]
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set(all)];
  },
};
// ── Embedded isomorphic-git backend (fallback) ───────────────────────────

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
      const emptyTree = await isomorphicGit.writeTree({ fs, dir: workspace, tree: [] });
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
    // `noUpdateBranch: true` creates the commit object in the object database
    // WITHOUT advancing HEAD or moving any branch — mirroring `git stash create`
    // which produces a dangling-but-accessible commit OID. The snapshot ref is
    // checked out later by OID for restore, so no branch needs to point at it.
    const oid = await isomorphicGit.commit({
      fs,
      dir: workspace,
      author: EMBEDDED_AUTHOR,
      message: label,
      noUpdateBranch: true,
    });
    return oid;
  },

  async restore(workspace, ref, paths) {
    const fs = await getFs();
    // Try a bulk checkout of all paths at once.
    try {
      await isomorphicGit.checkout({
        fs,
        dir: workspace,
        ref,
        filepaths: paths,
        force: true,
      });
    } catch {
      // Bulk checkout can fail on individual paths (e.g. directory structure
      // differences, missing dirs in sparse checkouts). Fall back to per-file
      // checkout so one bad path doesn't abort the entire restore — the journal
      // fallback in CheckpointService handles any remaining gaps.
      for (const path of paths) {
        try {
          await isomorphicGit.checkout({
            fs,
            dir: workspace,
            ref,
            filepaths: [path],
            force: true,
          });
        } catch {
          // Skip this path — journal restore will cover it if needed.
        }
      }
    }
  },

  async listFiles(workspace, ref?) {
    const fs = await getFs();
    if (ref) {
      // With a ref (a possibly-dangling snapshot commit OID), enumerate the
      // files recorded in THAT tree instead of the index.
      return isomorphicGit.listFiles({ fs, dir: workspace, ref });
    }
    return isomorphicGit.listFiles({ fs, dir: workspace });
  },

  async getChangedFiles(workspace) {
    const fs = await getFs();
    // statusMatrix returns [filepath, HEAD, WORKDIR, STAGE] with 0=absent, 1=present
    // A file is dirty if WORKDIR != HEAD or STAGE != HEAD or HEAD === 0 (untracked)
    const matrix = await isomorphicGit.statusMatrix({ fs, dir: workspace });
    const dirty: string[] = [];
    for (const [filepath, head, workdir, stage] of matrix) {
      // Skip directories that are in SKIP_DIRS (they are not in matrix anyway)
      // A file is considered changed if it's not clean (head === workdir && workdir === stage is clean)
      const isClean = head === 1 && workdir === 1 && stage === 1;
      const isUntracked = head === 0 && (workdir === 1 || stage === 1);
      if (!isClean || isUntracked) {
        dirty.push(filepath);
      }
    }
    // Also handle untracked files that statusMatrix might not report as dirty
    // due to being in an untracked directory? The matrix should cover them, but
    // as a fallback, also check for untracked via a direct readdir scan for
    // files that are not in the index. For now, the matrix is sufficient.
    return dirty;
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

/** Reset the cached backend so the next `resolveGitBackend()` re-detects. */
export function resetGitBackendCache(): void {
  cachedBackend = null;
}
