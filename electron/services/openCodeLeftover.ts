import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, win32 } from "node:path";

/**
 * OpenCode keeps its chats in one SQLite database, and a second OpenCode on it fails to start
 * with "database is locked". BloxMind stops its own OpenCode when it quits, but not when it
 * crashes or is ended from Task Manager, and on Windows that OpenCode keeps running. So the
 * running one's process ID is kept in a file, and a new start first stops one left behind.
 */

/** What a process lookup needs, so tests can fake it. */
export interface ProcessTable {
  /** The file name of the program a process runs, or null when it isn't running. */
  name(pid: number): Promise<string | null>;
  alive(pid: number): boolean;
  kill(pid: number): void;
  /** When the process started, in ms since the epoch; null when unknown. */
  created(pid: number): Promise<number | null>;
}

const LOOKUP_TIMEOUT_MS = 5_000;

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        command,
        args,
        { timeout: LOOKUP_TIMEOUT_MS, windowsHide: true, encoding: "utf8" },
        (error, stdout) => resolve(error ? null : stdout),
      );
    } catch {
      resolve(null);
    }
  });
}

/** The image name in `tasklist /FO CSV /NH` output, or null for its "no tasks" line. */
export function parseTasklistName(output: string): string | null {
  return /^\s*"([^"]+)","\d+"/m.exec(output)?.[1] ?? null;
}

/** `ps -o etimes=` prints seconds since the process started. */
export function parseEtimes(output: string): number | null {
  const match = /\s*(\d+)\s*$/.exec(output.trim());
  const seconds = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(seconds) ? seconds : null;
}

/** Windows `CreationDate.ToString(\"yyyy-MM-ddTHH:mm:ss\")` output, in local time. */
export function parseCreationDate(output: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(output.trim());
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  ).getTime();
}

export const systemProcessTable: ProcessTable = {
  async name(pid) {
    if (process.platform === "win32") {
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      const tasklist = win32.join(systemRoot, "System32", "tasklist.exe");
      const output = await run(tasklist, ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
      return output ? parseTasklistName(output) : null;
    }
    const output = (await run("ps", ["-p", String(pid), "-o", "comm="]))?.trim();
    return output ? basename(output) : null;
  },
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (cause) {
      // EPERM means it's there but belongs to someone else.
      return (cause as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  async created(pid) {
    if (process.platform === "win32") {
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      const powershell = win32.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const output = await run(powershell, [
        "-NoProfile",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction SilentlyContinue; if ($p) { $p.CreationDate.ToString('yyyy-MM-ddTHH:mm:ss') }`,
      ]);
      return output ? parseCreationDate(output) : null;
    }
    const output = await run("ps", ["-p", String(pid), "-o", "etimes="]);
    const etimes = output ? parseEtimes(output) : null;
    return etimes === null ? null : Date.now() - etimes * 1000;
  },
  kill(pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is what we wanted.
    }
  },
};

interface Recorded {
  pid: number;
  name: string;
  /** When the pid was recorded, ~= process start; used to spot pid reuse. */
  created?: number;
}

async function readRecorded(file: string): Promise<Recorded | null> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as Partial<Recorded>;
    return Number.isSafeInteger(value.pid) && typeof value.name === "string"
      ? {
          pid: value.pid as number,
          name: value.name,
          created: typeof value.created === "number" ? value.created : undefined,
        }
      : null;
  } catch {
    return null;
  }
}

/** Notes the OpenCode now running. A failure only costs the cleanup after a crash. */
export async function recordOpenCodeProcess(
  file: string,
  pid: number,
  executable: string,
): Promise<void> {
  // win32's basename splits on both kinds of slash, so it does for every platform.
  const name = win32.basename(executable);
  await writeFile(file, JSON.stringify({ pid, name, created: Date.now() })).catch(() => undefined);
}

/** Forgets an OpenCode that has stopped, unless a newer one has been noted since. */
export async function forgetOpenCodeProcess(file: string, pid: number): Promise<void> {
  if ((await readRecorded(file))?.pid !== pid) return;
  await rm(file, { force: true }).catch(() => undefined);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How much a live process's creation time may drift from the recorded one. */
const CREATED_TOLERANCE_MS = 120_000;

/**
 * Stops the OpenCode an earlier run left behind and waits until it has gone, as only then is the
 * database free. Returns its process ID, or null when there was none. A process that has since
 * taken the same ID is left alone: its program name or creation time won't match.
 */
export async function stopLeftoverOpenCode(
  file: string,
  table: ProcessTable = systemProcessTable,
  timeoutMs = 5_000,
): Promise<number | null> {
  const recorded = await readRecorded(file);
  if (!recorded || recorded.pid === process.pid) return null;
  const name = await table.name(recorded.pid);
  if (!name || name.toLowerCase() !== recorded.name.toLowerCase()) {
    await rm(file, { force: true }).catch(() => {});
    return null;
  }
  // The pid was recycled? Its creation time will be far from ours.
  if (recorded.created !== undefined) {
    const created = await table.created(recorded.pid).catch(() => null);
    if (created !== null && Math.abs(created - recorded.created) > CREATED_TOLERANCE_MS) {
      await rm(file, { force: true }).catch(() => {});
      return null;
    }
  }
  table.kill(recorded.pid);
  const deadline = Date.now() + timeoutMs;
  while (table.alive(recorded.pid) && Date.now() < deadline) await sleep(100);
  await rm(file, { force: true }).catch(() => {});
  return recorded.pid;
}
