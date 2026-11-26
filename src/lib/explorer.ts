import { Effect, Schema } from "effect";
import type { OpencodeClient } from "@/lib/opencode";
import type { GeneratedProgramArtifact, GeneratedProgramEnvelope } from "../types/generatedProgram";
import { STUDIO_MCP_SERVER_NAME } from "./bloxmindProgramManifest";
import { ASK_ALL_PERMISSIONS, rejectPermissions } from "./hiddenSession";
import { type ModelError, modelErrorDetail } from "./modelError";
import { extractStructuredOutput } from "./structuredOutput";

export const ExplorerFieldSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  // Optional hints so a read value can be shown the way Studio shows it.
  type: Schema.optional(Schema.String),
  numeric: Schema.optional(Schema.Boolean),
  /** Whether Studio accepts a change to this field. */
  writable: Schema.optional(Schema.Boolean),
  /** Studio's grouping, like Transform or Appearance. */
  category: Schema.optional(Schema.String),
  /** Choices for enums and BrickColors. */
  options: Schema.optional(Schema.Array(Schema.String)),
  /** Colors for each BrickColor choice. */
  swatches: Schema.optional(Schema.Array(Schema.String)),
});

export type ExplorerField = typeof ExplorerFieldSchema.Type;

export const ExplorerNodeDetailsSchema = Schema.Struct({
  properties: Schema.Array(ExplorerFieldSchema),
  attributes: Schema.Array(ExplorerFieldSchema),
  locked: Schema.optional(Schema.Boolean),
  /** Read without a script to keep Studio's redo, so computed values are missing. */
  limited: Schema.optional(Schema.Literal("redo", "failed")),
  tags: Schema.optional(Schema.Array(Schema.String)),
  placeTags: Schema.optional(Schema.Array(Schema.String)),
});
export type ExplorerNodeDetails = typeof ExplorerNodeDetailsSchema.Type;

export const ExplorerDetailsRequestSchema = Schema.Struct({
  path: Schema.String,
  className: Schema.optional(Schema.String),
  occurrence: Schema.optional(Schema.Number),
});
export type ExplorerDetailsRequest = typeof ExplorerDetailsRequestSchema.Type;

export const ExplorerNodeSchema = Schema.Struct({
  /** Tells apart objects that share a path. The path alone is what a message or a person sees. */
  id: Schema.optional(Schema.String),
  occurrence: Schema.optional(Schema.Number),
  occurrences: Schema.optional(Schema.Number),
  name: Schema.String,
  className: Schema.String,
  path: Schema.String,
  hasChildren: Schema.Boolean,
  /** Its children come in their own update, so anything already there stays until then. */
  pending: Schema.optional(Schema.Boolean),
  properties: Schema.Array(ExplorerFieldSchema),
  attributes: Schema.Array(ExplorerFieldSchema),
  children: Schema.Array(Schema.suspend((): Schema.Schema<ExplorerNode> => ExplorerNodeSchema)),
  // The identifier lets the recursive schema be written out as JSON Schema
  // (for `pnpm bloxmind-programs brief`).
}).annotations({ identifier: "ExplorerNode" });

export interface ExplorerNode {
  readonly id?: string;
  readonly occurrence?: number;
  readonly occurrences?: number;
  readonly name: string;
  readonly className: string;
  readonly path: string;
  readonly hasChildren: boolean;
  readonly pending?: boolean;
  readonly properties: readonly ExplorerField[];
  readonly attributes: readonly ExplorerField[];
  readonly children: readonly ExplorerNode[];
}

// Roblox Studio sorts Explorer rows by ReflectionMetadataClass.ExplorerOrder,
// then class, then Instance.Name. Unknown classes use Model's neutral band.
const EXPLORER_ORDER: Readonly<Record<string, number>> = {
  Workspace: 5,
  Camera: 5,
  Terrain: 5,
  Actor: 10,
  Folder: 10,
  Players: 20,
  Attachment: 30,
  Humanoid: 30,
  Lighting: 30,
  MaterialService: 30,
  NetworkClient: 30,
  ReplicatedFirst: 30,
  ReplicatedStorage: 30,
  Script: 30,
  ServerScriptService: 30,
  ServerStorage: 30,
  SpawnLocation: 30,
  StarterGui: 30,
  StarterPack: 30,
  StarterPlayer: 30,
  Tool: 30,
  LocalScript: 40,
  RemoteFunction: 40,
  BindableFunction: 40,
  Decal: 40,
  Texture: 40,
  ModuleScript: 50,
  RemoteEvent: 50,
  BindableEvent: 50,
  Model: 100,
  MeshPart: 105,
  UnionOperation: 105,
  Part: 110,
  TrussPart: 120,
  WedgePart: 120,
  Teams: 140,
  ScreenGui: 140,
  BillboardGui: 140,
  SurfaceGui: 140,
  Frame: 150,
  ImageButton: 160,
  TextButton: 170,
  ImageLabel: 180,
  TextLabel: 190,
  Configuration: 220,
  SoundService: 500,
  TextChatService: 511,
};

const explorerCollator = new Intl.Collator(undefined, { sensitivity: "base" });

export function sortExplorerNodes(nodes: readonly ExplorerNode[]): readonly ExplorerNode[] {
  return nodes
    .map((node) => ({ ...node, children: sortExplorerNodes(node.children) }))
    .sort((left, right) => {
      const order =
        (EXPLORER_ORDER[left.className] ?? 100) - (EXPLORER_ORDER[right.className] ?? 100);
      if (order !== 0) return order;
      const classOrder = explorerCollator.compare(left.className, right.className);
      return classOrder !== 0 ? classOrder : explorerCollator.compare(left.name, right.name);
    });
}

export function nodeId(node: Pick<ExplorerNode, "id" | "path">): string {
  return node.id ?? node.path;
}

export const ExplorerWaitSchema = Schema.Literal(
  "studio_closed",
  "no_place",
  "mode_changed",
  "place_loading",
);
export type ExplorerWait = typeof ExplorerWaitSchema.Type;

/** One changed part of the tree: the new children of an object, or the services for null. */
export const ExplorerTreeUpdateSchema = Schema.Struct({
  studioId: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  children: Schema.Array(ExplorerNodeSchema),
  placeName: Schema.optional(Schema.String),
});
export type ExplorerTreeUpdate = typeof ExplorerTreeUpdateSchema.Type;

export const ExplorerSyncRequestSchema = Schema.Struct({
  fresh: Schema.Boolean,
  force: Schema.Boolean,
});
export type ExplorerSyncRequest = typeof ExplorerSyncRequestSchema.Type;

export const ExplorerSyncResultSchema = Schema.Struct({
  changed: Schema.Boolean,
  /** Studio says when the tree changes, so there's no need to read it until it does. */
  watching: Schema.Boolean,
  complete: Schema.Boolean,
  truncated: Schema.Boolean,
  slowestReadMs: Schema.Number,
  waiting: Schema.optional(ExplorerWaitSchema),
});
export type ExplorerSyncResult = typeof ExplorerSyncResultSchema.Type;

/** The tree as updates build it up. Objects are found by id, and changed in place. */
export interface ExplorerTree {
  readonly placeName: string;
  readonly roots: readonly ExplorerNode[];
  readonly byId: ReadonlyMap<string, ExplorerNode>;
}

export function emptyExplorerTree(): ExplorerTree {
  return { placeName: "", roots: [], byId: new Map() };
}

/**
 * Applies updates to a tree. Only the changed parts are touched, so this stays cheap in a big place.
 */
export function applyExplorerUpdates(
  tree: ExplorerTree,
  updates: readonly Pick<ExplorerTreeUpdate, "parentId" | "children" | "placeName">[],
): ExplorerTree {
  const byId = tree.byId as Map<string, ExplorerNode>;
  let { placeName, roots } = tree;
  const forget = (nodes: readonly ExplorerNode[]) => {
    for (const node of nodes) {
      byId.delete(nodeId(node));
      forget(node.children);
    }
  };
  const remember = (nodes: readonly ExplorerNode[]) => {
    for (const node of nodes) {
      byId.set(nodeId(node), node);
      remember(node.children);
    }
  };
  for (const update of updates) {
    placeName = update.placeName ?? placeName;
    const parent = update.parentId === null ? null : byId.get(update.parentId);
    if (parent === undefined) continue;
    const before = parent ? parent.children : roots;
    const held = new Map(before.map((node) => [nodeId(node), node]));
    const next = update.children.map((node) => {
      const old = node.pending ? held.get(nodeId(node)) : undefined;
      return old ? { ...node, children: old.children } : node;
    });
    forget(before);
    remember(next);
    if (parent) Object.assign(parent, { children: next, pending: false });
    else roots = next;
  }
  return { placeName, roots: [...roots], byId };
}

export interface ExplorerRow {
  readonly node: ExplorerNode;
  readonly depth: number;
  readonly position: number;
  readonly siblings: number;
  readonly loading?: boolean;
}

/** The rows on screen for what's expanded, one list for however deep the tree goes. */
export function explorerRows(
  roots: readonly ExplorerNode[],
  expanded: ReadonlySet<string>,
): ExplorerRow[] {
  const rows: ExplorerRow[] = [];
  const add = (nodes: readonly ExplorerNode[], depth: number) => {
    nodes.forEach((node, index) => {
      rows.push({ node, depth, position: index + 1, siblings: nodes.length });
      if (!expanded.has(nodeId(node))) return;
      if (node.children.length > 0) add(node.children, depth + 1);
      else if (node.pending) {
        rows.push({ node, depth: depth + 1, position: 1, siblings: 1, loading: true });
      }
    });
  };
  add(roots, 0);
  return rows;
}

export function sortExplorerSnapshot(snapshot: ExplorerSnapshot): ExplorerSnapshot {
  return { ...snapshot, roots: sortExplorerNodes(snapshot.roots) };
}

/** The numbers inside a value like "1, 2, 3" or a CFrame's rotation. */
export function fieldNumbers(value: string): string[] {
  return value.split(/[\s,;{}()]+/).filter(Boolean);
}

/** Shortens numbers with more than 3 decimals, and very big or tiny ones to an exponent. */
export function shortenNumber(text: string): string {
  if (text === "-0") return "0";
  if (!/^-?\d+\.\d{4,}(?:e[-+]?\d+)?$/i.test(text)) return text;
  const number = Number(text);
  const size = Math.abs(number);
  // Rotations leave noise like 8.7e-15 behind where the value is really zero.
  if (size < 1e-9) return "0";
  if (size >= 1e15 || size < 0.001) return number.toExponential(2);
  return String(Number(number.toFixed(3)));
}

/** The same short numbers everywhere a numeric value is shown or copied. */
export function readableFieldValue(field: ExplorerField): string {
  return field.numeric
    ? field.value.replace(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi, shortenNumber)
    : field.value;
}

/**
 * A value as people want to read it: `Enum.CameraType.Fixed` as "Fixed", a
 * CFrame by its position, a Color3 in 0 to 255, and numbers with more than
 * three decimals shortened. The exact value stays in the row's title.
 */
export function formatFieldValue(field: ExplorerField): string {
  const { value, type } = field;
  if (value === "" && (type === "Instance" || type === "PhysicalProperties")) {
    return type === "Instance" ? "None" : "Default";
  }
  if (type === "Color3") {
    return fieldNumbers(value)
      .slice(0, 3)
      .map((part) => Math.round(Number(part) * 255))
      .join(", ");
  }
  if (type === "CFrame") return fieldNumbers(value).slice(0, 3).map(shortenNumber).join(", ");
  if (!type || type === "EnumItem") {
    const enumItem = /^Enum\.\w+\.(\w+)$/.exec(value);
    if (enumItem) return enumItem[1];
  }
  return readableFieldValue(field);
}

export const ExplorerSnapshotSchema = Schema.Struct({
  placeName: Schema.String,
  capturedAt: Schema.String,
  roots: Schema.Array(ExplorerNodeSchema),
});

export type ExplorerSnapshot = typeof ExplorerSnapshotSchema.Type;

export const ATTRIBUTE_TYPES = [
  "string",
  "boolean",
  "number",
  "Vector3",
  "Vector2",
  "Color3",
  "BrickColor",
  "CFrame",
  "UDim",
  "UDim2",
  "NumberRange",
  "Rect",
  "NumberSequence",
  "ColorSequence",
] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

const ObjectNameSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100));
const FieldNameSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));
const EditedObjectFields = {
  occurrence: Schema.optional(Schema.Number),
  occurrences: Schema.optional(Schema.Number),
  path: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(65_536)),
  className: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
};

/** One read-only-in-Snapshot change someone asks BloxMind to make in Studio. */
export const ExplorerEditSchema = Schema.Union(
  Schema.Struct({
    action: Schema.Literal("rename"),
    name: ObjectNameSchema,
    ...EditedObjectFields,
  }),
  Schema.Struct({ action: Schema.Literal("duplicate", "delete"), ...EditedObjectFields }),
  Schema.Struct({
    action: Schema.Literal("setField"),
    kind: Schema.Literal("property", "attribute"),
    field: FieldNameSchema,
    value: Schema.String.pipe(Schema.maxLength(200_000)),
    valueType: Schema.String.pipe(Schema.maxLength(64)),
    ...EditedObjectFields,
  }),
  Schema.Struct({
    action: Schema.Literal("addAttribute"),
    field: FieldNameSchema,
    valueType: Schema.Literal(...ATTRIBUTE_TYPES),
    ...EditedObjectFields,
  }),
  Schema.Struct({
    action: Schema.Literal("removeAttribute", "addTag", "removeTag"),
    field: FieldNameSchema,
    ...EditedObjectFields,
  }),
);
export type ExplorerEdit = typeof ExplorerEditSchema.Type;

export const ExplorerEditResultSchema = Schema.Struct({ name: Schema.String });
export type ExplorerEditResult = typeof ExplorerEditResultSchema.Type;

export const EXPLORER_CONTRACT = {
  name: "explorer-snapshot",
  version: "1",
  inputSchemaVersion: "explorer-input-v1",
  outputSchemaVersion: "explorer-snapshot-v1",
} as const;

export const ExplorerProgramEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  contract: Schema.Struct({
    name: Schema.Literal(EXPLORER_CONTRACT.name),
    version: Schema.Literal(EXPLORER_CONTRACT.version),
    inputSchemaVersion: Schema.Literal(EXPLORER_CONTRACT.inputSchemaVersion),
    outputSchemaVersion: Schema.Literal(EXPLORER_CONTRACT.outputSchemaVersion),
  }),
  source: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100_000)),
});

export type ExplorerProgramEnvelope = typeof ExplorerProgramEnvelopeSchema.Type;

export interface ExplorerCollection {
  readonly program: GeneratedProgramEnvelope;
  /** Where the program came from, which decides how a later failure recovers. */
  readonly origin: "published" | "builtin" | "model";
  readonly artifact: GeneratedProgramArtifact;
  readonly snapshot: ExplorerSnapshot;
}

const FIELD_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "value"],
  properties: {
    name: { type: "string" },
    value: { type: "string" },
    type: { type: "string" },
    numeric: { type: "boolean" },
  },
} as const;

const NODE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "className", "path", "hasChildren", "properties", "attributes", "children"],
  properties: {
    name: { type: "string" },
    className: { type: "string" },
    path: { type: "string" },
    hasChildren: { type: "boolean" },
    properties: { type: "array", items: FIELD_JSON_SCHEMA, maxItems: 16 },
    attributes: { type: "array", items: FIELD_JSON_SCHEMA, maxItems: 24 },
    children: { type: "array", items: { $ref: "#/$defs/node" } },
  },
} as const;

const SNAPSHOT_PROPERTIES = {
  placeName: { type: "string" },
  capturedAt: { type: "string" },
  roots: { type: "array", items: { $ref: "#/$defs/node" } },
} as const;

export const EXPLORER_PROGRAM_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "contract", "source"],
  properties: {
    version: { const: 1 },
    contract: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version", "inputSchemaVersion", "outputSchemaVersion"],
      properties: {
        name: { const: EXPLORER_CONTRACT.name },
        version: { const: EXPLORER_CONTRACT.version },
        inputSchemaVersion: { const: EXPLORER_CONTRACT.inputSchemaVersion },
        outputSchemaVersion: { const: EXPLORER_CONTRACT.outputSchemaVersion },
      },
    },
    source: { type: "string", minLength: 1, maxLength: 100_000 },
  },
} as const;

export const EXPLORER_SNAPSHOT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["placeName", "capturedAt", "roots"],
  properties: SNAPSHOT_PROPERTIES,
  $defs: { node: NODE_JSON_SCHEMA },
} as const;

/**
 * The system prompt for writing an Explorer program. It names the tools the
 * runtime lets the program call, by Studio's own name: in its own session the
 * model sees them with OpenCode's server prefix (roblox-studio_search_game_tree).
 */
export function explorerSystemPrompt(allowedTools: readonly string[]): string {
  return `You generate the private TypeScript data provider for BloxMind's Explorer panel.
Write an import-free deterministic read-only TypeScript program and reply with a single JSON value, the complete envelope described below. Do not call any Studio tool yourself: tool calls in this session are rejected. Read the tools' parameters from your own tool list instead.
The source must define async function run({ input, callTool }), require input.studioId, and return an Explorer snapshot matching the requested output contract. It must never modify the place.
The program may only call these tools, by exactly these names: ${allowedTools.join(", ")}. The runtime refuses any other tool. Use these names in callTool even though your own tool list shows them with a "${STUDIO_MCP_SERVER_NAME}_" prefix. Pass { studio_id: input.studioId } on every Studio-specific tool call. The tree read leaves properties empty on services and Terrain; when inspect_instance is available, read those nodes with it to fill properties and attributes (each field has name, value, optional type and numeric). Ignore a tool that isn't available or returns an error.
callTool resolves to a raw MCP CallToolResult ({ content, isError }). When isError is true, content holds Studio's error text; it does not throw. Tool output is usually JSON inside a text content part, sometimes after a note, so parse it defensively.
The JSON value you reply with must be exactly this object shape (no extra properties), where "source" is the complete program source as one JSON string:
${JSON.stringify({ version: 1, contract: EXPLORER_CONTRACT, source: "..." })}
The words import and export must not appear anywhere in the source, not even in comments or strings. Use only standard JavaScript globals; there is no network or file access.
The value run returns must be JSON-safe and match this JSON Schema exactly, with no extra properties:
${JSON.stringify(EXPLORER_SNAPSHOT_OUTPUT_SCHEMA)}
Do not run a recurring model-mediated replay. The app will compile this source once and invoke it directly for every refresh.
For every object include a compact set of useful, readable properties and all available attributes. Stringify values safely.
Use each instance's Name property for node.name. Use ClassName only for node.className and type/icon metadata.
Request the deepest complete hierarchy and a very high result limit supported by the tree tool; do not accept shallow defaults.
Paths are dot-separated human-readable hints, not durable identifiers. Keep children in Studio order.
Reply with a single JSON value matching the envelope above. Never call any other tool yourself.`;
}

/** At most this many programs are written per attempt, the first plus one retry. */
export const MAX_EXPLORER_GENERATIONS = 2;

/** A failed model-written program, with how many programs the model wrote. */
export class ExplorerGenerationError extends Error {
  constructor(
    readonly cause: unknown,
    readonly attempts: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ExplorerGenerationError";
  }
}

/** The model's reply carried an error instead of a program. */
export class ExplorerModelError extends Error {
  constructor(
    message: string,
    readonly modelErrorName: string,
  ) {
    super(message);
    this.name = "ExplorerModelError";
  }
}

/**
 * Whether a model error means only that no structured program came back, so a
 * reminder may help. Provider errors (auth, quota, rate limit) won't.
 */
function isMissingOutputError(error: ModelError): boolean {
  return error.name === "StructuredOutputError";
}

interface ExplorerModel {
  providerID: string;
  modelID: string;
}

export interface GenerateExplorerProgramOptions<T> {
  model?: ExplorerModel;
  agent?: string | null;
  /** The tools the runtime lets the program call, by Studio's own name. */
  allowedTools: readonly string[];
  /**
   * Compiles the program and runs it once. A failure goes back to the model,
   * which writes one more program.
   */
  validate: (program: ExplorerProgramEnvelope) => Promise<T>;
}

export interface GeneratedExplorerProgram<T> {
  program: ExplorerProgramEnvelope;
  result: T;
  /** How many programs the model wrote. */
  attempts: number;
}

async function withPrivateSession<T>(
  client: OpencodeClient,
  run: (sessionID: string) => Promise<T>,
): Promise<T> {
  const created = await client.session.create(
    {
      title: "BloxMind Explorer sync",
      metadata: { BloxMindHidden: true, purpose: "explorer" },
      // Tools stay in the request so the model can read the tool list, but every
      // tool call is rejected and the session never waits on an approval.
      permission: ASK_ALL_PERMISSIONS,
    },
    { throwOnError: true },
  );
  const sessionID = created.data.id;

  const stopRejecting = rejectPermissions(client, sessionID);
  try {
    return await run(sessionID);
  } finally {
    stopRejecting();
    await client.session.delete({ sessionID }, { throwOnError: true }).catch(() => undefined);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Has the model write an Explorer program in a private session and checks it
 * with validate before accepting it. When the check fails, the error goes back
 * to the model in the same session for one corrected program.
 */
export async function generateExplorerProgram<T>(
  client: OpencodeClient,
  { model, agent, allowedTools, validate }: GenerateExplorerProgramOptions<T>,
): Promise<GeneratedExplorerProgram<T>> {
  let attempts = 0;
  try {
    return await withPrivateSession(client, async (sessionID) => {
      let request =
        "Write the reusable TypeScript Explorer program and reply with a single JSON value matching the envelope.";
      for (;;) {
        const response = await client.session.prompt(
          {
            sessionID,
            model,
            agent: agent ?? undefined,
            system: explorerSystemPrompt(allowedTools),
            format: { type: "json_schema", schema: EXPLORER_PROGRAM_OUTPUT_SCHEMA, retryCount: 2 },
            parts: [{ type: "text", text: request }],
          },
          { throwOnError: true },
        );
        // Counts replies from the model, not prompts that failed to send.
        attempts += 1;
        const modelError = response.data.info.error;
        if (modelError && !isMissingOutputError(modelError)) {
          throw new ExplorerModelError(
            modelErrorDetail(modelError) ?? "The model didn't answer.",
            modelError.name,
          );
        }
        try {
          if (modelError) {
            throw new ExplorerModelError(
              modelErrorDetail(modelError) ?? "The model did not return a program.",
              modelError.name,
            );
          }
          const program = await Effect.runPromise(
            Schema.decodeUnknown(ExplorerProgramEnvelopeSchema)(
              extractStructuredOutput(response.data),
            ),
          );
          return { program, result: await validate(program), attempts };
        } catch (error) {
          if (attempts >= MAX_EXPLORER_GENERATIONS) throw error;
          request =
            error instanceof ExplorerModelError
              ? `Your reply did not contain the program: ${errorMessage(error)}
Reply with a single JSON value matching the envelope. Do not call any Studio tool yourself.`
              : `BloxMind compiled and ran your program once, and it failed: ${errorMessage(error)}
Fix the cause and reply with the complete corrected program as a single JSON value. The program may call only these tools, by exactly these names: ${allowedTools.join(", ")}.`;
        }
      }
    });
  } catch (error) {
    throw new ExplorerGenerationError(error, attempts);
  }
}

export function createExplorerReference(node: ExplorerNode): string {
  return (
    `Regarding the ${node.className} at \`${node.path}\`: ` +
    "treat this path only as a hint. Rediscover the object in the connected place and verify its identity and current state immediately before taking any action."
  );
}

/**
 * Names in a place, for turning inline code in a reply back into an object. A path always
 * resolves; a name only when one object has it, so a shared name can't open the wrong one.
 */
export function indexExplorerObjects(roots: readonly ExplorerNode[]) {
  const byName = new Map<string, ExplorerNode | null>();
  const byPath = new Map<string, ExplorerNode>();
  const visit = (node: ExplorerNode) => {
    byName.set(node.name, byName.has(node.name) ? null : node);
    byPath.set(node.path, node);
    byPath.set(node.path.replace(/^game\./, ""), node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return new Map([...byName, ...byPath]);
}

/** Studio's own state keeping the tree from being read, which clears up without anything failing. */
export const EXPLORER_WAIT_NOTICES: Record<ExplorerWait, string> = {
  studio_closed: "Studio closed. Reopen it to continue.",
  no_place: "No place open. Open one in Studio.",
  mode_changed: "Playtest starting or stopping. Back in a moment.",
  place_loading: "Place still loading. Back in a moment.",
};

/** For when "back in a moment" has stopped being true. */
export const EXPLORER_LONG_WAIT_NOTICES: Partial<Record<ExplorerWait, string>> = {
  mode_changed: "Can't read Studio during this playtest. Stop it to see objects.",
  place_loading: "This place is slow to load. Still trying.",
};

/** Best-effort mapping of Studio's error text to the state that caused it. */
export function explorerWaitFromError(error: unknown): ExplorerWait | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/place is not open|no place/i.test(message)) return "no_place";
  if (/studio_id is not connected|studio.*not connected/i.test(message)) return "studio_closed";
  if (/playtest/i.test(message)) return "mode_changed";
  if (/still loading|not ready/i.test(message)) return "place_loading";
  return null;
}

export type ExplorerFieldKind = "property" | "attribute";
export type ExplorerReferenceKind = ExplorerFieldKind | "tag";

/** An object, or one of its fields, to mention in a message. */
export interface ExplorerReference {
  readonly name: string;
  readonly path: string;
  readonly field?: { readonly kind: ExplorerReferenceKind; readonly name: string };
}

/** What an object dragged out of Explorer carries: its path, which the message box looks up. */
export const OBJECT_DRAG_TYPE = "application/x-bloxmind-object";
export const OBJECT_DRAG_NAME_TYPE = "application/x-bloxmind-object-name";
