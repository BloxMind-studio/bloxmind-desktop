import { mkdir, rename, readFile, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  Notification,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { autoUpdater } from "electron-updater";
import { Cause, Data, Effect, Layer, ManagedRuntime, Schema } from "effect";

import {
  type AppConfig,
  AppConfigPatchSchema,
  AppConfigSchema,
  type BlenderSetupProgress,
  DEFAULT_APP_CONFIG,
  type ModelUploadResult,
  type OpenCodeStartupProgress,
  SystemNotificationSchema,
} from "../src/types/desktop";
import { migrateStoredConfig } from "../src/lib/configMigration";
import {
  ExplorerDetailsRequestSchema,
  ExplorerEditResultSchema,
  ExplorerEditSchema,
  ExplorerProgramEnvelopeSchema,
  ExplorerSnapshotSchema,
  ExplorerSyncRequestSchema,
} from "../src/lib/explorer";
import { ProjectIndexProgramEnvelopeSchema, ProjectSkeletonSchema } from "../src/lib/projectIndex";
import { GeneratedProgramArtifactSchema } from "../src/types/generatedProgram";
import {
  StudioTargetDiscoverySchema,
  StudioTargetProgramEnvelopesSchema,
  StudioTargetProgramsSchema,
  StudioTargetSelectionSchema,
} from "../src/types/studioTarget";
import { handleLastWindowClosed } from "./appLifecycle";
import { isOpenableUrl } from "./openableUrl";
import { networkDriveLetters, onNetworkDrive } from "./networkDrives";
import { createMainErrorReporter } from "./errorReporter";
import { blenderToolsFolder, engineFolder } from "./machineFolders";
import {
  blenderMcpServerConfig,
  getBlenderToolsState,
  installBlenderTools,
  isBlenderInstalled,
  openBlender,
  removeBlenderTools,
} from "./services/BlenderTools";
import {
  getUploadAccess,
  modelFolder,
  readModelFile,
  readSentModel,
  sendModelToPlace,
  sentModelsFile,
} from "./services/ModelUpload";
import {
  findInstructionFiles,
  migrateWorkspaceInstructionsToGlobalSync,
  readGlobalInstructions,
  stripLegacyManagedBlock,
  writeGlobalInstructions,
} from "./instructionFiles";
import { BLENDER_MCP_SERVER_NAME, skillDirectories, withBlender } from "./opencodeConfig";
import type { McpServerConfig } from "../src/lib/mcpServers";
import { editExplorerObject, type CallStudioTool, mcpData, mcpError } from "./studioQueries";
import { syncExplorerTree } from "./explorerTree";
import { channels } from "./channels";
import { createSystemNotifier, notificationSettingsUrl } from "./systemNotifications";
import { makeOpenCodeLayer, OpenCode } from "./services/OpenCode";
import {
  GeneratedProgramRuntime,
  GeneratedProgramRuntimeLive,
} from "./services/GeneratedProgramRuntime";
import { createBloxMindProgramStore } from "./services/BloxMindProgramStore";
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

/**
 * Every IPC handler goes through this gate: the app window is the only document
 * allowed to drive the main process. A navigation away from the entry URL (or a
 * second window that somehow got the preload) would otherwise reach handlers
 * that read/write the filesystem and the engine.
 */
function safeIpcHandle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppEntryUrl(event.senderFrame?.url ?? "")) {
      throw new Error(`Ignored IPC call to ${channel} from an unexpected sender`);
    }
    return listener(event, ...args);
  });
}

function configPath(): string {
  return join(app.getPath("userData"), "BloxMind-store.json");
}

let mainWindow: BrowserWindow | null = null;
let quitting = false;

const showSystemNotification = createSystemNotifier({
  isSupported: () => Notification.isSupported(),
  // BloxMind plays its own sound, if the user wants one.
  create: (content) => new Notification({ ...content, silent: true }),
  onClick: (id) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(channels.systemNotificationClicked, id);
  },
});
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

// OpenCode runs with XDG_CONFIG_HOME inside the workspace (see services/OpenCode.ts).
const globalConfigDirectory = join(
  app.getPath("home"),
  "BloxMind",
  ".opencode",
  "config",
  "opencode",
);

const studioMcpBrokerLayer = makeStudioMcpBrokerLayer({
  workspace: join(app.getPath("home"), "BloxMind"),
  localAppData: process.env.LOCALAPPDATA,
  comSpec: process.env.ComSpec,
  systemRoot: process.env.SystemRoot,
  // Reported once per launch, after the startup retries, and not when Studio isn't installed.
  onStartFailure: (error) => reportMainError("studio_mcp_broker_start", error),
}).pipe(Layer.tapErrorCause(reportLayerFailure("studio_mcp_broker_start")));

const machineFolderOptions = {
  platform: process.platform,
  userData: app.getPath("userData"),
  localAppData: process.env.LOCALAPPDATA,
};
const openCodeBinaryDirectory = engineFolder(machineFolderOptions);
const blenderToolsRoot = () => blenderToolsFolder(machineFolderOptions);

const blenderServerConfig = (): McpServerConfig => {
  const server = blenderMcpServerConfig(blenderToolsRoot());
  return {
    name: BLENDER_MCP_SERVER_NAME,
    type: "local",
    command: [...server.command],
    url: null,
    enabled: true,
    environment: server.environment,
  };
};

const openCodeRuntime = ManagedRuntime.make(
  Layer.merge(
    Layer.merge(
      makeOpenCodeLayer({
        binaryCacheDirectory: openCodeBinaryDirectory,
        // Chromium's network stack trusts the certificates installed on the system, which Node
        // doesn't when corporate or antivirus software intercepts HTTPS.
        fetchWithSystemCertificates: (url, init) => net.fetch(url, init),
        // The bundled Roblox skill sits next to the app's resources once
        // packaged, and in the repository during development.
        skillsPaths: skillDirectories({
          appPath: app.getAppPath(),
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
        }),
        // Read lazily at engine start so a server added in Settings while the
        // app runs is picked up on the next restart (live changes go through
        // the engine's config API instead). Blender is added here too, so it
        // survives an engine restart without depending on a live config patch.
        mcpServers: () =>
          Effect.gen(function* () {
            const config = yield* loadConfig;
            const installed = yield* Effect.promise(() => isBlenderInstalled(blenderToolsRoot()));
            return [
              ...config.mcpServers.filter((server) => server.name !== BLENDER_MCP_SERVER_NAME),
              ...(installed ? [blenderServerConfig()] : []),
            ];
          }),
        workspace: join(app.getPath("home"), "BloxMind"),
        onNetstatMiss: (message) => reportMainError("opencode_netstat_miss", new Error(message)),
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

// Published BloxMind programs: downloaded, signature-checked and cached here so a
// Roblox Studio MCP change can be fixed without an app release.
const BLOXMIND_PROGRAMS_REFRESH_MS = 6 * 60 * 60 * 1000;
const bloxmindProgramStore = createBloxMindProgramStore({
  directory: join(app.getPath("userData"), "bloxmind-programs"),
  log: (message) => console.log(message),
  onError: (error) => reportMainError("bloxmind_programs_refresh", error),
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
      new DesktopMainError({ message: "Only web and mail links can be opened", cause }),
  }).pipe(
    Effect.flatMap((url) =>
      isOpenableUrl(url)
        ? Effect.succeed(url)
        : Effect.fail(
            new DesktopMainError({ message: "Only web, mail and local file links can be opened" }),
          ),
    ),
  );
}

/** A file link shows where the file is; a web link opens normally. */
function openLink(url: URL) {
  return Effect.tryPromise({
    try: async () => {
      if (url.protocol === "file:") {
        const path = fileURLToPath(url);
        if (onNetworkDrive(path, await networkDriveLetters())) {
          throw new Error("Files on network drives can't be opened from a link");
        }
        shell.showItemInFolder(path);
        return;
      }
      await shell.openExternal(url.href);
    },
    catch: (cause) => new DesktopMainError({ message: "Failed to open URL", cause }),
  });
}

/** Write the whole configuration atomically (temp file + rename). */
function writeConfig(config: AppConfig) {
  return Effect.tryPromise({
    try: async () => {
      const destination = configPath();
      const temporary = `${destination}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
        await rename(temporary, destination);
      } catch (cause) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw cause;
      }
    },
    catch: (cause) => new DesktopMainError({ message: "Failed to write app configuration", cause }),
  });
}

/**
 * Read and migrate the stored configuration without writing anything.
 *
 * `patchConfig` uses this directly so it can fold the migration into its own
 * write; going through `loadConfig` there would either write twice or deadlock
 * on the config mutex.
 */
const readConfig = Effect.gen(function* () {
  const contents = yield* Effect.tryPromise({
    try: () => readFile(configPath(), "utf8"),
    catch: (cause) => new DesktopMainError({ message: "Failed to read app configuration", cause }),
  }).pipe(
    Effect.catchAll((error) =>
      isMissingFile(error.cause) ? Effect.succeed(null) : Effect.fail(error),
    ),
  );
  if (contents === null) return { config: defaultConfig, needsWrite: false };

  return yield* Effect.gen(function* () {
    const stored = yield* Effect.try({
      try: () => JSON.parse(contents) as unknown,
      catch: (cause) => new DesktopMainError({ message: "App configuration is invalid", cause }),
    });
    const migrated = migrateStoredConfig(stored);
    const candidate = { ...defaultConfig, ...migrated.config };
    const config = yield* Schema.decodeUnknown(AppConfigSchema)(candidate).pipe(
      Effect.mapError(
        (cause) => new DesktopMainError({ message: "App configuration is invalid", cause }),
      ),
    );
    return { config, needsWrite: migrated.changed };
  }).pipe(
    Effect.tapError((error) => Effect.logWarning(error.message, error.cause)),
    // A corrupt config still falls back to defaults; leaving the file alone
    // keeps it available for support/debugging instead of silently replacing it.
    Effect.catchAll(() => Effect.succeed({ config: defaultConfig, needsWrite: false })),
  );
});

// Hold the mutex across the read and the migration write so a concurrent patch
// cannot land between them and be overwritten by the migrated snapshot.
const loadConfig = Effect.gen(function* () {
  const loaded = yield* readConfig;
  if (loaded.needsWrite) {
    // Persist the migration once so the rewrites do not run on every launch. A
    // failed write is not fatal: the in-memory config is already migrated.
    yield* writeConfig(loaded.config).pipe(
      Effect.catchAll((error) => Effect.logWarning(error.message, error.cause)),
    );
  }
  return loaded.config;
}).pipe(configMutex.withPermits(1));

function patchConfig(input: unknown) {
  return Effect.gen(function* () {
    const patch = yield* Schema.decodeUnknown(AppConfigPatchSchema)(input).pipe(
      Effect.mapError(
        (cause) => new DesktopMainError({ message: "App configuration patch is invalid", cause }),
      ),
    );
    const current = yield* readConfig;
    // The merged config carries the migration's rewritten values and version,
    // so this single write persists both.
    const next = { ...current.config, ...patch };
    yield* writeConfig(next);
  }).pipe(configMutex.withPermits(1));
}

const runMain = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const StudioKeySchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512));

/** Runs a read against Studio through the broker, keeping Studio's error text for the renderer. */
const queryStudio = <A>(query: (callTool: CallStudioTool) => Promise<A>) =>
  openCodeRuntime.runPromise(
    Effect.gen(function* () {
      const broker = yield* StudioMcpBroker;
      return yield* Effect.tryPromise({
        try: () => query((name, args) => Effect.runPromise(broker.callTool(name, args))),
        catch: (cause) =>
          new DesktopMainError({
            message: cause instanceof Error ? cause.message : "Studio didn't answer",
            cause,
          }),
      });
    }),
  );

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
  safeIpcHandle(channels.compileExplorerProgram, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const program = yield* Schema.decodeUnknown(ExplorerProgramEnvelopeSchema)(input);
        const runtime = yield* GeneratedProgramRuntime;
        return yield* runtime.compile(program);
      }),
    ),
  );
  // A newer read replaces one still running, so a closed place doesn't keep Studio busy.
  let explorerTreeRead: AbortController | null = null;
  safeIpcHandle(channels.syncExplorerTree, (event, studioId: unknown, input: unknown) =>
    queryStudio(async (callTool) => {
      const id = await Schema.decodeUnknownPromise(StudioKeySchema)(studioId);
      const options = await Schema.decodeUnknownPromise(ExplorerSyncRequestSchema)(input);
      explorerTreeRead?.abort();
      const read = new AbortController();
      explorerTreeRead = read;
      return syncExplorerTree(callTool, id, {
        ...options,
        signal: read.signal,
        onUpdate: (update) => {
          if (!event.sender.isDestroyed())
            event.sender.send(channels.explorerTreeUpdate, { studioId: id, ...update });
        },
      });
    }),
  );
  safeIpcHandle(channels.getExplorerNodeDetails, (_event, studioId: unknown, input: unknown) =>
    queryStudio(async (callTool) => {
      const id = await Schema.decodeUnknownPromise(StudioKeySchema)(studioId);
      const request = await Schema.decodeUnknownPromise(ExplorerDetailsRequestSchema)(input);
      const result = await callTool("inspect_instance", { studio_id: id, path: request.path });
      if (mcpError(result)) return null;
      const data = mcpData(result);
      const match = Array.isArray(data?.matches)
        ? data.matches[request.occurrence ?? 0]
        : data;
      if (!match) return null;
      const fields = (values: unknown) =>
        Object.entries(values && typeof values === "object" ? values : {})
          .filter(([name]) => name !== "UniqueId")
          .map(([name, value]) => ({
            name,
            value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      return {
        properties: fields(match.properties),
        attributes: fields(match.attributes),
      };
    }),
  );
  safeIpcHandle(channels.editExplorerObject, (_event, studioId: unknown, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const studio = yield* Schema.decodeUnknown(StudioKeySchema)(studioId).pipe(
          Effect.mapError(
            (cause) => new DesktopMainError({ message: "A Studio target is required", cause }),
          ),
        );
        const edit = yield* Schema.decodeUnknown(ExplorerEditSchema)(input).pipe(
          Effect.mapError(
            (cause) => new DesktopMainError({ message: "Invalid Explorer edit", cause }),
          ),
        );
        const result = yield* Effect.tryPromise({
          try: () => queryStudio((callTool) => editExplorerObject(callTool, studio, edit)),
          catch: (cause) =>
            new DesktopMainError({
              message: cause instanceof Error ? cause.message : "Studio couldn't make that change",
              cause,
            }),
        });
        return yield* Schema.decodeUnknown(ExplorerEditResultSchema)(result).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopMainError({ message: "Studio returned an unreadable answer", cause }),
          ),
        );
      }),
    ),
  );
  safeIpcHandle(channels.listExplorerProgramTools, () =>
    openCodeRuntime.runPromise(
      GeneratedProgramRuntime.pipe(
        Effect.flatMap((runtime) => runtime.allowedTools("explorer-snapshot")),
      ),
    ),
  );
  safeIpcHandle(channels.getOpenCodeInfo, () =>
    openCodeRuntime.runPromise(
      OpenCode.pipe(Effect.flatMap((service) => service.info)),
    ),
  );
  safeIpcHandle(channels.getOpenCodeInstallFolder, () => openCodeBinaryDirectory);
  safeIpcHandle(channels.getStudioMcpStatus, () =>
    openCodeRuntime.runPromise(StudioMcpBroker.pipe(Effect.flatMap((broker) => broker.status))),
  );
  safeIpcHandle(channels.getVersion, () => runMain(Effect.sync(() => app.getVersion())));
  safeIpcHandle(channels.getInstructionFiles, () =>
    findInstructionFiles({
      workspace: join(app.getPath("home"), "BloxMind"),
      globalConfigDirectory,
      home: app.getPath("home"),
    }),
  );
  safeIpcHandle(channels.getInstructions, () =>
    readGlobalInstructions(globalConfigDirectory),
  );
  safeIpcHandle(channels.saveInstructions, (_event, content: unknown) =>
    writeGlobalInstructions(globalConfigDirectory, content),
  );
  safeIpcHandle(channels.getBloxMindPrograms, () => bloxmindProgramStore.current());
  safeIpcHandle(channels.loadConfig, () => runMain(loadConfig));
  safeIpcHandle(channels.patchConfig, (_event, patch: unknown) => runMain(patchConfig(patch)));
  safeIpcHandle(channels.installStudioTargetPrograms, (_event, input: unknown) =>
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
  safeIpcHandle(channels.discoverStudioTargets, (_event, input: unknown) =>
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
  safeIpcHandle(channels.selectStudioTarget, (_event, input: unknown, targetKey: unknown) =>
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
  safeIpcHandle(channels.openUrl, (_event, rawUrl: string) =>
    runMain(parseExternalUrl(rawUrl).pipe(Effect.flatMap(openLink))),
  );
  safeIpcHandle(channels.checkForUpdate, () =>
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
  safeIpcHandle(channels.installUpdate, () =>
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
        // Stop the engine before the installer runs: it owns the helper
        // processes and files the installer replaces. Doing it here, instead of
        // letting before-quit do it, keeps the installer from starting while
        // the old app still holds those files, and avoids before-quit
        // preventDefault-ing the quit that quitAndInstall just requested.
        yield* disposeOpenCodeRuntimeBounded.pipe(Effect.catchAll(Effect.logError));
        yield* Effect.sync(() => {
          quitting = true;
          autoUpdater.quitAndInstall();
        });
      }),
    ),
  );
  safeIpcHandle(channels.invokeExplorerProgram,
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
  safeIpcHandle(channels.compileProjectIndexProgram, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const program = yield* Schema.decodeUnknown(ProjectIndexProgramEnvelopeSchema)(input);
        const runtime = yield* GeneratedProgramRuntime;
        return yield* runtime.compile(program);
      }),
    ),
  );
  safeIpcHandle(channels.invokeProjectIndexProgram,
    (_event, input: unknown, studioIdInput: unknown) =>
      openCodeRuntime.runPromise(
        Effect.gen(function* () {
          const artifact = yield* Schema.decodeUnknown(GeneratedProgramArtifactSchema)(input);
          const studioId = yield* Schema.decodeUnknown(
            Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
          )(studioIdInput);
          if (
            artifact.contract.name !== "project-index" ||
            artifact.contract.outputSchemaVersion !== "project-index-skeleton-v1"
          ) {
            return yield* Effect.fail(
              new DesktopMainError({ message: "Project index program contract is invalid" }),
            );
          }
          const runtime = yield* GeneratedProgramRuntime;
          const result = yield* runtime.invoke({ artifact, input: { studioId } });
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
  safeIpcHandle(channels.relaunch, () =>
    runMain(
      Effect.sync(() => {
        app.relaunch();
        app.quit();
      }),
    ),
  );
  // Kept in main so leaving Settings doesn't stop or lose a Blender setup.
  let blenderSetup: AbortController | null = null;
  let blenderProgress: BlenderSetupProgress | null = null;
  const applyBlenderToConfig = (blender: ReturnType<typeof blenderMcpServerConfig> | null) =>
    configMutex.withPermits(1)(
      Effect.tryPromise({
        try: async () => {
          const configFile = join(globalConfigDirectory, "opencode.json");
          await writeFile(configFile, withBlender(await readFile(configFile, "utf8"), blender));
        },
        catch: (cause) =>
          new DesktopMainError({ message: "Failed to apply Blender's settings", cause }),
      }),
    );
  safeIpcHandle(channels.getBlenderToolsState, () =>
    blenderSetup
      ? { state: "installing", progress: blenderProgress }
      : getBlenderToolsState(blenderToolsRoot()),
  );
  safeIpcHandle(channels.installBlenderTools, (event) => {
    if (blenderSetup) return undefined;
    const setup = new AbortController();
    blenderSetup = setup;
    blenderProgress = null;
    return runMain(
      installBlenderTools({
        root: blenderToolsRoot(),
        fetch: (url, init) => net.fetch(url, init),
        signal: setup.signal,
        onProgress: (progress) => {
          blenderProgress = progress;
          if (!event.sender.isDestroyed()) {
            event.sender.send(channels.blenderSetupProgress, progress);
          }
        },
      }).pipe(
        // The page reads the reason from the message, as errors lose everything else crossing over.
        Effect.mapError(
          (error) =>
            new DesktopMainError({
              message: `${error.message} (reason: ${error.reason})`,
              cause: error.cause,
            }),
        ),
        Effect.andThen(applyBlenderToConfig(blenderMcpServerConfig(blenderToolsRoot()))),
        Effect.ensuring(
          Effect.sync(() => {
            blenderSetup = null;
          }),
        ),
      ),
    );
  });
  safeIpcHandle(channels.cancelBlenderTools, () => blenderSetup?.abort());
  safeIpcHandle(channels.openBlender, () =>
    runMain(
      Effect.tryPromise({
        try: () => openBlender(blenderToolsRoot()),
        catch: (cause) => new DesktopMainError({ message: "Couldn't open Blender", cause }),
      }),
    ),
  );
  safeIpcHandle(channels.removeBlenderTools, () =>
    runMain(
      Effect.gen(function* () {
        const state = yield* Effect.promise(() => getBlenderToolsState(blenderToolsRoot()));
        if (state.state === "ready" && state.running) {
          return yield* Effect.fail(new DesktopMainError({ message: "Close Blender first" }));
        }
        yield* applyBlenderToConfig(null);
        yield* Effect.tryPromise({
          try: () => removeBlenderTools(blenderToolsRoot()),
          catch: (cause) => {
            const code = (cause as { code?: unknown } | null)?.code;
            const locked = code === "EBUSY" || code === "EPERM" || code === "EACCES";
            return new DesktopMainError({
              message: `Couldn't remove Blender${locked ? " (locked)" : ""}`,
              cause,
            });
          },
        });
      }),
    ),
  );
  const sentModels = () => sentModelsFile(app.getPath("userData"));
  const uploadsInFlight = new Map<
    string,
    { result: Promise<ModelUploadResult>; urls: Set<string> }
  >();
  safeIpcHandle(channels.getUploadAccess, async (_event, studioKey: unknown, modelUrl: unknown) => {
    const modelsFolder = join(app.getPath("home"), "BloxMind", "Models");
    await mkdir(modelsFolder, { recursive: true }).catch(() => {});
    const folder = (typeof modelUrl === "string" ? modelFolder(modelUrl) : null) ?? modelsFolder;
    const details = await queryStudio((callTool) =>
      getUploadAccess(callTool, typeof studioKey === "string" ? studioKey : null, folder),
    ).catch(() => ({ state: "no_studio" as const, readOn: false, writeOn: false }));
    // Failing keeps the last answer on screen, and the checklist asks again on its next check.
    if (details.state === "rate_limited") throw new Error("Roblox asked BloxMind to slow down");
    return { ...details, folder, folderUrl: pathToFileURL(folder).href };
  });
  safeIpcHandle(channels.readModelFile, async (_event, url: unknown) => {
    const file = await readModelFile(await Schema.decodeUnknownPromise(Schema.String)(url));
    if (!file) return null;
    return {
      name: file.name,
      fileName: file.fileName,
      path: file.path,
      folder: file.folder,
      data: file.bytes,
      kind: file.kind,
      sizeBytes: file.bytes.byteLength,
      hash: file.hash,
      sent: await readSentModel(sentModels(), file.hash),
    };
  });
  safeIpcHandle(
    channels.uploadModelToPlace,
    async (event, url: unknown, studioKey: unknown, hash: unknown, addOnly: unknown) => {
      const decodedUrl = await Schema.decodeUnknownPromise(Schema.String)(url);
      const studioId = await Schema.decodeUnknownPromise(StudioKeySchema)(studioKey);
      const expectedHash = await Schema.decodeUnknownPromise(Schema.String)(hash);
      // A second click, or a second card with the same bytes, joins the upload that's running for
      // this Studio. Another Studio gets its own, since the model has to go in its place too.
      const onlyAdd = addOnly === true;
      const key = `${studioId}\n${expectedHash}\n${onlyAdd}`;
      const running = uploadsInFlight.get(key);
      if (running) {
        running.urls.add(decodedUrl);
        return running.result;
      }
      const urls = new Set([decodedUrl]);
      const result = queryStudio((callTool) =>
        sendModelToPlace(decodedUrl, {
          callTool,
          studioId,
          sentFile: sentModels(),
          expectedHash,
          addOnly: onlyAdd,
          onStep: (step) => {
            if (event.sender.isDestroyed()) return;
            for (const each of urls) event.sender.send(channels.modelUploadStep, each, step);
          },
        }),
      ).finally(() => uploadsInFlight.delete(key));
      uploadsInFlight.set(key, { result, urls });
      return result;
    },
  );
  safeIpcHandle(channels.notifyResponseReady, () =>
    runMain(
      Effect.sync(() => {
        // Don't interrupt when the user is already looking at the app.
        if (BrowserWindow.getFocusedWindow()) return;
        if (!Notification.isSupported()) return;
        const n = new Notification({
          title: "BloxMind",
          body: "Your assistant finished responding.",
        });
        n.on("click", () => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        });
        n.show();
      }),
    ),
  );
  safeIpcHandle(channels.openNotificationSettings, () => {
    const url = notificationSettingsUrl(process.platform, "ai.BloxMind.desktop");
    return url ? shell.openExternal(url) : undefined;
  });
  safeIpcHandle(channels.showSystemNotification, (_event, input: unknown) =>
    runMain(
      Schema.decodeUnknown(SystemNotificationSchema)(input).pipe(
        Effect.mapError(
          (cause) => new DesktopMainError({ message: "System notification is invalid", cause }),
        ),
        Effect.flatMap((notification) =>
          Effect.tryPromise({
            try: () => showSystemNotification(notification),
            catch: (cause) =>
              new DesktopMainError({ message: "Failed to show a system notification", cause }),
          }),
        ),
      ),
    ),
  );
  // ── Checkpoint system ──────────────────────────────────────────────
  // Checkpoint IPC arguments cross a trust boundary; validate them before
  // they reach the service (which additionally sanitizes them into paths).
  const SessionIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));
  const CheckpointIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));
  safeIpcHandle(channels.checkpointCapture, (_event, input: unknown) =>
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
  safeIpcHandle(channels.checkpointRestore, (_event, input: unknown) =>
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
  safeIpcHandle(channels.checkpointPreview, (_event, checkpointId: unknown, sessionId: unknown) =>
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
  safeIpcHandle(channels.checkpointChanged, (_event, checkpointId: unknown, sessionId: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const id = yield* Schema.decodeUnknown(CheckpointIdSchema)(checkpointId);
        const sid = yield* Schema.decodeUnknown(SessionIdSchema)(sessionId);
        const service = yield* CheckpointServiceTag;
        return yield* service.changed(id, sid);
      }),
    ),
  );
  safeIpcHandle(channels.checkpointList, (_event, sessionId: unknown) =>
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
  safeIpcHandle(channels.checkpointValidate, () =>
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
            Effect.flatMap(openLink),
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
  // Windows drops notifications from an app without this. It matches appId in electron-builder.yml.
  if (process.platform === "win32") app.setAppUserModelId("ai.BloxMind.desktop");
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
      // Now that project files are off the table for the engine, carry the workspace
      // AGENTS.md (where instructions used to live) into the engine-global AGENTS.md.
      yield* Effect.sync(() => {
        try {
          migrateWorkspaceInstructionsToGlobalSync(
            join(app.getPath("home"), "BloxMind"),
            globalConfigDirectory,
          );
        } catch (error) {
          console.warn("[bloxmind] Failed to seed global engine instructions:", error);
        }
      });
      // The cached copy is ready before the window asks for it; the download
      // happens in the background and applies from the next time a program loads.
      yield* Effect.promise(() => bloxmindProgramStore.load());
      yield* registerIpcHandlers;
      yield* Effect.sync(() => {
        // Tell the window when newer programs arrive, so they apply without a restart.
        const refresh = () =>
          void bloxmindProgramStore.refresh().then((result) => {
            if (result === "updated" && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(channels.bloxmindProgramsUpdated);
            }
          });
        refresh();
        setInterval(refresh, BLOXMIND_PROGRAMS_REFRESH_MS).unref();
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
