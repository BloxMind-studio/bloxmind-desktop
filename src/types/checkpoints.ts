import { Schema } from "effect";

// ── Checkpoint System Shared Types ──────────────────────────────────────
// These types are shared between the Electron main process (service that
// performs git/fs operations) and the sandboxed renderer (UI orchestration).

export const FileOperationSchema = Schema.Literal("modify", "create", "delete", "rename");
export type FileOperation = typeof FileOperationSchema.Type;

export const FileChangeSchema = Schema.mutable(
  Schema.Struct({
    path: Schema.String, // POSIX-style relative path from workspace root
    operation: FileOperationSchema,
    preHash: Schema.String, // sha256 of the pre-state bytes
    /**
     * Inline journal payload. New captures store the pre-image in a
     * content-addressed blob instead (see `preBlob`) so the session index stays
     * small; this field is what checkpoints written by older builds carry and
     * is still honoured on restore.
     */
    preContent: Schema.NullOr(Schema.String),
    /** Content-addressed blob holding the pre-image bytes (sha256 filename). */
    preBlob: Schema.optionalWith(Schema.NullOr(Schema.String), {
      default: () => null,
    }),
    /**
     * How the payload is encoded. Binary files are journalled as base64 so a
     * restore writes the original bytes instead of UTF-8 replacement chars.
     * Older checkpoints predate this field and are UTF-8.
     */
    preEncoding: Schema.optionalWith(Schema.Literal("utf8", "base64"), {
      default: () => "utf8" as const,
    }),
  }),
);
export type FileChange = typeof FileChangeSchema.Type;

export const CheckpointKindSchema = Schema.Literal("pre-exec", "auto-rollback", "manual-restore");
export type CheckpointKind = typeof CheckpointKindSchema.Type;

export const CheckpointSchema = Schema.mutable(
  Schema.Struct({
    id: Schema.String, // nanoid e.g. "cp_x7f2..."
    parentId: Schema.NullOr(Schema.String), // DAG history tree
    timestamp: Schema.Number,
    sessionId: Schema.String,
    messageId: Schema.NullOr(Schema.String), // ties to OpenCode message
    kind: CheckpointKindSchema,
    tool: Schema.NullOr(Schema.String),
    paths: Schema.Array(FileChangeSchema),
    gitRef: Schema.NullOr(Schema.String), // git stash create ref
    failureLog: Schema.NullOr(Schema.String),
    /** True when this checkpoint is a full-workspace snapshot (captured with no explicit paths). */
    fullSnapshot: Schema.Boolean,
  }),
);
export type Checkpoint = typeof CheckpointSchema.Type;

export const ValidationModeSchema = Schema.Literal("blocking-syntax", "background-full");
export type ValidationMode = typeof ValidationModeSchema.Type;

export const ValidationResultSchema = Schema.mutable(
  Schema.Struct({
    ok: Schema.Boolean,
    fastGatePassed: Schema.Boolean,
    fullGatePassed: Schema.Boolean,
    logs: Schema.String,
  }),
);
export type ValidationResult = typeof ValidationResultSchema.Type;

// CaptureContext — the agent mutation we are about to perform.
export const CaptureContextSchema = Schema.mutable(
  Schema.Struct({
    sessionId: Schema.String,
    messageId: Schema.NullOr(Schema.String),
    tool: Schema.NullOr(Schema.String),
    paths: Schema.Array(Schema.String),
  }),
);
export type CaptureContext = typeof CaptureContextSchema.Type;

// RestoreOptions — how the restore should behave.
export const RestoreOptionsSchema = Schema.partial(
  Schema.Struct({
    preserveUserEdits: Schema.Boolean, // stash unrelated user changes and re-apply
  }),
);
export type RestoreOptions = typeof RestoreOptionsSchema.Type;

// PreviewSegment — one file that would change during a dry-run.
export const RestorePreviewSchema = Schema.mutable(
  Schema.Struct({
    segments: Schema.Array(
      Schema.mutable(
        Schema.Struct({
          path: Schema.String,
          operation: FileOperationSchema,
        }),
      ),
    ),
    restoredId: Schema.String,
    message: Schema.String,
  }),
);
export type RestorePreview = typeof RestorePreviewSchema.Type;

/** IPC input for checkpoint restore */
export const CheckpointRestoreInputSchema = Schema.Struct({
  checkpointId: Schema.String,
  sessionId: Schema.String,
  dryRun: Schema.Boolean,
  preserveUserEdits: Schema.Boolean,
});
export type CheckpointRestoreInput = typeof CheckpointRestoreInputSchema.Type;

/** IPC return shape for a full restore */
export const CheckpointRestoreResultSchema = Schema.mutable(
  Schema.Struct({
    restoredId: Schema.String,
    message: Schema.String,
    filesChanged: Schema.Array(Schema.String),
  }),
);
export type CheckpointRestoreResult = typeof CheckpointRestoreResultSchema.Type;
