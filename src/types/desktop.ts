import { Schema } from "effect";
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

// ── Apps Mode settings ────────────────────────────────────────────────────

export const AppsSettingsSchema = Schema.mutable(
  Schema.Struct({
    autoPreview: Schema.Boolean,
    autoRun: Schema.Boolean,
    defaultViewport: Schema.Literal("mobile", "desktop"),
    showFileTree: Schema.Boolean,
    showLineNumbers: Schema.Boolean,
  }),
);

export type AppsSettings = typeof AppsSettingsSchema.Type;

export const DEFAULT_APPS_SETTINGS: AppsSettings = {
  autoPreview: true,
  autoRun: false,
  defaultViewport: "desktop",
  showFileTree: true,
  showLineNumbers: true,
};

// ── Games Mode settings ───────────────────────────────────────────────────

export const GamesSettingsSchema = Schema.mutable(
  Schema.Struct({
    autoPreview: Schema.Boolean,
    autoRun: Schema.Boolean,
    showControlsHint: Schema.Boolean,
    showFileTree: Schema.Boolean,
    showLineNumbers: Schema.Boolean,
  }),
);

export type GamesSettings = typeof GamesSettingsSchema.Type;

export const DEFAULT_GAMES_SETTINGS: GamesSettings = {
  autoPreview: true,
  autoRun: false,
  showControlsHint: true,
  showFileTree: true,
  showLineNumbers: true,
};

// ── Agent Mode settings ────────────────────────────────────────────────────

export const AgentSettingsSchema = Schema.mutable(
  Schema.Struct({
    autoRunOnCreate: Schema.Boolean,
    showWorkflowCanvas: Schema.Boolean,
    showAgentSidebar: Schema.Boolean,
    enableLogging: Schema.Boolean,
    autoSaveDrafts: Schema.Boolean,
  }),
);

export type AgentSettings = typeof AgentSettingsSchema.Type;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  autoRunOnCreate: false,
  showWorkflowCanvas: true,
  showAgentSidebar: true,
  enableLogging: true,
  autoSaveDrafts: true,
};

// ── Rojo live-sync types ────────────────────────────────────────────────

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

export type RojoInstallPhase =
  | "release-lookup"
  | "binary-download"
  | "binary-extract"
  | "plugin-download"
  | "plugin-install"
  | "done";

export interface RojoInstallProgress {
  phase: RojoInstallPhase;
  percent?: number;
  message: string;
}

export interface RojoInstallResult {
  version: string;
  binaryPath: string;
  pluginPath: string;
}

const MutableStrings = Schema.mutable(Schema.Array(Schema.String));

export const ThemePreferenceSchema = Schema.Literal("light", "dark", "system");
export const DetailedAnalyticsPreferenceSchema = Schema.Literal("unset", "enabled", "disabled");
export const AccentColorSchema = Schema.Literal(
  "blue",
  "violet",
  "indigo",
  "emerald",
  "rose",
  "amber",
);
export const LayoutDensitySchema = Schema.Literal("compact", "comfortable");
export const FontStyleSchema = Schema.Literal(
  "quiet",
  "rounded",
  "classic",
  "mono",
  "serif",
  "humanist",
);
export const ThemePresetSchema = Schema.Literal("soft-blue", "dark-neon", "emerald", "custom");
export const ThemeColorsSchema = Schema.mutable(
  Schema.Struct({
    // Soft background highlight for active/selected items.
    selectedBg: Schema.String,
    // Text color inside selected items.
    selectedFg: Schema.String,
    // Background overlay when hovering interactive elements.
    hoverBg: Schema.String,
    // Text color when hovering interactive elements.
    hoverFg: Schema.String,
  }),
);

export type ThemePreference = typeof ThemePreferenceSchema.Type;
export type AccentColor = typeof AccentColorSchema.Type;
export type LayoutDensity = typeof LayoutDensitySchema.Type;
export type FontStyle = typeof FontStyleSchema.Type;
export type ThemePreset = typeof ThemePresetSchema.Type;
export type ThemeColors = typeof ThemeColorsSchema.Type;

export const AppModeSchema = Schema.Literal("roblox", "agent", "apps", "games");
export type AppMode = typeof AppModeSchema.Type;

export const AppConfigSchema = Schema.mutable(
  Schema.Struct({
    lastModel: Schema.NullOr(Schema.String),
    hiddenModels: MutableStrings,
    theme: ThemePreferenceSchema,
    detailedAnalytics: DetailedAnalyticsPreferenceSchema,
    defaultVariant: Schema.NullOr(Schema.String),
    studioTargetPrograms: Schema.NullOr(StudioTargetProgramsSchema),
    studioTargetsBySession: Schema.Record({ key: Schema.String, value: StudioTargetSchema }),
    // UI customization
    accentColor: AccentColorSchema,
    layoutDensity: LayoutDensitySchema,
    fontSize: Schema.Number.pipe(Schema.between(0.8, 1.2)),
    fontStyle: FontStyleSchema,
    soundEffects: Schema.Boolean,
    themePreset: ThemePresetSchema,
    themeColors: ThemeColorsSchema,
    // Sidepanel layout persistence
    sidebarCollapsed: Schema.Boolean,
    explorerCollapsed: Schema.Boolean,
    // AI engine
    temperature: Schema.Number.pipe(Schema.between(0, 1)),
    maxTokens: Schema.Number.pipe(Schema.int(), Schema.between(256, 128_000)),
    systemPrompt: Schema.String,
    customApiEndpoint: Schema.NullOr(Schema.String),
    // Behavior
    autoScroll: Schema.Boolean,
    enterToSend: Schema.Boolean,
    notificationsEnabled: Schema.Boolean,
    // Workspace mode
    activeMode: AppModeSchema,
    // SSE connection
    sseReconnectDelay: Schema.Number.pipe(Schema.int(), Schema.between(1_000, 60_000)),
    sseHeartbeatTimeout: Schema.Number.pipe(Schema.int(), Schema.between(5_000, 120_000)),
    // Mode-specific settings
    appsSettings: AppsSettingsSchema,
    agentSettings: AgentSettingsSchema,
    gamesSettings: GamesSettingsSchema,
  }),
);

export type AppConfig = typeof AppConfigSchema.Type;

export const DEFAULT_APP_CONFIG: AppConfig = {
  lastModel: null,
  hiddenModels: [],
  theme: "system",
  detailedAnalytics: "unset",
  defaultVariant: null,
  studioTargetPrograms: null,
  studioTargetsBySession: {},
  accentColor: "emerald",
  layoutDensity: "comfortable",
  fontSize: 1,
  fontStyle: "quiet",
  soundEffects: true,
  themePreset: "dark-neon",
  themeColors: {
    selectedBg: "#39FF14",
    selectedFg: "#000000",
    hoverBg: "#E0E0E0",
    hoverFg: "#000000",
  },
  sidebarCollapsed: false,
  explorerCollapsed: false,
  temperature: 0.7,
  maxTokens: 4_096,
  systemPrompt: "",
  customApiEndpoint: null,
  autoScroll: true,
  enterToSend: true,
  notificationsEnabled: true,
  activeMode: "roblox",
  sseReconnectDelay: 3_000,
  sseHeartbeatTimeout: 30_000,
  appsSettings: {
    autoPreview: true,
    autoRun: false,
    defaultViewport: "desktop",
    showFileTree: true,
    showLineNumbers: true,
  },
  agentSettings: {
    autoRunOnCreate: false,
    showWorkflowCanvas: true,
    showAgentSidebar: true,
    enableLogging: true,
    autoSaveDrafts: true,
  },
  gamesSettings: {
    autoPreview: true,
    autoRun: false,
    showControlsHint: true,
    showFileTree: true,
    showLineNumbers: true,
  },
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

export const UpdateInfoSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.String,
    body: Schema.NullOr(Schema.String),
  }),
);

export type UpdateInfo = typeof UpdateInfoSchema.Type;

export interface DesktopApi {
  compileExplorerProgram(program: ExplorerProgramEnvelope): Promise<GeneratedProgramArtifact>;
  invokeExplorerProgram(artifact: GeneratedProgramArtifact): Promise<ExplorerSnapshot>;
  compileProjectIndexProgram(
    program: ProjectIndexProgramEnvelope,
  ): Promise<GeneratedProgramArtifact>;
  invokeProjectIndexProgram(artifact: GeneratedProgramArtifact): Promise<ProjectSkeleton>;
  getOpenCodeInfo(): Promise<OpenCodeInfo>;
  onOpenCodeStartupProgress(listener: (progress: OpenCodeStartupProgress) => void): () => void;
  getVersion(): Promise<string>;
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
  checkpointCapture(context: CaptureContext): Promise<Checkpoint>;
  checkpointRestore(input: CheckpointRestoreInput): Promise<CheckpointRestoreResult>;
  checkpointPreview(checkpointId: string, sessionId: string): Promise<RestorePreview>;
  checkpointList(sessionId: string): Promise<Checkpoint[]>;
  checkpointValidate(): Promise<ValidationResult>;
  rojoStart(workspace: string): Promise<RojoStatus>;
  rojoStop(): Promise<void>;
  rojoStatus(): Promise<RojoStatus>;
  rojoToggle(workspace: string): Promise<RojoStatus>;
  rojoLogs(): Promise<RojoLogEntry[]>;
  onRojoLog(listener: (entry: RojoLogEntry) => void): () => void;
  rojoSetup(onProgress: (progress: RojoInstallProgress) => void): Promise<RojoInstallResult>;
  rojoBinaryPath(): Promise<string | null>;
  rojoCheckInstalled(): Promise<boolean>;
  windowMinimize(): Promise<void>;
  windowMaximizeToggle(): Promise<void>;
  windowClose(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void;
}
