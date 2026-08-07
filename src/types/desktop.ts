import { Schema } from "effect";
import type {
  CaptureContext,
  Checkpoint,
  CheckpointRestoreInput,
  CheckpointRestoreResult,
  RestorePreview,
  ValidationResult,
} from "./checkpoints";
import type { ExplorerProgramEnvelope, ExplorerSnapshot } from "../lib/explorer";
import type { ProjectIndexProgramEnvelope, ProjectSkeleton } from "../lib/projectIndex";
import type { GeneratedProgramArtifact } from "./generatedProgram";
import {
  type StudioTargetDiscovery,
  type StudioTargetProgramEnvelopes,
  type StudioTargetPrograms,
  StudioTargetProgramsSchema,
  StudioTargetSchema,
  type StudioTargetSelection,
} from "./studioTarget";

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

export type ThemePreference = typeof ThemePreferenceSchema.Type;

export const AppConfigSchema = Schema.mutable(
  Schema.Struct({
    lastModel: Schema.NullOr(Schema.String),
    hiddenModels: MutableStrings,
    theme: ThemePreferenceSchema,
    detailedAnalytics: DetailedAnalyticsPreferenceSchema,
    defaultVariant: Schema.NullOr(Schema.String),
    studioTargetPrograms: Schema.NullOr(StudioTargetProgramsSchema),
    studioTargetsBySession: Schema.Record({ key: Schema.String, value: StudioTargetSchema }),
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
}
