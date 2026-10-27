import { Schema } from "effect";
import type { BloxBotProgramManifest } from "../lib/bloxbotProgramManifest";
import type { ExplorerProgramEnvelope, ExplorerSnapshot } from "../lib/explorer";
import type { ProjectIndexProgramEnvelope, ProjectSkeleton } from "../lib/projectIndex";
import type {
  CaptureContext,
  Checkpoint,
  CheckpointRestoreInput,
  CheckpointRestoreResult,
  RestorePreview,
  ValidationResult,
} from "./checkpoints";
import type { GeneratedProgramArtifact } from "./generatedProgram";
import {
  type StudioTargetDiscovery,
  type StudioTargetProgramEnvelopes,
  type StudioTargetPrograms,
  StudioTargetProgramsSchema,
  StudioTargetSchema,
  type StudioTargetSelection,
} from "./studioTarget";

const MutableStrings = Schema.mutable(Schema.Array(Schema.String));

export const ThemePreferenceSchema = Schema.Literal("light", "dark", "system");
export const DetailedAnalyticsPreferenceSchema = Schema.Literal("unset", "enabled", "disabled");
export const AccentColorSchema = Schema.Literal("blue", "violet", "emerald", "rose", "amber");
export const LayoutDensitySchema = Schema.Literal("compact", "comfortable");

export type ThemePreference = typeof ThemePreferenceSchema.Type;
export type AccentColor = typeof AccentColorSchema.Type;
export type LayoutDensity = typeof LayoutDensitySchema.Type;

/**
 * One extra MCP server the user configured in Settings → Integrations. Shape
 * matches `McpServerConfig` in `src/lib/mcpServers.ts`, which holds the
 * validation and engine conversion.
 */
export const McpServerSchema = Schema.mutable(
  Schema.Struct({
    name: Schema.String,
    type: Schema.Literal("local", "remote"),
    command: Schema.NullOr(MutableStrings),
    url: Schema.NullOr(Schema.String),
    enabled: Schema.Boolean,
    // Optional so configs written before it existed still load.
    environment: Schema.optional(
      Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.String })),
    ),
  }),
);

/**
 * Version of the stored configuration shape. Bumped whenever loading an older
 * file must rewrite values; `migrateStoredConfig` applies the rewrites once and
 * persists the new version.
 */
export const APP_CONFIG_VERSION = 1;

export const AppConfigSchema = Schema.mutable(
  Schema.Struct({
    // Filled from defaults for configs written before the marker existed.
    configVersion: Schema.Number.pipe(Schema.int(), Schema.between(0, 1_000)),
    lastModel: Schema.NullOr(Schema.String),
    hiddenModels: MutableStrings,
    theme: ThemePreferenceSchema,
    detailedAnalytics: DetailedAnalyticsPreferenceSchema,
    // Highest analytics policy notice the user has seen; 0 predates the opt-out model.
    analyticsNoticeVersion: Schema.Number,
    defaultVariant: Schema.NullOr(Schema.String),
    studioTargetPrograms: Schema.NullOr(StudioTargetProgramsSchema),
    studioTargetsBySession: Schema.Record({ key: Schema.String, value: StudioTargetSchema }),
    // UI customization
    accentColor: AccentColorSchema,
    layoutDensity: LayoutDensitySchema,
    fontSize: Schema.Number.pipe(Schema.between(0.8, 1.2)),
    soundEffects: Schema.Boolean,
    // AI engine
    temperature: Schema.Number.pipe(Schema.between(0, 1)),
    // Output-token cap for the selected model; 0 leaves the model's own limit.
    maxTokens: Schema.Number.pipe(Schema.int(), Schema.between(0, 128_000)),
    systemPrompt: Schema.String,
    customApiEndpoint: Schema.NullOr(Schema.String),
    // Behavior
    autoScroll: Schema.Boolean,
    enterToSend: Schema.Boolean,
    notificationsEnabled: Schema.Boolean,
    // SSE connection
    sseReconnectDelay: Schema.Number.pipe(Schema.int(), Schema.between(1_000, 60_000)),
    sseHeartbeatTimeout: Schema.Number.pipe(Schema.int(), Schema.between(5_000, 120_000)),
    // Extra MCP servers (Settings → Integrations), e.g. the Blender bridge.
    mcpServers: Schema.mutable(Schema.Array(McpServerSchema)),
  }),
);

export type AppConfig = typeof AppConfigSchema.Type;

export const DEFAULT_APP_CONFIG: AppConfig = {
  configVersion: APP_CONFIG_VERSION,
  lastModel: null,
  hiddenModels: [],
  theme: "system",
  detailedAnalytics: "unset",
  analyticsNoticeVersion: 0,
  defaultVariant: null,
  studioTargetPrograms: null,
  studioTargetsBySession: {},
  accentColor: "blue",
  layoutDensity: "comfortable",
  fontSize: 1,
  soundEffects: true,
  temperature: 0.7,
  maxTokens: 0,
  systemPrompt: "",
  customApiEndpoint: null,
  autoScroll: true,
  enterToSend: true,
  notificationsEnabled: true,
  sseReconnectDelay: 3_000,
  sseHeartbeatTimeout: 30_000,
  mcpServers: [],
};

export const AppConfigPatchSchema = Schema.partial(AppConfigSchema);

export const OpenCodeInfoSchema = Schema.mutable(
  Schema.Struct({
    authorization: Schema.String,
    port: Schema.Number.pipe(Schema.int(), Schema.between(1, 65_535)),
    workspace: Schema.String,
  }),
);

export type OpenCodeInfo = typeof OpenCodeInfoSchema.Type;

export type OpenCodeStartupProgress =
  | { phase: "checking" }
  | {
      phase: "downloading";
      downloadedBytes: number;
      totalBytes: number | null;
      bytesPerSecond: number;
    }
  | { phase: "verifying" }
  | { phase: "installing" }
  | { phase: "starting" };

export const InstructionFileSchema = Schema.Struct({
  path: Schema.String,
  scope: Schema.Literal("global", "project"),
  chars: Schema.Number,
  content: Schema.String,
});

export type InstructionFile = typeof InstructionFileSchema.Type;

export const UpdateInfoSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.String,
    body: Schema.NullOr(Schema.String),
  }),
);

export type UpdateInfo = typeof UpdateInfoSchema.Type;

/**
 * Whether BloxBot could start Roblox Studio's MCP helper. `not_installed` means the helper
 * isn't on this computer, `unavailable` means it started but closed before it connected.
 */
export const StudioMcpStatusSchema = Schema.Struct({
  state: Schema.Literal("starting", "connected", "not_installed", "unavailable"),
});

export type StudioMcpStatus = typeof StudioMcpStatusSchema.Type;

/** A main-process error forwarded to the renderer, which reports it through PostHog. */
export interface MainErrorReport {
  source: string;
  name: string;
  message: string;
  stack?: string;
}

export interface DesktopApi {
  compileExplorerProgram(program: ExplorerProgramEnvelope): Promise<GeneratedProgramArtifact>;
  invokeExplorerProgram(
    artifact: GeneratedProgramArtifact,
    studioId: string,
  ): Promise<ExplorerSnapshot>;
  /** The Studio tools an Explorer program may call now, by Studio's own name. */
  listExplorerProgramTools(): Promise<readonly string[]>;
  compileProjectIndexProgram(
    program: ProjectIndexProgramEnvelope,
  ): Promise<GeneratedProgramArtifact>;
  invokeProjectIndexProgram(artifact: GeneratedProgramArtifact): Promise<ProjectSkeleton>;
  getOpenCodeInfo(): Promise<OpenCodeInfo>;
  /** The folder OpenCode installs into, for antivirus exclusions. Null outside the desktop app. */
  getOpenCodeInstallFolder(): Promise<string | null>;
  getStudioMcpStatus(): Promise<StudioMcpStatus>;
  onOpenCodeStartupProgress(listener: (progress: OpenCodeStartupProgress) => void): () => void;
  getVersion(): Promise<string>;
  getInstructionFiles(): Promise<readonly InstructionFile[]>;
  openUrl(url: string): Promise<void>;
  loadConfig(): Promise<AppConfig>;
  patchConfig(patch: Partial<AppConfig>): Promise<void>;
  checkForUpdate(): Promise<UpdateInfo | null>;
  installUpdate(): Promise<void>;
  relaunch(): Promise<void>;
  installStudioTargetPrograms(
    envelopes: StudioTargetProgramEnvelopes,
  ): Promise<StudioTargetPrograms>;
  discoverStudioTargets(programs: StudioTargetPrograms): Promise<StudioTargetDiscovery>;
  selectStudioTarget(
    programs: StudioTargetPrograms,
    targetKey: string,
  ): Promise<StudioTargetSelection>;
  /** The newest verified published BloxBot programs, or null to use the built-in ones. */
  getBloxBotPrograms(): Promise<BloxBotProgramManifest | null>;
  /** Called when newer published BloxBot programs arrive; returns an unsubscribe. */
  onBloxBotProgramsUpdated(listener: () => void): () => void;
  /**
   * Receives errors from the main process so the renderer can report them. Subscribing
   * tells the main process the window is ready, which flushes errors buffered until then.
   */
  onMainError(listener: (report: MainErrorReport) => void): () => void;
  checkpointCapture(context: CaptureContext): Promise<Checkpoint>;
  checkpointRestore(input: CheckpointRestoreInput): Promise<CheckpointRestoreResult>;
  checkpointPreview(checkpointId: string, sessionId: string): Promise<RestorePreview>;
  /** Whether the workspace differs from what this checkpoint captured. */
  checkpointChanged(checkpointId: string, sessionId: string): Promise<boolean>;
  checkpointList(sessionId: string): Promise<Checkpoint[]>;
  checkpointValidate(): Promise<ValidationResult>;
}
