import { execFile } from "node:child_process";

/**
 * Startup sweep for stale `rojo.exe` / `opencode.exe` processes left behind
 * by a crashed, force-killed, or dev-restarted session.
 *
 * Targeting (Windows): candidates are discovered by process NAME via
 * `tasklist`, then scoped by PARENT liveness. Parent PIDs are queried with
 * `Get-CimInstance Win32_Process` (through powershell.exe) and each
 * candidate is only killed when its parent process no longer exists — i.e.
 * it was orphaned by a dead previous BloxMind session. Candidates whose
 * parent is still alive (e.g. a rojo/opencode binary the user started
 * manually) are skipped and reported via `skippedLiveParent`.
 *
 * Strictly best-effort: if parent discovery fails (PowerShell error, empty
 * or unparseable output, or the live-PID lookup fails), the sweep falls
 * back to the previous name-based kill and flags the report with
 * `fallback: true` so the caller can log it. The sweep never throws and
 * must never block or crash app startup — every external command runs with
 * a hard timeout, and kills use `taskkill /F /T` to take down entire
 * process trees. Non-Windows platforms are a graceful no-op.
 */

/** Process image names swept on Windows. */
export const STALE_PROCESS_IMAGES = ["rojo.exe", "opencode.exe"] as const;

/** Hard timeout for every spawned command so a hung tool can't stall startup. */
const EXEC_TIMEOUT_MS = 5_000;

export interface SweepKilled {
  readonly image: string;
  readonly pid: number;
}

export interface SweepFailed {
  readonly image: string;
  readonly pid: number;
  readonly error: string;
}

export interface SweepReport {
  /** True when the platform has no sweep implementation (no-op). */
  readonly skipped: boolean;
  readonly killed: readonly SweepKilled[];
  readonly failed: readonly SweepFailed[];
  /** Candidates skipped because their parent process is still alive. */
  readonly skippedLiveParent: number;
  /** True when parent discovery failed and the name-based kill was used. */
  readonly fallback: boolean;
}

/** Injectable command runner so tests can avoid touching the OS. */
export type SweepRunner = (file: string, args: readonly string[]) => Promise<string>;

const defaultRunner: SweepRunner = (file, args) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      file,
      [...args],
      { windowsHide: true, timeout: EXEC_TIMEOUT_MS },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });

/**
 * PowerShell command that emits one `pid,parentPid` line per matching
 * process. Written with only single-quoted PowerShell strings so Node's
 * Windows argument quoting passes it through intact.
 */
const PARENT_QUERY_COMMAND =
  "Get-CimInstance Win32_Process -Filter 'Name=''rojo.exe'' OR Name=''opencode.exe''' | " +
  "ForEach-Object { $_.ProcessId.ToString() + ',' + $_.ParentProcessId.ToString() }";

/**
 * Parse PIDs out of `tasklist /FO CSV /NH` output, e.g.
 * `"rojo.exe","12345","Console","1","1,234 K"`. Non-process lines (such as
 * tasklist's `INFO: No tasks are running...` message) yield no PIDs.
 */
export function parseTasklistPids(output: string): number[] {
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split(",").map((field) => field.trim().replace(/^"|"$/g, ""));
    if (fields.length < 2) continue;
    const pid = Number.parseInt(fields[1] ?? "", 10);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/**
 * Parse `pid,parentPid` lines (as produced by {@link PARENT_QUERY_COMMAND})
 * into a map. Malformed lines are ignored.
 */
export function parseParentPids(output: string): ReadonlyMap<number, number> {
  const parents = new Map<number, number>();
  for (const line of output.split(/\r?\n/)) {
    const [pidPart, ppidPart] = line.trim().split(",");
    const pid = Number.parseInt(pidPart ?? "", 10);
    const ppid = Number.parseInt(ppidPart ?? "", 10);
    if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid)) {
      parents.set(pid, ppid);
    }
  }
  return parents;
}

/** List every live PID on the system; null when the listing fails. */
async function listLivePids(run: SweepRunner): Promise<Set<number> | null> {
  try {
    const listing = await run("tasklist", ["/FO", "CSV", "/NH"]);
    return new Set(parseTasklistPids(listing));
  } catch {
    return null;
  }
}

export async function sweepStaleProcesses(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly run?: SweepRunner;
  } = {},
): Promise<SweepReport> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? defaultRunner;
  const killed: SweepKilled[] = [];
  const failed: SweepFailed[] = [];

  if (platform !== "win32") {
    return { skipped: true, killed, failed, skippedLiveParent: 0, fallback: false };
  }

  // ── 1. Collect name-matched candidates ────────────────────────────────
  let candidates: SweepKilled[] = [];
  for (const image of STALE_PROCESS_IMAGES) {
    let listing: string;
    try {
      listing = await run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"]);
    } catch {
      // Listing failed — skip this image; the sweep is best-effort.
      continue;
    }
    for (const pid of parseTasklistPids(listing)) {
      if (pid === process.pid) continue;
      candidates.push({ image, pid });
    }
  }

  if (candidates.length === 0) {
    return { skipped: false, killed, failed, skippedLiveParent: 0, fallback: false };
  }

  // ── 2. Scope by parent liveness (best-effort) ─────────────────────────
  let parents: ReadonlyMap<number, number> | null = null;
  try {
    parents = parseParentPids(
      await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        PARENT_QUERY_COMMAND,
      ]),
    );
  } catch {
    parents = null;
  }
  const live = parents !== null && parents.size > 0 ? await listLivePids(run) : null;

  let skippedLiveParent = 0;
  let fallback = false;
  if (parents === null || parents.size === 0 || live === null) {
    // Parent discovery failed — fall back to the name-based kill.
    fallback = true;
  } else {
    const orphans: SweepKilled[] = [];
    for (const candidate of candidates) {
      const ppid = parents.get(candidate.pid);
      if (ppid !== undefined && ppid > 0 && live.has(ppid)) {
        // Live parent => user-launched (or owned by a live process): skip.
        skippedLiveParent += 1;
        continue;
      }
      orphans.push(candidate);
    }
    candidates = orphans;
  }

  // ── 3. Kill orphans (with process trees) ──────────────────────────────
  for (const { image, pid } of candidates) {
    try {
      await run("taskkill", ["/F", "/T", "/PID", String(pid)]);
      killed.push({ image, pid });
    } catch (cause) {
      failed.push({ image, pid, error: String(cause) });
    }
  }

  return { skipped: false, killed, failed, skippedLiveParent, fallback };
}
