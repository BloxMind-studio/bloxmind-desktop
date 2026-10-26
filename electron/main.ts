import { rename, readFile, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { Cause, Data, Effect, Layer, ManagedRuntime, Schema } from "effect";

import {
  type AppConfig,
  AppConfigPatchSchema,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  type OpenCodeStartupProgress,
} from "../src/types/desktop";
import { ExplorerProgramEnvelopeSchema, ExplorerSnapshotSchema } from "../src/lib/explorer";
import { ProjectIndexProgramEnvelopeSchema, ProjectSkeletonSchema } from "../src/lib/projectIndex";
import { GeneratedProgramArtifactSchema } from "../src/types/generatedProgram";
import {
  StudioTargetDiscoverySchema,
  StudioTargetProgramEnvelopesSchema,
  StudioTargetProgramsSchema,
  StudioTargetSelectionSchema,
} from "../src/types/studioTarget";
import { handleLastWindowClosed } from "./appLifecycle";
import { createMainErrorReporter } from "./errorReporter";
import { findInstructionFiles, stripLegacyManagedBlock } from "./instructionFiles";
import { skillDirectories } from "./opencodeConfig";
import { channels } from "./channels";
import { makeOpenCodeLayer, OpenCode } from "./services/OpenCode";
import {
  GeneratedProgramRuntime,
  GeneratedProgramRuntimeLive,
} from "./services/GeneratedProgramRuntime";
import { createBloxBotProgramStore } from "./services/BloxBotProgramStore";
import { makeStudioMcpBrokerLayer, StudioMcpBroker } from "./services/StudioMcpBroker";
import {
  CheckpointServiceTag,
  makeCheckpointServiceLayer,
} from "./services/CheckpointService";
import { sweepStaleProcesses, type SweepReport } from "./services/staleProcessSweep";
import {
  CaptureContextSchema,
  CheckpointRestoreInputSchema,
  CheckpointRestoreResultSchema,
  CheckpointSchema,
  RestorePreviewSchema,
  ValidationResultSchema,
} from "../src/types/checkpoints";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const defaultConfig: AppConfig = DEFAULT_APP_CONFIG;
const configMutex = Effect.unsafeMakeSemaphore(1);

/**
 * The only document the app window may show. Origins are not enough: packaged
 * builds load over `file://`, where every local path shares the origin "null",
 * so an origin check would let the window navigate to any HTML file on disk —
 * with the preload bridge attached. Compare the resolved URL exactly.
 */
const appEntryUrl = process.env.VITE_DEV_SERVER_URL
  ? new URL(process.env.VITE_DEV_SERVER_URL).href
  : pathToFileURL(join(currentDirectory, "..", "..", "dist", "index.html")).href;

function isAppEntryUrl(candidate: string): boolean {
  try {
    return new URL(candidate).href === appEntryUrl;
  } catch {
    return false;
  }
}

function configPath(): string {
  return join(app.getPath("userData"), "BloxMind-store.json");
}

let mainWindow: BrowserWindow | null = null;
let quitting = false;
/** True once the boot sequence has created the main window. */
let booted = false;
/** Non-null while quit-time cleanup is running; guards against reentrancy. */
let shutdownInFlight: Promise<void> | null = null;

/** Hard upper bound on OpenCode runtime disposal during quit. */
const OPENCODE_DISPOSE_TIMEOUT_MS = 5_000;

function currentUsername(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

const mainErrorReporter = createMainErrorReporter({
  channel: channels.mainError,
  home: app.getPath("home"),
  username: currentUsername(),
});

/** Sends a main-process error to the renderer, which reports it if analytics is on. */
function reportMainError(source: string, error: unknown): void {
  mainErrorReporter.report(source, error);
}

// A monitor observes without replacing Electron's own uncaught-exception handling.
process.on("uncaughtExceptionMonitor", (error) => reportMainError("main_uncaught_exception", error));
// Electron only warns about unhandled rejections; keep that log line and report it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection in the main process:", reason);
  reportMainError("main_unhandled_rejection", reason);
});

const reportLayerFailure = (source: string) => (cause: Cause.Cause<unknown>) =>
  Effect.sync(() => {
    if (!Cause.isInterruptedOnly(cause)) reportMainError(source, Cause.squash(cause));
  });

class DesktopMainError extends Data.TaggedError("DesktopMainError")<{
  message: string;
  cause?: unknown;
}> {}

const studioMcpBrokerLayer = makeStudioMcpBrokerLayer({
  workspace: join(app.getPath("home"), "BloxMind"),
  localAppData: process.env.LOCALAPPDATA,
  comSpec: process.env.ComSpec,
  systemRoot: process.env.SystemRoot,
  // Reported once per launch, after the startup retries, and not when Studio isn't installed.
  onStartFailure: (error) => reportMainError("studio_mcp_broker_start", error),
}).pipe(Layer.tapErrorCause(reportLayerFailure("studio_mcp_broker_start")));

const openCodeBinaryDirectory = join(app.getPath("userData"), "opencode");

const openCodeRuntime = ManagedRuntime.make(
  Layer.merge(
    Layer.merge(
      makeOpenCodeLayer({
        binaryCacheDirectory: openCodeBinaryDirectory,
        // The bundled Roblox skill sits next to the app's resources once
        // packaged, and in the repository during development.
        skillsPaths: skillDirectories({
          appPath: app.getAppPath(),
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
        }),
        // Read lazily at engine start so a server added in Settings while the
        // app runs is picked up on the next restart (live changes go through
        // the engine's config API instead).
        mcpServers: () => loadConfig.pipe(Effect.map((config) => config.mcpServers)),
        workspace: join(app.getPath("home"), "BloxMind"),
        onStartupProgress: (progress: OpenCodeStartupProgress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channels.openCodeStartupProgress, progress);
          }
        },
      }).pipe(Layer.tapErrorCause(reportLayerFailure("opencode_start"))),
      makeCheckpointServiceLayer({
        storeRoot: join(app.getPath("userData"), "checkpoints"),
        workspace: join(app.getPath("home"), "BloxMind"),
      }),
    ),
    GeneratedProgramRuntimeLive.pipe(Layer.provide(studioMcpBrokerLayer)),
  ).pipe(Layer.provideMerge(studioMcpBrokerLayer)),
);

// Published BloxBot programs: downloaded, signature-checked and cached here so a
// Roblox Studio MCP change can be fixed without an app release.
const BLOXBOT_PROGRAMS_REFRESH_MS = 6 * 60 * 60 * 1000;
const bloxbotProgramStore = createBloxBotProgramStore({
  directory: join(app.getPath("userData"), "bloxbot-programs"),
  log: (message) => console.log(message),
  onError: (error) => reportMainError("bloxbot_programs_refresh", error),
});

const expectedContract = (name: string) => ({
  name,
  version: "1",
  inputSchemaVersion: "1",
  outputSchemaVersion: "1",
});

function requireContract(contract: { name: string; version: string; inputSchemaVersion: string; outputSchemaVersion: string }, name: string) {
  const expected = expectedContract(name);
  if (JSON.stringify(contract) !== JSON.stringify(expected)) {
    return Effect.fail(new DesktopMainError({ message: `Generated program contract ${name} is invalid` }));
  }
  return Effect.void;
}

function isMissingFile(cause: unknown): boolean {
  return (
    cause !== null &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "ENOENT"
  );
}

function parseExternalUrl(rawUrl: string) {
  return Effect.try({
    try: () => new URL(rawUrl),
    catch: (cause) =>
      new DesktopMainError({ message: "Only HTTP and HTTPS links can be opened", cause }),
  }).pipe(
    Effect.flatMap((url) =>
      url.protocol === "https:" || url.protocol === "http:"
        ? Effect.succeed(url)
        : Effect.fail(
            new DesktopMainError({ message: "Only HTTP and HTTPS links can be opened" }),
          ),
    ),
  );
}

const loadConfig = Effect.gen(function* () {
  const contents = yield* Effect.tryPromise({
    try: () => readFile(configPath(), "utf8"),
    catch: (cause) => new DesktopMainError({ message: "Failed to read app configuration", cause }),
  }).pipe(
    Effect.catchAll((error) =>
      isMissingFile(error.cause) ? Effect.succeed(null) : Effect.fail(error),
    ),
  );
  if (contents === null) return defaultConfig;

  return yield* Effect.gen(function* () {
    const stored = yield* Effect.try({
      try: () => JSON.parse(contents) as unknown,
      catch: (cause) => new DesktopMainError({ message: "App configuration is invalid", cause }),
    });
    const candidate =
      stored !== null && typeof stored === "object" ? { ...defaultConfig, ...stored } : defaultConfig;
    // Old builds persisted the (then non-functional) Max Tokens default of
    // 4096. Map it to the new "model's own limit" sentinel so upgrading never
    // silently caps replies.
    if (candidate.maxTokens === 4_096) candidate.maxTokens = 0;
    return yield* Schema.decodeUnknown(AppConfigSchema)(candidate).pipe(
      Effect.mapError(
        (cause) => new DesktopMainError({ message: "App configuration is invalid", cause }),
      ),
    );
  }).pipe(
    Effect.tapError((error) => Effect.logWarning(error.message, error.cause)),
    Effect.catchAll(() => Effect.succeed(defaultConfig)),
  );
});

function patchConfig(input: unknown) {
  return Effect.gen(function* () {
    const patch = yield* Schema.decodeUnknown(AppConfigPatchSchema)(input).pipe(
      Effect.mapError(
        (cause) => new DesktopMainError({ message: "App configuration patch is invalid", cause }),
      ),
    );
    const current = yield* loadConfig;
    const next = { ...current, ...patch };
    yield* Effect.tryPromise({
      try: async () => {
        const destination = configPath();
        const temporary = `${destination}.${process.pid}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
          await rename(temporary, destination);
        } catch (cause) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw cause;
        }
      },
      catch: (cause) =>
        new DesktopMainError({ message: "Failed to write app configuration", cause }),
    });
  }).pipe(configMutex.withPermits(1));
}

const runMain = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/**
 * Best-effort sweep of stale opencode processes left behind by a
 * crashed or force-killed session. Must never fail startup — any error is
 * logged and swallowed.
 */
const sweepStaleProcessesEffect = Effect.tryPromise(() => sweepStaleProcesses()).pipe(
  Effect.tap((report: SweepReport) =>
    report.skipped
      ? Effect.logDebug("[startup-sweep] skipped (non-Windows platform)")
      : Effect.logInfo(
          `[startup-sweep] stale processes killed=${report.killed.length} failed=${report.failed.length}` +
            ` skippedLiveParent=${report.skippedLiveParent}` +
            (report.fallback ? " (name-based fallback: parent discovery failed)" : "") +
            (report.killed.length > 0
              ? ` (${report.killed.map((entry) => `${entry.image}#${entry.pid}`).join(", ")})`
              : ""),
        ),
  ),
  Effect.catchAll((cause) =>
    Effect.logWarning(`[startup-sweep] sweep failed; continuing startup: ${String(cause)}`),
  ),
);

/**
 * Dispose the OpenCode runtime with a hard timeout so quit can never hang
 * (e.g. on stuck MCP sessions). The timer is unref'd so it does not keep
 * the process alive once disposal wins the race.
 */
const disposeOpenCodeRuntimeBounded = Effect.tryPromise({
  try: () =>
    Promise.race([
      openCodeRuntime.dispose().then(() => "disposed" as const),
      new Promise<"timeout">((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), OPENCODE_DISPOSE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]),
  catch: (cause) =>
    new DesktopMainError({ message: "Failed to stop the OpenCode runtime", cause }),
}).pipe(
  Effect.flatMap((result) =>
    result === "timeout"
      ? Effect.logWarning(
          `[shutdown] OpenCode runtime dispose timed out after ${OPENCODE_DISPOSE_TIMEOUT_MS}ms; quitting anyway`,
        )
      : Effect.void,
  ),
  Effect.catchAll(Effect.logError),
);

const registerIpcHandlers = Effect.sync(() => {
  ipcMain.on(channels.mainErrorReady, (event) => mainErrorReporter.attach(event.sender));
  ipcMain.handle(channels.compileExplorerProgram, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const program = yield* Schema.decodeUnknown(ExplorerProgramEnvelopeSchema)(input);
        const runtime = yield* GeneratedProgramRuntime;
        return yield* runtime.compile(program);
      }),
    ),
  );
  ipcMain.handle(channels.listExplorerProgramTools, () =>
    openCodeRuntime.runPromise(
      GeneratedProgramRuntime.pipe(
        Effect.flatMap((runtime) => runtime.allowedTools("explorer-snapshot")),
      ),
    ),
  );
  ipcMain.handle(channels.getOpenCodeInfo, () =>
    openCodeRuntime.runPromise(
      OpenCode.pipe(Effect.flatMap((service) => service.info)),
    ),
  );
  ipcMain.handle(channels.getOpenCodeInstallFolder, () => openCodeBinaryDirectory);
  ipcMain.handle(channels.getStudioMcpStatus, () =>
    openCodeRuntime.runPromise(StudioMcpBroker.pipe(Effect.flatMap((broker) => broker.status))),
  );
  ipcMain.handle(channels.getVersion, () => runMain(Effect.sync(() => app.getVersion())));
  ipcMain.handle(channels.getInstructionFiles, () =>
    findInstructionFiles({
      workspace: join(app.getPath("home"), "BloxMind"),
      // OpenCode runs with XDG_CONFIG_HOME inside the workspace (see services/OpenCode.ts).
      globalConfigDirectory: join(
        app.getPath("home"),
        "BloxMind",
        ".opencode",
        "config",
        "opencode",
      ),
      home: app.getPath("home"),
    }),
  );
  ipcMain.handle(channels.getBloxBotPrograms, () => bloxbotProgramStore.current());
  ipcMain.handle(channels.loadConfig, () => runMain(loadConfig));
  ipcMain.handle(channels.patchConfig, (_event, patch: unknown) => runMain(patchConfig(patch)));
  ipcMain.handle(channels.installStudioTargetPrograms, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const envelopes = yield* Schema.decodeUnknown(StudioTargetProgramEnvelopesSchema)(input);
        yield* requireContract(envelopes.discovery.contract, "studio-target-discovery");
        yield* requireContract(envelopes.selection.contract, "studio-target-selection");
        const runtime = yield* GeneratedProgramRuntime;
        const [discoveryArtifact, selectionArtifact] = yield* Effect.all([
          runtime.compile(envelopes.discovery),
          runtime.compile(envelopes.selection),
        ], { concurrency: "unbounded" });
        return yield* Schema.decodeUnknown(StudioTargetProgramsSchema)({
          discovery: { envelope: envelopes.discovery, artifact: discoveryArtifact },
          selection: { envelope: envelopes.selection, artifact: selectionArtifact },
        });
      }),
    ),
  );
  ipcMain.handle(channels.discoverStudioTargets, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        yield* Effect.logInfo("[studio-target] discovery requested");
        const programs = yield* Schema.decodeUnknown(StudioTargetProgramsSchema)(input);
        yield* requireContract(programs.discovery.artifact.contract, "studio-target-discovery");
        const runtime = yield* GeneratedProgramRuntime;
        const result = yield* runtime.invoke({ artifact: programs.discovery.artifact, input: {} });
        const discovery = yield* Schema.decodeUnknown(StudioTargetDiscoverySchema)(result.value);
        yield* Effect.logInfo(
          `[studio-target] discovery completed targets=${discovery.targets.length} selected=${discovery.selectedKey !== null}`,
        );
        return discovery;
      }),
    ),
  );
  ipcMain.handle(channels.selectStudioTarget, (_event, input: unknown, targetKey: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const programs = yield* Schema.decodeUnknown(StudioTargetProgramsSchema)(input);
        const key = yield* Schema.decodeUnknown(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)))(targetKey);
        yield* requireContract(programs.selection.artifact.contract, "studio-target-selection");
        const runtime = yield* GeneratedProgramRuntime;
        const result = yield* runtime.invoke({ artifact: programs.selection.artifact, input: { targetKey: key } });
        return yield* Schema.decodeUnknown(StudioTargetSelectionSchema)(result.value);
      }),
    ),
  );
  ipcMain.handle(channels.openUrl, (_event, rawUrl: string) =>
    runMain(
      parseExternalUrl(rawUrl).pipe(
        Effect.flatMap((url) =>
          Effect.tryPromise({
            try: () => shell.openExternal(url.href),
            catch: (cause) => new DesktopMainError({ message: "Failed to open URL", cause }),
          }),
        ),
      ),
    ),
  );
  ipcMain.handle(channels.checkForUpdate, () =>
    runMain(
      Effect.gen(function* () {
        if (!app.isPackaged) return null;
        const result = yield* Effect.tryPromise({
          try: () => autoUpdater.checkForUpdates(),
          catch: (cause) =>
            new DesktopMainError({ message: "Failed to check for updates", cause }),
        });
        if (!result) return null;
        const body =
          typeof result.updateInfo.releaseNotes === "string" ? result.updateInfo.releaseNotes : null;
        return { version: result.updateInfo.version, body };
      }),
    ),
  );
  ipcMain.handle(channels.installUpdate, () =>
    runMain(
      Effect.gen(function* () {
        if (!app.isPackaged) {
          return yield* Effect.fail(
            new DesktopMainError({ message: "Updates are only available in packaged builds" }),
          );
        }
        const downloaded = yield* Effect.tryPromise({
          try: () => autoUpdater.downloadUpdate(),
          catch: (cause) =>
            new DesktopMainError({ message: "Failed to download the update", cause }),
        });
        if (!downloaded || downloaded.length === 0) {
          return yield* Effect.fail(
            new DesktopMainError({ message: "Update download did not produce any files" }),
          );
        }
        yield* Effect.sync(() => autoUpdater.quitAndInstall());
      }),
    ),
  );
  ipcMain.handle(
    channels.invokeExplorerProgram,
    (_event, input: unknown, studioIdInput: unknown) =>
      openCodeRuntime.runPromise(
        Effect.gen(function* () {
          const artifact = yield* Schema.decodeUnknown(GeneratedProgramArtifactSchema)(input);
          const studioId = yield* Schema.decodeUnknown(
            Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
          )(studioIdInput);
          if (
            artifact.contract.name !== "explorer-snapshot" ||
            artifact.contract.outputSchemaVersion !== "explorer-snapshot-v1"
          ) {
            return yield* Effect.fail(
              new DesktopMainError({ message: "Explorer program contract is invalid" }),
            );
          }
          const runtime = yield* GeneratedProgramRuntime;
          const result = yield* runtime.invoke({ artifact, input: { studioId } });
          return yield* Schema.decodeUnknown(ExplorerSnapshotSchema)(result.value).pipe(
            Effect.mapError(
              (cause) =>
                new DesktopMainError({
                  // The schema's own complaint, so a model-written program can be fixed.
                  message: `Explorer output is invalid: ${cause.message.slice(0, 600)}`,
                  cause,
                }),
            ),
          );
        }).pipe(
          Effect.tapErrorCause((cause) =>
            Effect.logError(`[explorer] invocation failed: ${String(cause)}`),
          ),
        ),
      ),
  );
  ipcMain.handle(channels.compileProjectIndexProgram, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const program = yield* Schema.decodeUnknown(ProjectIndexProgramEnvelopeSchema)(input);
        const runtime = yield* GeneratedProgramRuntime;
        return yield* runtime.compile(program);
      }),
    ),
  );
  ipcMain.handle(channels.invokeProjectIndexProgram, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const artifact = yield* Schema.decodeUnknown(GeneratedProgramArtifactSchema)(input);
        if (
          artifact.contract.name !== "project-index" ||
          artifact.contract.outputSchemaVersion !== "project-index-skeleton-v1"
        ) {
          return yield* Effect.fail(
            new DesktopMainError({ message: "Project index program contract is invalid" }),
          );
        }
        const runtime = yield* GeneratedProgramRuntime;
        const result = yield* runtime.invoke({ artifact, input: null });
        return yield* Schema.decodeUnknown(ProjectSkeletonSchema)(result.value).pipe(
          Effect.mapError(
            (cause) => new DesktopMainError({ message: "Project index output is invalid", cause }),
          ),
        );
      }).pipe(
        Effect.tapErrorCause((cause) =>
          Effect.logError(`[project-index] invocation failed: ${String(cause)}`),
        ),
      ),
    ),
  );
  ipcMain.handle(channels.relaunch, () =>
    runMain(
      Effect.sync(() => {
        app.relaunch();
        app.quit();
      }),
    ),
  );
  // ── Checkpoint system ──────────────────────────────────────────────
  // Checkpoint IPC arguments cross a trust boundary; validate them before
  // they reach the service (which additionally sanitizes them into paths).
  const SessionIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));
  const CheckpointIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));
  ipcMain.handle(channels.checkpointCapture, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const context = yield* Schema.decodeUnknown(CaptureContextSchema)(input);
        const service = yield* CheckpointServiceTag;
        return yield* service.capture(context).pipe(
          Effect.flatMap((checkpoint) =>
            Schema.decodeUnknown(CheckpointSchema)(checkpoint).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopMainError({ message: "Checkpoint capture output is invalid", cause }),
              ),
            ),
          ),
        );
      }),
    ),
  );
  ipcMain.handle(channels.checkpointRestore, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const restoreInput = yield* Schema.decodeUnknown(CheckpointRestoreInputSchema)(input);
        const service = yield* CheckpointServiceTag;
        return yield* service.restore(restoreInput).pipe(
          Effect.flatMap((result) =>
            Schema.decodeUnknown(CheckpointRestoreResultSchema)(result).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopMainError({ message: "Checkpoint restore output is invalid", cause }),
              ),
            ),
          ),
        );
      }),
    ),
  );
  ipcMain.handle(channels.checkpointPreview, (_event, checkpointId: unknown, sessionId: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const id = yield* Schema.decodeUnknown(CheckpointIdSchema)(checkpointId);
        const sid = yield* Schema.decodeUnknown(SessionIdSchema)(sessionId);
        const service = yield* CheckpointServiceTag;
        return yield* service.preview(id, sid).pipe(
          Effect.flatMap((preview) =>
            Schema.decodeUnknown(RestorePreviewSchema)(preview).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopMainError({ message: "Checkpoint preview output is invalid", cause }),
              ),
            ),
          ),
        );
      }),
    ),
  );
  ipcMain.handle(channels.checkpointList, (_event, sessionId: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const sid = yield* Schema.decodeUnknown(SessionIdSchema)(sessionId);
        const service = yield* CheckpointServiceTag;
        const history = yield* service.list(sid);
        return yield* Schema.decodeUnknown(Schema.Array(CheckpointSchema))(history).pipe(
          Effect.mapError(
            (cause) => new DesktopMainError({ message: "Checkpoint list output is invalid", cause }),
          ),
        );
      }),
    ),
  );
  ipcMain.handle(channels.checkpointValidate, () =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* CheckpointServiceTag;
        return yield* service.validate().pipe(
          Effect.flatMap((result) =>
            Schema.decodeUnknown(ValidationResultSchema)(result).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopMainError({ message: "Checkpoint validation output is invalid", cause }),
              ),
            ),
          ),
        );
      }),
    ),
  );
});

function createWindow(): Effect.Effect<void, DesktopMainError> {
  return Effect.gen(function* () {
    const window = yield* Effect.try({
      try: () =>
        new BrowserWindow({
          title: "BloxMind",
          width: 920,
          height: 600,
          minWidth: 520,
          minHeight: 400,
          backgroundColor: "#ffffff",
          titleBarStyle: "hiddenInset",
          show: false,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(currentDirectory, "..", "preload", "preload.mjs"),
            sandbox: true,
          },
        }),
      catch: (cause) => new DesktopMainError({ message: "Failed to create app window", cause }),
    });

    yield* Effect.sync(() => {
      mainWindow = window;
      window.webContents.setUserAgent(
        `${window.webContents.getUserAgent()} BloxMind/${app.getVersion()}`,
      );
      window.webContents.setWindowOpenHandler(({ url }) => {
        Effect.runFork(
          parseExternalUrl(url).pipe(
            Effect.flatMap((externalUrl) =>
              Effect.tryPromise({
                try: () => shell.openExternal(externalUrl.href),
                catch: (cause) =>
                  new DesktopMainError({ message: "Failed to open URL", cause }),
              }),
            ),
            Effect.catchAll(Effect.logWarning),
          ),
        );
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (!isAppEntryUrl(url)) event.preventDefault();
      });
      window.webContents.on("will-redirect", (event, url) => {
        if (!isAppEntryUrl(url)) event.preventDefault();
      });
      window.once("ready-to-show", () => Effect.runSync(Effect.sync(() => window.show())));
      window.on("closed", () =>
        Effect.runSync(
          Effect.sync(() => {
            if (mainWindow === window) mainWindow = null;
          }),
        ),
      );
    });

    yield* Effect.tryPromise({
      try: () =>
        process.env.VITE_DEV_SERVER_URL
          ? window.loadURL(process.env.VITE_DEV_SERVER_URL)
          : window.loadFile(join(currentDirectory, "..", "..", "dist", "index.html")),
      catch: (cause) => new DesktopMainError({ message: "Failed to load the app window", cause }),
    });
  });
}

const registerAppLifecycle = Effect.sync(() => {
  app.on("window-all-closed", () =>
    Effect.runSync(
      Effect.sync(() => {
        handleLastWindowClosed(process.platform, {
          hideDock: () => app.dock?.hide(),
          quit: () => app.quit(),
        });
      }),
    ),
  );

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    // A second quit trigger while cleanup is running must not fork another
    // parallel cleanup (which would double-dispose the OpenCode runtime).
    if (shutdownInFlight !== null) return;
    // Dispose the OpenCode runtime. Bounded so quit can never hang
    // indefinitely. Errors are logged, never thrown.
    shutdownInFlight = Effect.runPromise(
      disposeOpenCodeRuntimeBounded.pipe(Effect.catchAll(Effect.logError)),
    ).then(() => {
      quitting = true;
      app.quit();
    });
  });
});


// ── Single-instance lock ─────────────────────────────────────────────
// A second launch must not double background processes. If the lock is
// already held, quit immediately without starting any services.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  Effect.runSync(
    Effect.logWarning(
      "[single-instance] another BloxMind instance is already running; quitting",
    ),
  );
  // Give the user visible feedback on why nothing launched. showErrorBox is
  // safe to call before the app is ready.
  dialog.showErrorBox(
    "BloxMind is already running",
    "Another instance of BloxMind is already running. Switch to its window instead of launching a second copy.",
  );
  app.quit();
} else {
  app.on("second-instance", () => {
    // Ignore events before boot completes (window/IPC handlers not ready) or
    // while shutting down — the primary instance's own boot/quit already
    // satisfies the second launch's intent.
    if (!booted || quitting || shutdownInFlight !== null) return;
    // Focus/restore the existing window; create one if it was closed/hidden.
    const window = mainWindow;
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      if (!window.isVisible()) window.show();
      window.focus();
      return;
    }
    Effect.runFork(createWindow().pipe(Effect.catchAll(Effect.logError)));
  });

  Effect.runFork(
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
      });
      // Kill leftover opencode processes from a previous crashed or
      // force-killed session BEFORE spawning our own. Best-effort: failures
      // are logged and never block startup.
      yield* sweepStaleProcessesEffect;
      yield* registerAppLifecycle;
      yield* Effect.tryPromise({
        try: () => app.whenReady(),
        catch: (cause) => new DesktopMainError({ message: "Electron failed to become ready", cause }),
      });
      // Older builds wrote a managed conventions block (with retired Rojo
      // live-sync rules) into the workspace AGENTS.md. Strip any leftover
      // before OpenCode starts so it never reaches the model again.
      // Best-effort: a failed cleanup only means the stale block lingers.
      yield* Effect.promise(() =>
        stripLegacyManagedBlock(join(app.getPath("home"), "BloxMind")).catch(() => false),
      );
      // The cached copy is ready before the window asks for it; the download
      // happens in the background and applies from the next time a program loads.
      yield* Effect.promise(() => bloxbotProgramStore.load());
      yield* registerIpcHandlers;
      yield* Effect.sync(() => {
        // Tell the window when newer programs arrive, so they apply without a restart.
        const refresh = () =>
          void bloxbotProgramStore.refresh().then((result) => {
            if (result === "updated" && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(channels.bloxbotProgramsUpdated);
            }
          });
        refresh();
        setInterval(refresh, BLOXBOT_PROGRAMS_REFRESH_MS).unref();
      });
      yield* Effect.sync(() => Menu.setApplicationMenu(null));
      yield* createWindow();
      yield* Effect.sync(() => {
        booted = true;
      });
      yield* Effect.sync(() =>
        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            Effect.runFork(
              createWindow().pipe(
                Effect.tapError((error) =>
                  Effect.sync(() => reportMainError("main_create_window", error)),
                ),
                Effect.catchAll(Effect.logError),
              ),
            );
          }
        }),
      );
    }).pipe(
      Effect.tapError((error) => Effect.sync(() => reportMainError("main_startup", error))),
      Effect.catchAll(Effect.logError),
    ),
  );
}
