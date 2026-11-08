import { Schema } from "effect";

import {
  GENERATED_PROGRAM_VERSION,
  type GeneratedProgramEnvelope,
  GeneratedProgramEnvelopeSchema,
} from "../types/generatedProgram";

// BloxMind programs are the small TypeScript programs BloxMind runs against the
// Studio MCP (Explorer, Studio discovery and selection). Their sources live in
// bloxmind-programs/, are built into bloxmind-programs/manifest.json (shipped with
// the app as the built-in fallback), and are published signed so BloxMind can
// pick up fixes for Studio MCP changes without an app release.

export const BLOXMIND_PROGRAM_MANIFEST_FORMAT = 1 as const;

/**
 * The program contracts this app version can run. A published program is only
 * used when its contract matches exactly, so a program written for a newer
 * contract never runs in an app that doesn't understand its output.
 */
export const BLOXMIND_PROGRAM_CONTRACTS = {
  "explorer-snapshot": {
    name: "explorer-snapshot",
    version: "1",
    inputSchemaVersion: "explorer-input-v1",
    outputSchemaVersion: "explorer-snapshot-v1",
  },
  "studio-target-discovery": {
    name: "studio-target-discovery",
    version: "1",
    inputSchemaVersion: "1",
    outputSchemaVersion: "1",
  },
  "studio-target-selection": {
    name: "studio-target-selection",
    version: "1",
    inputSchemaVersion: "1",
    outputSchemaVersion: "1",
  },
} as const;

export type BloxMindProgramName = keyof typeof BLOXMIND_PROGRAM_CONTRACTS;

export const BLOXMIND_PROGRAM_NAMES = Object.keys(
  BLOXMIND_PROGRAM_CONTRACTS,
) as BloxMindProgramName[];

/**
 * Studio MCP tools each program is known to use. Beyond these, a program may
 * call any tool Studio itself marks read-only (see isBloxMindProgramToolAllowed),
 * so a renamed or new read-only tool works without an app release.
 */
export const BLOXMIND_PROGRAM_TOOLS: Record<BloxMindProgramName, readonly string[]> = {
  "explorer-snapshot": [
    "list_roblox_studios",
    "get_studio_state",
    "search_game_tree",
    "inspect_instance",
  ],
  "studio-target-discovery": ["list_roblox_studios"],
  "studio-target-selection": ["list_roblox_studios"],
};

/**
 * The project-index contract. Its programs are compiled by the app itself
 * (the built-in indexer, or one the AI generates) rather than published
 * through the manifest, so it is not part of {@link BLOXMIND_PROGRAM_CONTRACTS}.
 */
export const PROJECT_INDEX_PROGRAM_NAME = "project-index";

/** Studio MCP tools the project index program reads the place with. */
export const PROJECT_INDEX_PROGRAM_TOOLS: readonly string[] = ["search_game_tree", "script_read"];

/**
 * Every contract the app knows, with the tools it is known to use. A contract
 * outside this map gets no tools at all; each one here may additionally call
 * any tool Studio itself marks read-only (see isBloxMindProgramToolAllowed).
 */
const PROGRAM_TOOLS: Record<string, readonly string[]> = {
  ...BLOXMIND_PROGRAM_TOOLS,
  [PROJECT_INDEX_PROGRAM_NAME]: PROJECT_INDEX_PROGRAM_TOOLS,
};

export const BloxMindProgramManifestSchema = Schema.Struct({
  format: Schema.Literal(BLOXMIND_PROGRAM_MANIFEST_FORMAT),
  /** Increases with every published change; the app never goes back to a lower one. */
  sequence: Schema.Number.pipe(Schema.int(), Schema.positive()),
  programs: Schema.Record({ key: Schema.String, value: GeneratedProgramEnvelopeSchema }),
});

export type BloxMindProgramManifest = typeof BloxMindProgramManifestSchema.Type;

export interface BloxMindProgramSources {
  /** Helpers shared by every program, prepended to each source. */
  lib: string;
  programs: Record<BloxMindProgramName, string>;
}

/** Builds the manifest the app ships and the release workflow signs. */
export function buildBloxMindProgramManifest(
  sources: BloxMindProgramSources,
  sequence: number,
): BloxMindProgramManifest {
  const programs: Record<string, GeneratedProgramEnvelope> = {};
  for (const name of BLOXMIND_PROGRAM_NAMES) {
    programs[name] = {
      version: GENERATED_PROGRAM_VERSION,
      contract: { ...BLOXMIND_PROGRAM_CONTRACTS[name] },
      source: `${sources.lib.trimEnd()}\n\n${sources.programs[name].trim()}\n`,
    };
  }
  return { format: BLOXMIND_PROGRAM_MANIFEST_FORMAT, sequence, programs };
}

/** Same bytes every time for the same manifest, so signatures are stable. */
export function serializeBloxMindProgramManifest(manifest: BloxMindProgramManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The programs in a manifest this app can run: known names whose contract
 * matches exactly. Anything else is ignored, and the caller falls back.
 */
export function usableBloxMindPrograms(
  manifest: BloxMindProgramManifest,
): Partial<Record<BloxMindProgramName, GeneratedProgramEnvelope>> {
  const usable: Partial<Record<BloxMindProgramName, GeneratedProgramEnvelope>> = {};
  for (const name of BLOXMIND_PROGRAM_NAMES) {
    const envelope = manifest.programs[name];
    if (!envelope) continue;
    const expected = BLOXMIND_PROGRAM_CONTRACTS[name];
    const actual = envelope.contract;
    if (
      actual.name === expected.name &&
      actual.version === expected.version &&
      actual.inputSchemaVersion === expected.inputSchemaVersion &&
      actual.outputSchemaVersion === expected.outputSchemaVersion
    ) {
      usable[name] = envelope;
    }
  }
  return usable;
}

/** The MCP tool annotations Studio sends with its tool list. */
export interface StudioToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

/** Whether the app recognizes this program contract at all. */
export function isBloxMindProgramContract(contractName: string): boolean {
  return contractName in PROGRAM_TOOLS;
}

/** The tools a known contract may call without asking Studio for annotations. */
export function knownBloxMindProgramTools(contractName: string): readonly string[] {
  return PROGRAM_TOOLS[contractName] ?? [];
}

/** Whether a program may call a tool without asking Studio for its annotations. */
export function isKnownBloxMindProgramTool(contractName: string, toolName: string): boolean {
  return knownBloxMindProgramTools(contractName).includes(toolName);
}

/**
 * Whether Studio says a tool only reads the place: read-only and explicitly
 * closed-world (so not http_get, which reaches the internet). MCP treats a
 * missing openWorldHint as open-world, so an unlabelled tool doesn't qualify.
 */
export function isReadOnlyStudioTool(annotations?: StudioToolAnnotations): boolean {
  return annotations?.readOnlyHint === true && annotations.openWorldHint === false;
}

/**
 * Whether a program may call a Studio tool, whoever wrote the program. Programs
 * only read: they get the tools they're known to use, plus any tool Studio marks
 * read-only. Programs for contracts this app doesn't know get nothing.
 */
export function isBloxMindProgramToolAllowed(
  contractName: string,
  toolName: string,
  annotations?: StudioToolAnnotations,
): boolean {
  if (!isBloxMindProgramContract(contractName)) return false;
  return isKnownBloxMindProgramTool(contractName, toolName) || isReadOnlyStudioTool(annotations);
}

/**
 * The name OpenCode knows the Studio MCP server by. OpenCode shows the model
 * Studio's tools as `roblox-studio_<tool>`, so a model-written program may use
 * that form.
 */
export const STUDIO_MCP_SERVER_NAME = "roblox-studio";

const STUDIO_TOOL_PREFIX = `${STUDIO_MCP_SERVER_NAME}_`;

/** Studio's own name for a tool, without the prefix OpenCode adds. */
export function studioToolName(name: string): string {
  return name.startsWith(STUDIO_TOOL_PREFIX) ? name.slice(STUDIO_TOOL_PREFIX.length) : name;
}

/**
 * The tools Studio lists that a program may call: the ones it is known to use
 * plus any Studio marks read-only. The brief and the Explorer generation prompt
 * both list these.
 */
export function allowedBloxMindProgramTools<
  T extends { name: string; annotations?: StudioToolAnnotations },
>(program: string, tools: readonly T[]): T[] {
  return tools.filter((tool) => isBloxMindProgramToolAllowed(program, tool.name, tool.annotations));
}
