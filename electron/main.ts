import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { ExplorerProgramEnvelopeSchema, ExplorerSnapshotSchema } from "../src/lib/explorer";
import { ProjectIndexProgramEnvelopeSchema, ProjectSkeletonSchema } from "../src/lib/projectIndex";
import {
  CaptureContextSchema,
  CheckpointRestoreInputSchema,
  CheckpointRestoreResultSchema,
  CheckpointSchema,
  RestorePreviewSchema,
  ValidationResultSchema,
} from "../src/types/checkpoints";
import {
  type AppConfig,
  AppConfigPatchSchema,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  type OpenCodeStartupProgress,
} from "../src/types/desktop";
import { GeneratedProgramArtifactSchema } from "../src/types/generatedProgram";
import {
  StudioTargetDiscoverySchema,
  StudioTargetProgramEnvelopesSchema,
  StudioTargetProgramsSchema,
  StudioTargetSelectionSchema,
} from "../src/types/studioTarget";
import { handleLastWindowClosed } from "./appLifecycle";
import { channels } from "./channels";
import { compareReleaseVersions, parseReleaseVersion } from "./releaseVersion";
import { CheckpointServiceTag, makeCheckpointServiceLayer } from "./services/CheckpointService";
import {
  GeneratedProgramRuntime,
  GeneratedProgramRuntimeLive,
} from "./services/GeneratedProgramRuntime";
import { makeOpenCodeLayer, OpenCode } from "./services/OpenCode";
import {
  makeRojoInstallerLayer,
  RojoInstallerTag,
  resolvePluginsDirectory,
} from "./services/RojoInstaller";
import {
  cleanupRojo,
  makeRojoServerManagerLayer,
  RojoServerManagerTag,
} from "./services/RojoServerManager";
import { makeStudioMcpBrokerLayer } from "./services/StudioMcpBroker";
import { type SweepReport, sweepStaleProcesses } from "./services/staleProcessSweep";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const defaultConfig: AppConfig = DEFAULT_APP_CONFIG;
const configMutex = Effect.unsafeMakeSemaphore(1);

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

class DesktopMainError extends Data.TaggedError("DesktopMainError")<{
  message: string;
  cause?: unknown;
}> {}

const studioMcpBrokerLayer = makeStudioMcpBrokerLayer({
  workspace: join(app.getPath("home"), "BloxMind"),
  localAppData: process.env.LOCALAPPDATA,
});

const openCodeRuntime = ManagedRuntime.make(
  Layer.merge(
    Layer.merge(
      Layer.merge(
        makeOpenCodeLayer({
          binaryCacheDirectory: join(app.getPath("userData"), "opencode"),
          workspace: join(app.getPath("home"), "BloxMind"),
          onStartupProgress: (progress: OpenCodeStartupProgress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(channels.openCodeStartupProgress, progress);
            }
          },
        }),
        // The checkpoint service reads Rojo's live-sync status post-restore,
        // so provide the Rojo server manager layer into it explicitly. Both
        // are merged into the same managed runtime below.
        makeCheckpointServiceLayer({
          storeRoot: join(app.getPath("userData"), "checkpoints"),
          workspace: join(app.getPath("home"), "BloxMind"),
        }).pipe(
          Layer.provide(
            makeRojoServerManagerLayer({
              binDirectory: join(app.getPath("userData"), "bin"),
            }),
          ),
        ),
      ),
      Layer.merge(
        makeRojoServerManagerLayer({
          binDirectory: join(app.getPath("userData"), "bin"),
        }),
        makeRojoInstallerLayer({
          binDirectory: join(app.getPath("userData"), "bin"),
          pluginsDirectory: resolvePluginsDirectory(),
        }),
      ),
    ),
    GeneratedProgramRuntimeLive.pipe(Layer.provide(studioMcpBrokerLayer)),
  ).pipe(Layer.provide(studioMcpBrokerLayer)),
);

const expectedContract = (name: string) => ({
  name,
  version: "1",
  inputSchemaVersion: "1",
  outputSchemaVersion: "1",
});

function requireContract(
  contract: {
    name: string;
    version: string;
    inputSchemaVersion: string;
    outputSchemaVersion: string;
  },
  name: string,
) {
  const expected = expectedContract(name);
  if (JSON.stringify(contract) !== JSON.stringify(expected)) {
    return Effect.fail(
      new DesktopMainError({ message: `Generated program contract ${name} is invalid` }),
    );
  }
  return Effect.void;
}

function isMissingFile(cause: unknown): boolean {
  return cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT";
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
        : Effect.fail(new DesktopMainError({ message: "Only HTTP and HTTPS links can be opened" })),
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
      stored !== null && typeof stored === "object"
        ? { ...defaultConfig, ...stored }
        : defaultConfig;
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
 * Best-effort sweep of stale rojo/opencode processes left behind by a
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
  catch: (cause) => new DesktopMainError({ message: "Failed to stop the OpenCode runtime", cause }),
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
  ipcMain.handle(channels.compileExplorerProgram, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const program = yield* Schema.decodeUnknown(ExplorerProgramEnvelopeSchema)(input);
        const runtime = yield* GeneratedProgramRuntime;
        return yield* runtime.compile(program);
      }),
    ),
  );
  ipcMain.handle(channels.getOpenCodeInfo, () =>
    openCodeRuntime.runPromise(OpenCode.pipe(Effect.flatMap((service) => service.info))),
  );
  ipcMain.handle(channels.getVersion, () => runMain(Effect.sync(() => app.getVersion())));
  ipcMain.handle(channels.loadConfig, () => runMain(loadConfig));
  ipcMain.handle(channels.patchConfig, (_event, patch: unknown) => runMain(patchConfig(patch)));
  ipcMain.handle(channels.installStudioTargetPrograms, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const envelopes = yield* Schema.decodeUnknown(StudioTargetProgramEnvelopesSchema)(input);
        yield* requireContract(envelopes.discovery.contract, "studio-target-discovery");
        yield* requireContract(envelopes.selection.contract, "studio-target-selection");
        const runtime = yield* GeneratedProgramRuntime;
        const [discoveryArtifact, selectionArtifact] = yield* Effect.all(
          [runtime.compile(envelopes.discovery), runtime.compile(envelopes.selection)],
          { concurrency: "unbounded" },
        );
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
        const key = yield* Schema.decodeUnknown(
          Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512)),
        )(targetKey);
        yield* requireContract(programs.selection.artifact.contract, "studio-target-selection");
        const runtime = yield* GeneratedProgramRuntime;
        const result = yield* runtime.invoke({
          artifact: programs.selection.artifact,
          input: { targetKey: key },
        });
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
        // checkForUpdates resolves with the latest release info even when the
        // app is already current; only the update-not-available event carries
        // that signal, so race the promise against it and additionally compare
        // versions deterministically below.
        const outcome = yield* Effect.promise(() =>
          Promise.race([
            autoUpdater.checkForUpdates().then(
              (result) => ({ kind: "checked", result }) as const,
              (cause: unknown) => ({ kind: "failed", cause }) as const,
            ),
            new Promise<{ kind: "not-available" }>((resolve) =>
              autoUpdater.once("update-not-available", () => resolve({ kind: "not-available" })),
            ),
          ]),
        );
        if (outcome.kind === "failed") {
          return yield* Effect.fail(
            new DesktopMainError({ message: "Failed to check for updates", cause: outcome.cause }),
          );
        }
        if (outcome.kind === "not-available") return null;
        const result = outcome.result;
        if (!result) return null;
        const latest = parseReleaseVersion(result.updateInfo.version);
        const current = parseReleaseVersion(app.getVersion());
        // Already on the latest (or a newer unreleased build): nothing to offer.
        if (!latest || !current || compareReleaseVersions(latest, current) <= 0) return null;
        const body =
          typeof result.updateInfo.releaseNotes === "string"
            ? result.updateInfo.releaseNotes
            : null;
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
        yield* Effect.tryPromise({
          try: () => autoUpdater.downloadUpdate(),
          catch: (cause) =>
            new DesktopMainError({ message: "Failed to download the update", cause }),
        });
        yield* Effect.sync(() => autoUpdater.quitAndInstall());
      }),
    ),
  );
  ipcMain.handle(channels.invokeExplorerProgram, (_event, input: unknown) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const artifact = yield* Schema.decodeUnknown(GeneratedProgramArtifactSchema)(input);
        if (
          artifact.contract.name !== "explorer-snapshot" ||
          artifact.contract.outputSchemaVersion !== "explorer-snapshot-v1"
        ) {
          return yield* Effect.fail(
            new DesktopMainError({ message: "Explorer program contract is invalid" }),
          );
        }
        const runtime = yield* GeneratedProgramRuntime;
        const result = yield* runtime.invoke({ artifact, input: null });
        return yield* Schema.decodeUnknown(ExplorerSnapshotSchema)(result.value).pipe(
          Effect.mapError(
            (cause) => new DesktopMainError({ message: "Explorer output is invalid", cause }),
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
                  new DesktopMainError({
                    message: "Checkpoint capture output is invalid",
                    cause,
                  }),
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
                  new DesktopMainError({
                    message: "Checkpoint restore output is invalid",
                    cause,
                  }),
              ),
            ),
          ),
        );
      }),
    ),
  );
  ipcMain.handle(channels.checkpointPreview, (_event, checkpointId: string, sessionId: string) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* CheckpointServiceTag;
        return yield* service.preview(checkpointId, sessionId).pipe(
          Effect.flatMap((preview) =>
            Schema.decodeUnknown(RestorePreviewSchema)(preview).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopMainError({
                    message: "Checkpoint preview output is invalid",
                    cause,
                  }),
              ),
            ),
          ),
        );
      }),
    ),
  );
  ipcMain.handle(channels.checkpointList, (_event, sessionId: string) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* CheckpointServiceTag;
        const history = yield* service.list(sessionId);
        return yield* Schema.decodeUnknown(Schema.Array(CheckpointSchema))(history).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopMainError({ message: "Checkpoint list output is invalid", cause }),
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
                  new DesktopMainError({
                    message: "Checkpoint validation output is invalid",
                    cause,
                  }),
              ),
            ),
          ),
        );
      }),
    ),
  );
  // ── Rojo live-sync ────────────────────────────────────────────────
  ipcMain.handle(channels.rojoStart, (_event, workspace: string) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const rojo = yield* RojoServerManagerTag;
        return yield* rojo.start(workspace);
      }),
    ),
  );
  ipcMain.handle(channels.rojoStop, () =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const rojo = yield* RojoServerManagerTag;
        yield* rojo.stop();
      }),
    ),
  );
  ipcMain.handle(channels.rojoStatus, () =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const rojo = yield* RojoServerManagerTag;
        return yield* rojo.status();
      }),
    ),
  );
  ipcMain.handle(channels.rojoToggle, (_event, workspace: string) =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const rojo = yield* RojoServerManagerTag;
        return yield* rojo.toggle(workspace);
      }),
    ),
  );
  ipcMain.handle(channels.rojoLogs, () =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const rojo = yield* RojoServerManagerTag;
        return yield* rojo.getLogs();
      }),
    ),
  );
  // ── Rojo 1-click setup ─────────────────────────────────────────────
  ipcMain.handle(channels.rojoSetup, () =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const installer = yield* RojoInstallerTag;
        return yield* installer.install((progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channels.rojoSetupProgress, progress);
          }
        });
      }),
    ),
  );
  ipcMain.handle(channels.rojoBinaryPath, () =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const installer = yield* RojoInstallerTag;
        return yield* installer.getBinaryPath();
      }),
    ),
  );
  ipcMain.handle(channels.rojoCheckInstalled, () =>
    openCodeRuntime.runPromise(
      Effect.gen(function* () {
        const installer = yield* RojoInstallerTag;
        return yield* installer.checkInstalled();
      }),
    ),
  );
  // Stream logs to renderer via webContents.send
  ipcMain.on(channels.onRojoLog, () => {});
  // Wire up log forwarding: when the renderer subscribes, we register a
  // listener that forwards each log entry to the active window.
  {
    let logListener:
      | ((entry: { timestamp: number; stream: string; message: string }) => void)
      | null = null;
    ipcMain.handle("rojo:subscribe-logs", () =>
      openCodeRuntime.runPromise(
        Effect.gen(function* () {
          const rojo = yield* RojoServerManagerTag;
          if (logListener) return;
          logListener = (entry) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(channels.onRojoLog, entry);
            }
          };
          rojo.onLog(logListener);
        }),
      ),
    );
    ipcMain.handle("rojo:unsubscribe-logs", () =>
      openCodeRuntime.runPromise(
        Effect.sync(() => {
          // Listeners are cleaned up on stop; just clear the ref.
          logListener = null;
        }),
      ),
    );
  }
  // ── Window controls ─────────────────────────────────────────────────
  // The window is frameless (frame:false), so the renderer hosts its own
  // min/maximize/close buttons in the titlebar. These handlers drive the
  // real BrowserWindow.
  ipcMain.handle(channels.windowMinimize, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.handle(channels.windowMaximizeToggle, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle(channels.windowClose, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.handle(channels.windowIsMaximized, () =>
    Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
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
          frame: false,
          titleBarStyle: "hidden",
          useContentSize: true,
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
                catch: (cause) => new DesktopMainError({ message: "Failed to open URL", cause }),
              }),
            ),
            Effect.catchAll(Effect.logWarning),
          ),
        );
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        const currentUrl = window.webContents.getURL();
        const shouldBlock = Effect.runSync(
          Effect.try({
            try: () => Boolean(currentUrl && new URL(url).origin !== new URL(currentUrl).origin),
            catch: () => true,
          }).pipe(Effect.catchAll(() => Effect.succeed(true))),
        );
        if (shouldBlock) event.preventDefault();
      });
      window.once("ready-to-show", () => Effect.runSync(Effect.sync(() => window.show())));
      window.on("closed", () =>
        Effect.runSync(
          Effect.sync(() => {
            if (mainWindow === window) mainWindow = null;
          }),
        ),
      );
      // Notify the renderer whenever the maximized state changes so the
      // titlebar toggle icon stays in sync.
      const notifyMaximized = () => {
        if (mainWindow === window && !window.isDestroyed()) {
          window.webContents.send(channels.onWindowMaximizedChange, window.isMaximized());
        }
      };
      window.on("maximize", notifyMaximized);
      window.on("unmaximize", notifyMaximized);
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
    // Await both cleanups in parallel, each individually bounded, so quit
    // can never hang indefinitely. Errors are logged, never thrown.
    shutdownInFlight = Effect.runPromise(
      Effect.all(
        [
          // cleanupRojo() never rejects; its internal timeout bounds it.
          Effect.promise(() => cleanupRojo()),
          disposeOpenCodeRuntimeBounded,
        ],
        { concurrency: 2 },
      ).pipe(Effect.catchAll(Effect.logError)),
    ).then(() => {
      quitting = true;
      app.quit();
    });
  });
});

// ── Single-instance lock ─────────────────────────────────────────────
// A second launch must not race Rojo's fixed port or double background
// processes. If the lock is already held, quit immediately without
// starting any services.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  Effect.runSync(
    Effect.logWarning("[single-instance] another BloxMind instance is already running; quitting"),
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
      // Kill leftover rojo/opencode processes from a previous crashed or
      // force-killed session BEFORE spawning our own. Best-effort: failures
      // are logged and never block startup.
      yield* sweepStaleProcessesEffect;
      yield* registerAppLifecycle;
      yield* Effect.tryPromise({
        try: () => app.whenReady(),
        catch: (cause) =>
          new DesktopMainError({ message: "Electron failed to become ready", cause }),
      });
      yield* registerIpcHandlers;
      yield* Effect.sync(() => Menu.setApplicationMenu(null));
      yield* createWindow();
      yield* Effect.sync(() => {
        booted = true;
      });
      // Auto-start the Rojo server against the BloxMind workspace so that
      // Roblox Studio can connect immediately without manual setup.
      // Defer slightly so the window loads first, then start `rojo serve`.
      setTimeout(() => {
        openCodeRuntime
          .runPromise(
            Effect.gen(function* () {
              const rojo = yield* RojoServerManagerTag;
              yield* rojo.start(join(app.getPath("home"), "BloxMind"));
            }),
          )
          .catch(Effect.logWarning);
      }, 500);
      yield* Effect.sync(() =>
        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            Effect.runFork(createWindow().pipe(Effect.catchAll(Effect.logError)));
          }
        }),
      );
    }).pipe(Effect.catchAll(Effect.logError)),
  );
}
