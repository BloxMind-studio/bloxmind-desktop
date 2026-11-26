import { Schema } from "effect";
import type { BloxMindProgramManifest } from "../lib/bloxmindProgramManifest";

export type { ExplorerTreeUpdate } from "../lib/explorer";

import type {
  ExplorerDetailsRequest,
  ExplorerEdit,
  ExplorerEditResult,
  ExplorerNodeDetails,
  ExplorerProgramEnvelope,
  ExplorerSnapshot,
  ExplorerSyncRequest,
  ExplorerSyncResult,
  ExplorerTreeUpdate,
} from "../lib/explorer";
import type { ProjectIndexProgramEnvelope, ProjectSkeleton } from "../lib/projectIndex";
import { DEFAULT_VERIFICATION_LEVEL, VerificationLevelSchema } from "../lib/verification";
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

export const NotificationKindsSchema = Schema.Struct({
  finished: Schema.Boolean,
  waiting: Schema.Boolean,
  failed: Schema.Boolean,
  app: Schema.Boolean,
});

export type NotificationKinds = typeof NotificationKindsSchema.Type;

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
    // Models refused in the user's region, so they aren't picked again.
    unavailableModels: MutableStrings,
    theme: ThemePreferenceSchema,
    detailedAnalytics: DetailedAnalyticsPreferenceSchema,
    // Highest analytics policy notice the user has seen; 0 predates the opt-out model.
    analyticsNoticeVersion: Schema.Number,
    defaultVariant: Schema.NullOr(Schema.String),
    studioTargetPrograms: Schema.NullOr(StudioTargetProgramsSchema),
    studioTargetsBySession: Schema.Record({ key: Schema.String, value: StudioTargetSchema }),
    // Someone chose to get on with non-Studio work instead of setting it up.
    studioSetupSkipped: Schema.Boolean,
    // Chats explicitly set aside for work that has nothing to do with Studio.
    chatsWithoutStudio: MutableStrings,
    // Chats someone picked a Studio for by hand, so the place isn't just a guess.
    chatsWithChosenPlace: MutableStrings,
    // The Studio a chat's message was routed to, even if nobody saw it happen.
    routedTargetsBySession: Schema.Record({ key: Schema.String, value: StudioTargetSchema }),
    // UI customization
    accentColor: AccentColorSchema,
    layoutDensity: LayoutDensitySchema,
    fontSize: Schema.Number.pipe(Schema.between(0.8, 1.2)),
    soundEffects: Schema.Boolean,
    // AI engine
    temperature: Schema.Number.pipe(Schema.between(0, 1)),
    // Output-token cap for the selected model; 0 leaves the model's own limit.
    maxTokens: Schema.Number.pipe(Schema.int(), Schema.between(0, 128_000)),
    // Summarize older messages when the context window fills up.
    autoCompaction: Schema.Boolean,
    systemPrompt: Schema.String,
    customApiEndpoint: Schema.NullOr(Schema.String),
    // How much checking the assistant does after a change (Settings → Behavior).
    verificationLevel: VerificationLevelSchema,
    // Behavior
    autoScroll: Schema.Boolean,
    enterToSend: Schema.Boolean,
    notificationsEnabled: Schema.Boolean,
    // Separate kinds only matter once someone has chosen them; null follows the defaults.
    notificationKinds: Schema.NullOr(NotificationKindsSchema),
    notificationSound: Schema.Boolean,
    notificationsOffered: Schema.Boolean,
    // GitHub star callout: counted prompts until it has been shown, then left alone.
    promptsSent: Schema.Number.pipe(Schema.int(), Schema.between(0, 1_000_000)),
    starCalloutShown: Schema.Boolean,
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
  unavailableModels: [],
  theme: "system",
  detailedAnalytics: "unset",
  analyticsNoticeVersion: 0,
  defaultVariant: null,
  studioTargetPrograms: null,
  studioTargetsBySession: {},
  studioSetupSkipped: false,
  chatsWithoutStudio: [],
  chatsWithChosenPlace: [],
  routedTargetsBySession: {},
  accentColor: "blue",
  layoutDensity: "comfortable",
  fontSize: 1,
  soundEffects: true,
  temperature: 0.7,
  maxTokens: 0,
  autoCompaction: true,
  systemPrompt: "",
  customApiEndpoint: null,
  verificationLevel: DEFAULT_VERIFICATION_LEVEL,
  autoScroll: true,
  enterToSend: true,
  notificationsEnabled: true,
  notificationKinds: null,
  notificationSound: true,
  notificationsOffered: false,
  promptsSent: 0,
  starCalloutShown: false,
  sseReconnectDelay: 3_000,
  sseHeartbeatTimeout: 30_000,
  mcpServers: [],
};

export const AppConfigPatchSchema = Schema.partial(AppConfigSchema);

export const SystemNotificationSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
});

export type SystemNotification = typeof SystemNotificationSchema.Type;

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
 * Whether BloxMind could start Roblox Studio's MCP helper. `not_installed` means the helper
 * isn't on this computer, `unavailable` means it started but closed before it connected.
 */
export const StudioMcpStatusSchema = Schema.Struct({
  state: Schema.Literal("starting", "connected", "not_installed", "helper_missing", "unavailable"),
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
  /** Reads the place in the main process, sending parts back as they arrive. */
  syncExplorerTree(studioId: string, request: ExplorerSyncRequest): Promise<ExplorerSyncResult>;
  onExplorerTreeUpdate(listener: (update: ExplorerTreeUpdate) => void): () => void;
  /** Full property/attribute surface for one object, read without clearing Studio's redo. */
  getExplorerNodeDetails(
    studioId: string,
    request: ExplorerDetailsRequest,
  ): Promise<ExplorerNodeDetails | null>;
  /** Makes one change to an object in the open Studio place. */
  editExplorerObject(studioId: string, edit: ExplorerEdit): Promise<ExplorerEditResult>;
  invokeExplorerProgram(
    artifact: GeneratedProgramArtifact,
    studioId: string,
  ): Promise<ExplorerSnapshot>;
  /** The Studio tools an Explorer program may call now, by Studio's own name. */
  listExplorerProgramTools(): Promise<readonly string[]>;
  compileProjectIndexProgram(
    program: ProjectIndexProgramEnvelope,
  ): Promise<GeneratedProgramArtifact>;
  invokeProjectIndexProgram(
    artifact: GeneratedProgramArtifact,
    studioId: string,
  ): Promise<ProjectSkeleton>;
  getOpenCodeInfo(): Promise<OpenCodeInfo>;
  /** The folder OpenCode installs into, for antivirus exclusions. Null outside the desktop app. */
  getOpenCodeInstallFolder(): Promise<string | null>;
  getStudioMcpStatus(): Promise<StudioMcpStatus>;
  onOpenCodeStartupProgress(listener: (progress: OpenCodeStartupProgress) => void): () => void;
  getVersion(): Promise<string>;
  getInstructionFiles(): Promise<readonly InstructionFile[]>;
  /** The engine-global AGENTS.md — applies to every session in any project. */
  getInstructions(): Promise<string>;
  /** Saves the engine-global AGENTS.md; the engine picks it up on the next prompt. */
  saveInstructions(content: string): Promise<void>;
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
  /** The newest verified published BloxMind programs, or null to use the built-in ones. */
  getBloxMindPrograms(): Promise<BloxMindProgramManifest | null>;
  /** Called when newer published BloxMind programs arrive; returns an unsubscribe. */
  onBloxMindProgramsUpdated(listener: () => void): () => void;
  /**
   * Receives errors from the main process so the renderer can report them. Subscribing
   * tells the main process the window is ready, which flushes errors buffered until then.
   */
  onMainError(listener: (report: MainErrorReport) => void): () => void;
  /** Blender tools, installed on this computer so the AI can make 3D models. */
  getBlenderToolsState(): Promise<BlenderToolsState>;
  /** Resolves once setup finishes; rejects with a BlenderFailureReason in the message. */
  installBlenderTools(): Promise<void>;
  cancelBlenderTools(): Promise<void>;
  openBlender(): Promise<void>;
  removeBlenderTools(): Promise<void>;
  onBlenderSetupProgress(listener: (progress: BlenderSetupProgress) => void): () => void;
  /** What this Studio can do about uploads. Runs no script, so it can be asked in the background. */
  getUploadAccess(studioKey: string | null, modelUrl: string | null): Promise<UploadAccess>;
  /** Null when the link isn't a model file BloxMind can read. */
  readModelFile(url: string): Promise<ModelFileInfo | null>;
  /** `hash` is the file the person looked at, and nothing else gets sent. */
  uploadModelToPlace(
    url: string,
    studioKey: string,
    hash: string,
    addOnly?: boolean,
  ): Promise<ModelUploadResult>;
  onModelUploadStep(listener: (url: string, step: ModelUploadStep) => void): () => void;
  notifyResponseReady(): Promise<void>;
  /** Resolves to false when the OS won't show it, e.g. permission was denied. */
  showSystemNotification(notification: SystemNotification): Promise<boolean>;
  onSystemNotificationClick(listener: (id: string) => void): () => void;
  /** Opens the page where the system lets people allow BloxMind's notifications. */
  openNotificationSettings(): Promise<void>;
  checkpointCapture(context: CaptureContext): Promise<Checkpoint>;
  checkpointRestore(input: CheckpointRestoreInput): Promise<CheckpointRestoreResult>;
  checkpointPreview(checkpointId: string, sessionId: string): Promise<RestorePreview>;
  /** Whether the workspace differs from what this checkpoint captured. */
  checkpointChanged(checkpointId: string, sessionId: string): Promise<boolean>;
  checkpointList(sessionId: string): Promise<Checkpoint[]>;
  checkpointValidate(): Promise<ValidationResult>;
}

export type UploadAccessState =
  | "no_studio"
  /** Several Studios are open and this chat hasn't picked one. */
  | "choose_studio"
  /** This Studio was open before Roblox's update, and doesn't have Open Cloud until it's reopened. */
  | "reopen_studio"
  /** Permissions are per game, so a place that isn't published can't have any. */
  | "not_published"
  | "needs_permission"
  /** Studio only uploads from folders someone has approved. */
  | "needs_folder"
  /** Uploads send a copy saved next to the model, and BloxMind can't save in its folder. */
  | "folder_unwritable"
  /** Studio couldn't get a sign-in Roblox accepts, which no permission fixes. */
  | "refused"
  | "ready";

export interface UploadAccess {
  state: UploadAccessState;
  readOn: boolean;
  writeOn: boolean;
  /** The folder to approve in Studio: where this model is, or where the AI exports models. */
  folder: string;
  folderUrl: string;
}

export interface ModelFileInfo {
  name: string;
  fileName: string;
  path: string;
  folder: string;
  data: Uint8Array;
  kind: "fbx" | "glb";
  sizeBytes: number;
  hash: string;
  /** What already happened to exactly these bytes. */
  sent: { assetId: string | null; moderation: "approved" | "rejected" | "checking" } | null;
}

export type ModelUploadStep = "uploading" | "checking" | "adding";

export type ModelUploadFailure =
  | "no_file"
  | "file_changed"
  | "refused"
  | "rate_limited"
  | "file_rejected"
  | "folder_unwritable"
  | "other_owner"
  | "place_changed"
  | "studio_error";

/** Why an approved model wasn't put in the place, when BloxMind can tell. */
export type NotAddedReason = "place_changed" | "playtest";

export type ModelUploadResult =
  | { status: "added"; assetId: string; path: string }
  | { status: "rejected"; assetId: string }
  | { status: "checking"; assetId: string }
  | { status: "not_added"; assetId: string; reason?: NotAddedReason }
  | { status: "needs_setup"; access: UploadAccessState }
  | { status: "needs_folder"; folder: string }
  | { status: "failed"; reason: ModelUploadFailure };

export type BlenderSetupStep = "downloading" | "unpacking" | "connecting";

export interface BlenderSetupProgress {
  step: BlenderSetupStep;
  downloadedBytes: number;
  totalBytes: number;
}

export type BlenderFailureReason = "disk_full" | "network" | "blocked" | "corrupt" | "other";

export type BlenderToolsState =
  | { state: "unsupported" }
  | { state: "not_installed" }
  | { state: "installing"; progress: BlenderSetupProgress | null }
  | { state: "ready"; running: boolean };
