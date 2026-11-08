import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import {
  BLOXMIND_PROGRAM_NAMES,
  type BloxMindProgramManifest,
  BloxMindProgramManifestSchema,
  type BloxMindProgramName,
  type BloxMindProgramSources,
  buildBloxMindProgramManifest,
} from "../../src/lib/bloxmindProgramManifest";

export const PROGRAMS_DIR = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  "bloxmind-programs",
);
export const MANIFEST_PATH = join(PROGRAMS_DIR, "manifest.json");

/** Reads a program file with LF line endings, whatever the checkout used. */
export async function readProgramFile(path: string): Promise<string> {
  return (await readFile(join(PROGRAMS_DIR, path), "utf8")).replace(/\r\n/g, "\n");
}

export async function readSources(): Promise<BloxMindProgramSources> {
  const programs = {} as Record<BloxMindProgramName, string>;
  for (const name of BLOXMIND_PROGRAM_NAMES) programs[name] = await readProgramFile(`${name}.ts`);
  return { lib: await readProgramFile("lib/mcp.ts"), programs };
}

export async function readShippedManifest(): Promise<BloxMindProgramManifest | null> {
  try {
    return Schema.decodeUnknownSync(BloxMindProgramManifestSchema)(
      JSON.parse(await readProgramFile("manifest.json")),
    );
  } catch {
    return null;
  }
}

export function samePrograms(a: { programs: unknown }, b: { programs: unknown }): boolean {
  return JSON.stringify(a.programs) === JSON.stringify(b.programs);
}

/**
 * The manifest for the current sources. The sequence only moves when they
 * change, and then past the published one too, so programs an app ships are
 * never outranked by an older published copy (for example after a revert).
 */
export async function expectedManifest(publishedSequence = 0): Promise<BloxMindProgramManifest> {
  const sources = await readSources();
  const shipped = await readShippedManifest();
  const unchanged = validated(buildBloxMindProgramManifest(sources, shipped?.sequence ?? 1));
  if (shipped && samePrograms(shipped, unchanged)) return shipped;
  return validated(
    buildBloxMindProgramManifest(sources, Math.max(shipped?.sequence ?? 0, publishedSequence) + 1),
  );
}

/**
 * Checks the built manifest against the schema the app decodes it with, so a
 * program that only fails once the shared helpers are prepended (the envelope
 * size limit) is caught here rather than shipped or published.
 */
export function validated(manifest: BloxMindProgramManifest): BloxMindProgramManifest {
  try {
    return Schema.decodeUnknownSync(BloxMindProgramManifestSchema)(manifest);
  } catch (error) {
    throw new Error(
      `The built manifest would be rejected by the app: ${error instanceof Error ? error.message : error}`,
    );
  }
}
