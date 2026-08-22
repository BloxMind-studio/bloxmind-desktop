import { type ChildProcessWithoutNullStreams, exec, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Data, Effect, Layer } from "effect";

import {
  SESSION_PROJECT_JSON,
  PROJECT_SOURCE_DIRS as SESSION_PROJECT_SOURCE_DIRS,
} from "../sessionWorkspace";

// ── Types ────────────────────────────────────────────────────────────────

export class RojoError extends Data.TaggedError("RojoError")<{
  message: string;
  cause?: unknown;
}> {}

export interface RojoStatus {
  active: boolean;
  port: number | null;
  error: string | null;
  workspace: string | null;
  clientConnected: boolean;
}

export interface RojoLogEntry {
  timestamp: number;
  stream: "stdout" | "stderr";
  message: string;
}

export interface RojoServerManagerOptions {
  binDirectory: string;
  /** Resolve the isolated workspace directory for a session. */
  sessionWorkspaceDir?: (sessionId: string) => string;
}

export interface RojoServerManager {
  readonly start: (workspace: string) => Effect.Effect<RojoStatus, RojoError>;
  readonly startForSession: (sessionId: string) => Effect.Effect<RojoStatus, RojoError>;
  readonly stop: () => Effect.Effect<void, RojoError>;
  readonly status: () => Effect.Effect<RojoStatus, RojoError>;
  readonly toggle: (workspace: string) => Effect.Effect<RojoStatus, RojoError>;
  readonly toggleForSession: (sessionId: string) => Effect.Effect<RojoStatus, RojoError>;
  readonly getLogs: () => Effect.Effect<RojoLogEntry[], RojoError>;
  readonly onLog: (listener: (entry: RojoLogEntry) => void) => () => void;
}

export class RojoServerManagerTag extends Effect.Tag("@BloxMind/RojoServerManager")<
  RojoServerManagerTag,
  RojoServerManager
>() {}

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_ROJO_PORT = 34872;
const MAX_LOG_ENTRIES = 500;
const STARTUP_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 500;
/** Hard upper bound for quit-time cleanup so app shutdown can never hang. */
const CLEANUP_TIMEOUT_MS = 3_000;
// Rojo 6.x prints "listening on http://localhost:34872/"; Rojo 7.x prints
// "Rojo server listening:". Match both so we don't wait for a string that
// never appears and then kill a healthy server.
const ROJO_PORT_REGEX = /(?:port|serving)[:\s]*([0-9]{2,5})/i;
const ROJO_CLIENT_CONNECTED_REGEX = /client connected|session opened|room joined/i;
const ROJO_CLIENT_DISCONNECTED_REGEX = /client disconnected|session closed|room left/i;
const ROJO_LISTENING_REGEX = /(?:rojo server listening|listening on +https?:\/\/[^\s]+)/i;
const ROJO_ERROR_REGEX = /(?:error|failed|cannot|unable to|port already in use)/i;

/** Remove ANSI color/control sequences that Rojo emits when stdout is a pipe. */
function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI sequences begin with ESC by design
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * Detect whether Roblox Studio (or any client) is currently connected to the
 * Rojo server by parsing `netstat -ano` output. `systeminformation` only
 * reports LISTEN sockets on Windows, so we parse netstat directly to catch
 * ESTABLISHED connections from Roblox Studio. This is far more reliable than
 * parsing Rojo's log output, which varies between versions and can be
 * ANSI-encoded or buffered.
 */
async function hasClientOnPort(port: number): Promise<boolean> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const isWindows = process.platform === "win32";
      exec(isWindows ? "netstat -ano" : "netstat -an", { windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    const portString = String(port);
    const portCol = `:${portString}`;
    // Match lines like:
    //   TCP  127.0.0.1:34872  127.0.0.1:59913  ESTABLISHED  5140
    // The third column is the remote; an ESTABLISHED connection whose local
    // column is our port means a client is connected. We require a remote
    // peerPort > 0 to exclude the server's own LISTEN socket.
    return stdout.split(/\r?\n/).some((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return false;
      const localCol = parts[1] ?? "";
      const stateCol = parts[3] ?? "";
      const peerCol = parts[2] ?? "";
      if (!localCol.endsWith(portCol)) return false;
      if (stateCol !== "ESTABLISHED") return false;
      // Peer must be a real client socket, not 0.0.0.0:0.
      const peerPortPart = peerCol.lastIndexOf(":");
      const peerPort = peerPortPart >= 0 ? Number(peerCol.slice(peerPortPart + 1)) : 0;
      return peerPort > 0;
    });
  } catch {
    return false;
  }
}

// ── Module-level runtime state ───────────────────────────────────────────

interface RojoRuntime {
  child: ChildProcessWithoutNullStreams;
  workspace: string;
  port: number | null;
  clientConnected: boolean;
  serverError: string | null;
  logs: RojoLogEntry[];
  emitter: EventEmitter;
}

let runtime: RojoRuntime | null = null;

async function killExisting(): Promise<void> {
  const current = runtime;
  if (!current) return;

  // Detach runtime state immediately so callers can't see a half-dead process.
  runtime = null;

  const child = current.child;
  const emittedExit = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
      resolve();
      return;
    }
    // May already be dead; try the pid first to avoid missing the 'exit' window.
    if (child.pid) {
      try {
        process.kill(child.pid, 0);
      } catch {
        resolve();
        return;
      }
    }
    const onExit = () => {
      clearTimeout(forceKill);
      resolve();
    };
    child.once("exit", onExit);
    // Safety net: resolve anyway if we never get an 'exit' event.
    const forceKill = setTimeout(() => {
      child.off("exit", onExit);
      try {
        if (child.pid !== undefined) process.kill(child.pid, "SIGKILL");
      } catch {
        // ignore
      }
      resolve();
    }, KILL_GRACE_MS);
  });

  try {
    if (child.pid !== undefined && child.exitCode === null) {
      child.kill("SIGTERM");
    }
  } catch {
    // ignore
  }

  await emittedExit;
  current.emitter.removeAllListeners();
}

/**
 * Race a kill operation against a hard timeout. Never rejects: kill errors
 * are swallowed and a hung kill is cut off by the timeout, so shutdown flows
 * can safely await it without hanging. Exported for testability.
 */
export function boundedKill(
  kill: () => Promise<void>,
  timeoutMs: number = CLEANUP_TIMEOUT_MS,
): Promise<void> {
  const work = kill().then(
    () => undefined,
    () => undefined,
  );
  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([work, timeout]);
}

/**
 * Call on app quit to ensure no orphaned rojo processes. Returns a promise
 * that resolves when the kill completes OR when the internal timeout fires;
 * it never rejects, so quit flows can safely await it without hanging.
 */
export function cleanupRojo(): Promise<void> {
  return boundedKill(() => killExisting(), CLEANUP_TIMEOUT_MS);
}

const PROJECT_SOURCE_DIRS = SESSION_PROJECT_SOURCE_DIRS;

async function ensureProjectJson(workspace: string, overwrite: boolean): Promise<void> {
  const projectFile = join(workspace, "default.project.json");
  const writeProject = async () => {
    // The project tree references src/, server/ and client/ via $path. Rojo 7.x
    // refuses to serve when a $path directory is missing, so create them first.
    // Sessions start from an empty tree this way and can never inherit scripts
    // from an earlier place/session.
    for (const dir of PROJECT_SOURCE_DIRS) {
      await mkdir(join(workspace, dir), { recursive: true });
    }
    await writeFile(projectFile, JSON.stringify(SESSION_PROJECT_JSON, null, 2), "utf8");
  };
  if (overwrite) {
    // Always regenerate so a session can never inherit legacy tree references
    // (old scripts like ForceR6 / CombatAnimations) from a previous place.
    await mkdir(workspace, { recursive: true });
    await writeProject();
    return;
  }
  try {
    await access(projectFile);
  } catch {
    // File doesn't exist — create it with a standard Roblox project structure.
    // Ensure the workspace directory exists first.
    await mkdir(workspace, { recursive: true });
    await writeProject();
  }
}

function buildManager(options: RojoServerManagerOptions): RojoServerManager {
  function pushLog(stream: "stdout" | "stderr", data: Buffer): void {
    if (!runtime) return;
    const message = data.toString().trimEnd();
    if (!message) return;
    const entry: RojoLogEntry = { timestamp: Date.now(), stream, message };
    runtime.logs.push(entry);
    if (runtime.logs.length > MAX_LOG_ENTRIES) runtime.logs.shift();
    runtime.emitter.emit("log", entry);
  }

  function detectPort(output: string): number | null {
    const clean = stripAnsi(output);
    const match = clean.match(ROJO_PORT_REGEX);
    if (match?.[1]) {
      const port = Number.parseInt(match[1], 10);
      if (Number.isInteger(port) && port > 0 && port < 65_536) return port;
    }
    return null;
  }

  /**
   * Refresh client-connected state from the OS TCP table. Called on every
   * `status()` poll so the UI indicator reflects reality without depending
   * on log parsing.
   */
  const refreshClientState = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const current = runtime;
      if (!current || current.child.exitCode !== null) return;
      const connected = yield* Effect.tryPromise(() =>
        hasClientOnPort(current.port ?? DEFAULT_ROJO_PORT),
      ).pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (runtime && runtime === current) {
        runtime.clientConnected = connected;
      }
    });

  const spawnServer = (params: {
    workspace: string;
    port: number;
    overwriteProject: boolean;
  }): Effect.Effect<RojoStatus, RojoError> =>
    Effect.gen(function* () {
      const { workspace, port, overwriteProject } = params;
      // Gracefully stop any existing process and wait for the port to be
      // released before binding a new one. This prevents "Address already in use".
      if (runtime) {
        yield* Effect.promise(() => killExisting());
        // Give the OS a small window to release the listening socket.
        yield* Effect.sleep("300 millis");
      }

      // Ensure default.project.json exists — rojo serve requires it. Sessions
      // overwrite it so a new session starts from a clean, isolated tree.
      yield* Effect.tryPromise({
        try: () => ensureProjectJson(workspace, overwriteProject),
        catch: (cause) =>
          new RojoError({ message: "Failed to create default.project.json", cause }),
      });

      // Prefer the locally downloaded binary (1-click setup) over PATH.
      // The installer writes rojo.exe into the app's userData/bin directory.
      const binary = process.platform === "win32" ? "rojo.exe" : "rojo";
      const localCandidate = join(options.binDirectory, binary);
      const resolvedBinary =
        (yield* Effect.promise(() =>
          access(localCandidate).then(
            () => localCandidate,
            () => null,
          ),
        )) ?? binary;

      // Bind explicitly to 127.0.0.1 (safe default). The project file is the
      // positional <PROJECT> argument (Rojo 7.x), so we pass it explicitly
      // rather than relying on the CWD.
      const serveArgs = [
        "serve",
        "--port",
        String(port),
        "--address",
        "127.0.0.1",
        "default.project.json",
      ];
      const child = spawn(resolvedBinary, serveArgs, {
        cwd: workspace,
        windowsHide: true,
        stdio: "pipe",
      });

      // Attach a permanent no-op 'error' listener IMMEDIATELY after spawn.
      // When the binary is missing (ENOENT), Node emits a child 'error' event;
      // if that event has no listener at fire time it becomes an uncaught
      // exception that crashes the app. This listener guarantees that can
      // never happen, regardless of any promise/timeout cleanup below.
      child.on("error", () => {});

      // Capture the actual spawn outcome (spawn error or success) via a
      // promise. It always RESOLVES — it never rejects — so the error is
      // surfaced as a graceful status instead of an exception.
      const spawnError = yield* Effect.tryPromise({
        try: () =>
          new Promise<Error | null>((resolve) => {
            const onError = (err: Error) => {
              child.off("error", onError);
              resolve(err);
            };
            const onSpawn = () => {
              child.off("error", onError);
              resolve(null);
            };
            child.once("error", onError);
            child.once("spawn", onSpawn);
          }),
        catch: (cause) => new RojoError({ message: "Failed to spawn rojo", cause }),
      });

      if (spawnError) {
        return {
          active: false,
          port: null,
          error: spawnError.message.includes("ENOENT")
            ? "Rojo CLI not found on PATH. Install it with `cargo install rojo` or download from GitHub."
            : spawnError.message,
          workspace: null,
          clientConnected: false,
        };
      }

      const emitter = new EventEmitter();
      emitter.setMaxListeners(50);

      runtime = {
        child,
        workspace,
        port,
        clientConnected: false,
        serverError: null,
        logs: [],
        emitter,
      };

      // ── Startup handshake ─────────────────────────────────────────────
      // Wait for Rojo to signal it is listening before reporting `active:
      // true`. If it fails, surfaces a precise error instead of a false
      // positive that confuses the UI and leaves Roblox Studio disconnected.
      const startupOutcome = yield* Effect.tryPromise({
        try: () =>
          new Promise<{ ok: true; port: number } | { ok: false; reason: string }>((resolve) => {
            let pending = true;
            let errorText = "";

            const timer = setTimeout(() => {
              if (!pending) return;
              pending = false;
              cleanup();
              resolve({
                ok: false,
                reason:
                  errorText ||
                  `Rojo did not start within ${STARTUP_TIMEOUT_MS / 1000}s — check the log for errors.`,
              });
            }, STARTUP_TIMEOUT_MS);

            const onStdout = (data: Buffer) => {
              if (!pending) return;
              const text = data.toString();
              const clean = stripAnsi(text);
              pushLog("stdout", data);
              if (ROJO_LISTENING_REGEX.test(clean)) {
                pending = false;
                cleanup();
                const port = detectPort(text) ?? params.port;
                if (runtime) {
                  runtime.port = port;
                  runtime.serverError = null;
                }
                resolve({ ok: true, port });
                return;
              }
              if (errorText === "" && ROJO_ERROR_REGEX.test(clean)) {
                errorText = clean.trim();
              }
            };

            const onStderr = (data: Buffer) => {
              if (!pending) return;
              const text = data.toString();
              const clean = stripAnsi(text);
              pushLog("stderr", data);
              if (!errorText && ROJO_ERROR_REGEX.test(clean)) {
                errorText = clean.trim();
              }
            };

            const onExit = (code: number | null) => {
              if (!pending) return;
              pending = false;
              cleanup();
              resolve({
                ok: false,
                reason: errorText || `Rojo exited with code ${code} before listening.`,
              });
            };

            function cleanup() {
              clearTimeout(timer);
              child.stdout.off("data", onStdout);
              child.stderr.off("data", onStderr);
              child.off("exit", onExit);
            }

            child.stdout.on("data", onStdout);
            child.stderr.on("data", onStderr);
            child.on("exit", onExit);
          }),
        catch: (cause) => new RojoError({ message: "Failed to await Rojo startup", cause }),
      });

      if (!startupOutcome.ok) {
        // Kill the child so we don't leave an orphan process behind.
        yield* Effect.promise(() => killExisting());
        return {
          active: false,
          port: null,
          error: startupOutcome.reason,
          workspace,
          clientConnected: false,
        };
      }

      // Now attach the full-time stream handlers for continuous logging.
      child.stdout.on("data", (data: Buffer) => {
        pushLog("stdout", data);
        const clean = stripAnsi(data.toString());
        if (ROJO_CLIENT_CONNECTED_REGEX.test(clean) && runtime) runtime.clientConnected = true;
        if (ROJO_CLIENT_DISCONNECTED_REGEX.test(clean) && runtime) runtime.clientConnected = false;
      });
      child.stderr.on("data", (data: Buffer) => {
        pushLog("stderr", data);
        const clean = stripAnsi(data.toString());
        if (ROJO_ERROR_REGEX.test(clean) && runtime) {
          runtime.serverError = clean.trim();
        }
      });

      yield* Effect.logInfo(
        `[rojo] serve started on port ${startupOutcome.port} (workspace: ${workspace})`,
      );

      return {
        active: true,
        port: startupOutcome.port,
        error: null,
        workspace,
        clientConnected: false,
      };
    });

  const start = (workspace: string): Effect.Effect<RojoStatus, RojoError> =>
    spawnServer({ workspace, port: DEFAULT_ROJO_PORT, overwriteProject: false });

  const startForSession = (sessionId: string): Effect.Effect<RojoStatus, RojoError> =>
    Effect.gen(function* () {
      if (!options.sessionWorkspaceDir) {
        return yield* Effect.fail(
          new RojoError({ message: "Per-session Rojo isolation is not configured" }),
        );
      }
      // Serve the session's isolated workspace on the default port. The Rojo
      // Studio plugin only connects to the host:port in its settings (34872),
      // so a per-session port would leave Studio permanently unable to find
      // the server. Isolation comes from the workspace, not the port: each
      // switch kills the previous server and serves a freshly generated,
      // empty project so nothing leaks from an earlier session.
      const workspace = options.sessionWorkspaceDir(sessionId);
      return yield* spawnServer({ workspace, port: DEFAULT_ROJO_PORT, overwriteProject: true });
    });

  const toggle = (workspace: string): Effect.Effect<RojoStatus, RojoError> =>
    Effect.gen(function* () {
      if (runtime && runtime.child.exitCode === null) {
        yield* Effect.promise(() => killExisting());
        yield* Effect.logInfo("[rojo] toggled off");
        return {
          active: false,
          port: null,
          error: null,
          workspace: null,
          clientConnected: false,
        };
      }
      return yield* start(workspace);
    });

  const toggleForSession = (sessionId: string): Effect.Effect<RojoStatus, RojoError> =>
    Effect.gen(function* () {
      if (runtime && runtime.child.exitCode === null) {
        yield* Effect.promise(() => killExisting());
        yield* Effect.logInfo("[rojo] toggled off");
        return {
          active: false,
          port: null,
          error: null,
          workspace: null,
          clientConnected: false,
        };
      }
      return yield* startForSession(sessionId);
    });

  return {
    start,
    startForSession,
    stop: () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => killExisting());
        yield* Effect.logInfo("[rojo] serve stopped");
      }),
    status: () =>
      Effect.gen(function* () {
        if (!runtime || runtime.child.exitCode !== null) {
          const error = runtime?.serverError ?? null;
          return { active: false, port: null, error, workspace: null, clientConnected: false };
        }
        // Refresh connection state from the TCP table so the indicator is
        // accurate even if Rojo's own log line was missed.
        yield* refreshClientState();
        return {
          active: true,
          port: runtime.port,
          error: runtime.serverError,
          workspace: runtime.workspace,
          clientConnected: runtime.clientConnected,
        };
      }),
    toggle,
    toggleForSession,
    getLogs: () => Effect.sync(() => (runtime ? [...runtime.logs] : [])),
    onLog: (listener: (entry: RojoLogEntry) => void) => {
      if (!runtime) return () => {};
      runtime.emitter.on("log", listener);
      return () => runtime?.emitter.off("log", listener);
    },
  };
}

export function makeRojoServerManagerLayer(options: RojoServerManagerOptions) {
  return Layer.sync(RojoServerManagerTag, () => buildManager(options));
}
