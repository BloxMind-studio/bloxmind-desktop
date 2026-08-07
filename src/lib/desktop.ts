import { Data, Effect, Schema } from "effect";
import { ExplorerSnapshotSchema } from "@/lib/explorer";
import { ProjectSkeletonSchema } from "@/lib/projectIndex";
import {
  type AppConfig,
  AppConfigPatchSchema,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  type DesktopApi,
  type OpenCodeInfo,
  OpenCodeInfoSchema,
  type OpenCodeStartupProgress,
  type RojoInstallProgress,
  type RojoInstallResult,
  type RojoLogEntry,
  type RojoStatus,
  type UpdateInfo,
  UpdateInfoSchema,
} from "@/types/desktop";
import {
  type CaptureContext,
  type Checkpoint,
  type CheckpointRestoreInput,
  type CheckpointRestoreResult,
  CheckpointSchema,
  CheckpointRestoreResultSchema,
  type RestorePreview,
  RestorePreviewSchema,
  type ValidationResult,
  ValidationResultSchema,
} from "@/types/checkpoints";
import { GeneratedProgramArtifactSchema } from "@/types/generatedProgram";
import {
  type StudioTargetDiscovery,
  StudioTargetDiscoverySchema,
  type StudioTargetProgramEnvelopes,
  type StudioTargetPrograms,
  StudioTargetProgramsSchema,
  type StudioTargetSelection,
  StudioTargetSelectionSchema,
} from "@/types/studioTarget";

const CONFIG_KEY = "BloxMind-config";
const DEFAULT_CONFIG: AppConfig = DEFAULT_APP_CONFIG;

export class DesktopError extends Data.TaggedError("DesktopError")<{
  message: string;
  cause?: unknown;
}> {}

interface DesktopEffects {
  readonly compileExplorerProgram: DesktopApi["compileExplorerProgram"] extends (
    input: infer Input,
  ) => Promise<infer Output>
    ? (input: Input) => Effect.Effect<Output, DesktopError>
    : never;
  readonly invokeExplorerProgram: DesktopApi["invokeExplorerProgram"] extends (
    input: infer Input,
  ) => Promise<infer Output>
    ? (input: Input) => Effect.Effect<Output, DesktopError>
    : never;
  readonly compileProjectIndexProgram: DesktopApi["compileProjectIndexProgram"] extends (
    input: infer Input,
  ) => Promise<infer Output>
    ? (input: Input) => Effect.Effect<Output, DesktopError>
    : never;
  readonly invokeProjectIndexProgram: DesktopApi["invokeProjectIndexProgram"] extends (
    input: infer Input,
  ) => Promise<infer Output>
    ? (input: Input) => Effect.Effect<Output, DesktopError>
    : never;
  readonly getOpenCodeInfo: Effect.Effect<OpenCodeInfo, DesktopError>;
  readonly getVersion: Effect.Effect<string, DesktopError>;
  readonly openUrl: (url: string) => Effect.Effect<void, DesktopError>;
  readonly loadConfig: Effect.Effect<AppConfig, DesktopError>;
  readonly patchConfig: (patch: Partial<AppConfig>) => Effect.Effect<void, DesktopError>;
  readonly checkForUpdate: Effect.Effect<UpdateInfo | null, DesktopError>;
  readonly installUpdate: Effect.Effect<void, DesktopError>;
  readonly relaunch: Effect.Effect<void, DesktopError>;
  readonly installStudioTargetPrograms: (
    envelopes: StudioTargetProgramEnvelopes,
  ) => Effect.Effect<StudioTargetPrograms, DesktopError>;
  readonly discoverStudioTargets: (
    programs: StudioTargetPrograms,
  ) => Effect.Effect<StudioTargetDiscovery, DesktopError>;
  readonly selectStudioTarget: (
    programs: StudioTargetPrograms,
    targetKey: string,
  ) => Effect.Effect<StudioTargetSelection, DesktopError>;
  readonly checkpointCapture: (context: CaptureContext) => Effect.Effect<Checkpoint, DesktopError>;
  readonly checkpointRestore: (
    input: CheckpointRestoreInput,
  ) => Effect.Effect<CheckpointRestoreResult, DesktopError>;
  readonly checkpointPreview: (
    checkpointId: string,
    sessionId: string,
  ) => Effect.Effect<RestorePreview, DesktopError>;
  readonly checkpointList: (
    sessionId: string,
  ) => Effect.Effect<readonly Checkpoint[], DesktopError>;
  readonly checkpointValidate: () => Effect.Effect<ValidationResult, DesktopError>;
  readonly rojoStart: (workspace: string) => Effect.Effect<RojoStatus, DesktopError>;
  readonly rojoStop: () => Effect.Effect<void, DesktopError>;
  readonly rojoStatus: () => Effect.Effect<RojoStatus, DesktopError>;
  readonly rojoToggle: (workspace: string) => Effect.Effect<RojoStatus, DesktopError>;
  readonly rojoLogs: () => Effect.Effect<RojoLogEntry[], DesktopError>;
  readonly onRojoLog: (listener: (entry: RojoLogEntry) => void) => () => void;
  readonly rojoSetup: (
    onProgress: (progress: RojoInstallProgress) => void,
  ) => Effect.Effect<RojoInstallResult, DesktopError>;
  readonly rojoBinaryPath: () => Effect.Effect<string | null, DesktopError>;
  readonly rojoCheckInstalled: () => Effect.Effect<boolean, DesktopError>;
}

type StartupProgressListener = (progress: OpenCodeStartupProgress) => void;

const loadBrowserConfig = Effect.gen(function* () {
  const stored = yield* Effect.try({
    try: () => {
      const contents = window.localStorage.getItem(CONFIG_KEY);
      return contents ? (JSON.parse(contents) as unknown) : DEFAULT_CONFIG;
    },
    catch: (cause) => new DesktopError({ message: "Failed to load browser configuration", cause }),
  });
  const candidate =
    stored !== null && typeof stored === "object"
      ? { ...DEFAULT_CONFIG, ...stored }
      : DEFAULT_CONFIG;
  return yield* Schema.decodeUnknown(AppConfigSchema)(candidate).pipe(
    Effect.mapError(
      (cause) => new DesktopError({ message: "Browser configuration is invalid", cause }),
    ),
  );
}).pipe(Effect.catchAll(() => Effect.succeed(DEFAULT_CONFIG)));

const browserEffects: DesktopEffects = {
  compileExplorerProgram: () =>
    Effect.fail(new DesktopError({ message: "Explorer requires the desktop app." })),
  compileProjectIndexProgram: () =>
    Effect.fail(new DesktopError({ message: "Project index requires the desktop app." })),
  getOpenCodeInfo: Effect.fail(
    new DesktopError({
      message: "The desktop service is unavailable. Start BloxMind with pnpm dev.",
    }),
  ),
  getVersion: Effect.succeed("0.5.2"),
  openUrl: (url) =>
    Effect.sync(() => window.open(url, "_blank", "noopener,noreferrer")).pipe(Effect.asVoid),
  loadConfig: loadBrowserConfig,
  patchConfig: (input) =>
    Effect.gen(function* () {
      const patch = yield* Schema.decodeUnknown(AppConfigPatchSchema)(input).pipe(
        Effect.mapError(
          (cause) => new DesktopError({ message: "Browser configuration patch is invalid", cause }),
        ),
      );
      const current = yield* loadBrowserConfig;
      yield* Effect.try({
        try: () =>
          window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, ...patch })),
        catch: (cause) =>
          new DesktopError({ message: "Failed to save browser configuration", cause }),
      });
    }),
  checkForUpdate: Effect.succeed(null),
  installUpdate: Effect.fail(
    new DesktopError({ message: "Updates are only available in the desktop app." }),
  ),
  invokeExplorerProgram: () =>
    Effect.fail(new DesktopError({ message: "Explorer requires the desktop app." })),
  invokeProjectIndexProgram: () =>
    Effect.fail(new DesktopError({ message: "Project index requires the desktop app." })),
  relaunch: Effect.sync(() => window.location.reload()),
  installStudioTargetPrograms: () =>
    Effect.fail(
      new DesktopError({ message: "Studio targets are only available in the desktop app." }),
    ),
  discoverStudioTargets: () =>
    Effect.fail(
      new DesktopError({ message: "Studio targets are only available in the desktop app." }),
    ),
  selectStudioTarget: () =>
    Effect.fail(
      new DesktopError({ message: "Studio targets are only available in the desktop app." }),
    ),
  checkpointCapture: () =>
    Effect.fail(new DesktopError({ message: "Checkpointing requires the desktop app." })),
  checkpointRestore: () =>
    Effect.fail(new DesktopError({ message: "Checkpointing requires the desktop app." })),
  checkpointPreview: () =>
    Effect.fail(new DesktopError({ message: "Checkpointing requires the desktop app." })),
  checkpointList: () =>
    Effect.fail(new DesktopError({ message: "Checkpointing requires the desktop app." })),
  checkpointValidate: () =>
    Effect.fail(new DesktopError({ message: "Checkpointing requires the desktop app." })),
  rojoStart: () => Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
  rojoStop: () => Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
  rojoStatus: () => Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
  rojoToggle: () => Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
  rojoLogs: () => Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
  onRojoLog: () => () => {},
  rojoSetup: () => Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
  rojoBinaryPath: () =>
    Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
  rojoCheckInstalled: () =>
    Effect.fail(new DesktopError({ message: "Rojo requires the desktop app." })),
};

const invoke = <A>(message: string, operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new DesktopError({
        message: cause instanceof Error ? `${message}: ${cause.message}` : message,
        cause,
      }),
  });

const decodeBridgeValue =
  <A, I>(message: string, schema: Schema.Schema<A, I>) =>
  <E>(effect: Effect.Effect<unknown, E>) =>
    effect.pipe(
      Effect.flatMap(Schema.decodeUnknown(schema)),
      Effect.mapError((cause) =>
        cause instanceof DesktopError ? cause : new DesktopError({ message, cause }),
      ),
    );

function makeBridgeEffects(api: DesktopApi): DesktopEffects {
  return {
    compileExplorerProgram: (program) =>
      invoke("Failed to compile Explorer program", () => api.compileExplorerProgram(program)).pipe(
        decodeBridgeValue("Explorer program artifact is invalid", GeneratedProgramArtifactSchema),
      ),
    compileProjectIndexProgram: (program) =>
      invoke("Failed to compile project index program", () =>
        api.compileProjectIndexProgram(program),
      ).pipe(
        decodeBridgeValue(
          "Project index program artifact is invalid",
          GeneratedProgramArtifactSchema,
        ),
      ),
    getOpenCodeInfo: invoke("Failed to get OpenCode connection details", () =>
      api.getOpenCodeInfo(),
    ).pipe(decodeBridgeValue("OpenCode connection details are invalid", OpenCodeInfoSchema)),
    getVersion: invoke("Failed to get the app version", () => api.getVersion()).pipe(
      decodeBridgeValue("Desktop app version is invalid", Schema.String),
    ),
    openUrl: (url) => invoke("Failed to open the URL", () => api.openUrl(url)),
    loadConfig: invoke("Failed to load configuration", () => api.loadConfig()).pipe(
      decodeBridgeValue("Desktop configuration is invalid", AppConfigSchema),
    ),
    patchConfig: (patch) => invoke("Failed to save configuration", () => api.patchConfig(patch)),
    checkForUpdate: invoke("Failed to check for updates", () => api.checkForUpdate()).pipe(
      decodeBridgeValue("Update information is invalid", Schema.NullOr(UpdateInfoSchema)),
    ),
    installUpdate: invoke("Failed to install the update", () => api.installUpdate()),
    invokeExplorerProgram: (artifact) =>
      invoke("Failed to invoke Explorer program", () => api.invokeExplorerProgram(artifact)).pipe(
        decodeBridgeValue("Explorer snapshot is invalid", ExplorerSnapshotSchema),
      ),
    invokeProjectIndexProgram: (artifact) =>
      invoke("Failed to invoke project index program", () =>
        api.invokeProjectIndexProgram(artifact),
      ).pipe(decodeBridgeValue("Project index skeleton is invalid", ProjectSkeletonSchema)),
    relaunch: invoke("Failed to relaunch the app", () => api.relaunch()),
    installStudioTargetPrograms: (envelopes) =>
      invoke("Failed to install Studio target programs", () =>
        api.installStudioTargetPrograms(envelopes),
      ).pipe(decodeBridgeValue("Studio target programs are invalid", StudioTargetProgramsSchema)),
    discoverStudioTargets: (programs) =>
      invoke("Failed to discover Studio targets", () => api.discoverStudioTargets(programs)).pipe(
        decodeBridgeValue("Studio target discovery is invalid", StudioTargetDiscoverySchema),
      ),
    selectStudioTarget: (programs, targetKey) =>
      invoke("Failed to select the Studio target", () =>
        api.selectStudioTarget(programs, targetKey),
      ).pipe(decodeBridgeValue("Studio target selection is invalid", StudioTargetSelectionSchema)),
    checkpointCapture: (context) =>
      invoke("Failed to capture checkpoint", () => api.checkpointCapture(context)).pipe(
        decodeBridgeValue("Checkpoint output is invalid", CheckpointSchema),
      ),
    checkpointRestore: (input) =>
      invoke("Failed to restore checkpoint", () => api.checkpointRestore(input)).pipe(
        decodeBridgeValue("Checkpoint restore result is invalid", CheckpointRestoreResultSchema),
      ),
    checkpointPreview: (checkpointId, sessionId) =>
      invoke("Failed to preview checkpoint", () =>
        api.checkpointPreview(checkpointId, sessionId),
      ).pipe(decodeBridgeValue("Checkpoint preview is invalid", RestorePreviewSchema)),
    checkpointList: (sessionId) =>
      invoke("Failed to list checkpoints", () => api.checkpointList(sessionId)).pipe(
        decodeBridgeValue("Checkpoint list is invalid", Schema.Array(CheckpointSchema)),
      ),
    checkpointValidate: () =>
      invoke("Failed to validate workspace", () => api.checkpointValidate()).pipe(
        decodeBridgeValue("Validation result is invalid", ValidationResultSchema),
      ),
    rojoStart: (workspace) => invoke("Failed to start Rojo", () => api.rojoStart(workspace)),
    rojoStop: () => invoke("Failed to stop Rojo", () => api.rojoStop()),
    rojoStatus: () => invoke("Failed to get Rojo status", () => api.rojoStatus()),
    rojoToggle: (workspace) => invoke("Failed to toggle Rojo", () => api.rojoToggle(workspace)),
    rojoLogs: () => invoke("Failed to get Rojo logs", () => api.rojoLogs()),
    onRojoLog: (listener) => api.onRojoLog(listener),
    rojoSetup: (onProgress) =>
      invoke("Failed to set up Rojo", () => api.rojoSetup(onProgress)),
    rojoBinaryPath: () => invoke("Failed to get Rojo binary path", () => api.rojoBinaryPath()),
    rojoCheckInstalled: () =>
      invoke("Failed to check Rojo installation", () => api.rojoCheckInstalled()),
  };
}

export const desktopEffects: DesktopEffects = window.BloxMind
  ? makeBridgeEffects(window.BloxMind)
  : browserEffects;

const runPromise = <A>(effect: Effect.Effect<A, DesktopError>): Promise<A> =>
  Effect.runPromise(effect);

/** Promise-only adapter consumed by React and exposed by the Electron bridge contract. */
export const desktop: DesktopApi = {
  compileExplorerProgram: (program) => runPromise(desktopEffects.compileExplorerProgram(program)),
  compileProjectIndexProgram: (program) =>
    runPromise(desktopEffects.compileProjectIndexProgram(program)),
  getOpenCodeInfo: () => runPromise(desktopEffects.getOpenCodeInfo),
  onOpenCodeStartupProgress: (listener: StartupProgressListener) =>
    window.BloxMind?.onOpenCodeStartupProgress(listener) ?? (() => {}),
  getVersion: () => runPromise(desktopEffects.getVersion),
  openUrl: (url) => runPromise(desktopEffects.openUrl(url)),
  loadConfig: () => runPromise(desktopEffects.loadConfig),
  patchConfig: (patch) => runPromise(desktopEffects.patchConfig(patch)),
  checkForUpdate: () => runPromise(desktopEffects.checkForUpdate),
  installUpdate: () => runPromise(desktopEffects.installUpdate),
  invokeExplorerProgram: (artifact) => runPromise(desktopEffects.invokeExplorerProgram(artifact)),
  invokeProjectIndexProgram: (artifact) =>
    runPromise(desktopEffects.invokeProjectIndexProgram(artifact)),
  relaunch: () => runPromise(desktopEffects.relaunch),
  installStudioTargetPrograms: (envelopes) =>
    runPromise(desktopEffects.installStudioTargetPrograms(envelopes)),
  discoverStudioTargets: (programs) => runPromise(desktopEffects.discoverStudioTargets(programs)),
  selectStudioTarget: (programs, targetKey) =>
    runPromise(desktopEffects.selectStudioTarget(programs, targetKey)),
  checkpointCapture: (context) => runPromise(desktopEffects.checkpointCapture(context)),
  checkpointRestore: (input) => runPromise(desktopEffects.checkpointRestore(input)),
  checkpointPreview: (checkpointId, sessionId) =>
    runPromise(desktopEffects.checkpointPreview(checkpointId, sessionId)),
  checkpointList: async (sessionId) => [
    ...(await runPromise(desktopEffects.checkpointList(sessionId))),
  ],
  checkpointValidate: () => runPromise(desktopEffects.checkpointValidate()),
  rojoStart: (workspace) => runPromise(desktopEffects.rojoStart(workspace)),
  rojoStop: () => runPromise(desktopEffects.rojoStop()),
  rojoStatus: () => runPromise(desktopEffects.rojoStatus()),
  rojoToggle: (workspace) => runPromise(desktopEffects.rojoToggle(workspace)),
  rojoLogs: () => runPromise(desktopEffects.rojoLogs()),
  onRojoLog: (listener) => desktopEffects.onRojoLog(listener),
  rojoSetup: (onProgress) => runPromise(desktopEffects.rojoSetup(onProgress)),
  rojoBinaryPath: () => runPromise(desktopEffects.rojoBinaryPath()),
  rojoCheckInstalled: () => runPromise(desktopEffects.rojoCheckInstalled()),
};
