import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import type { InstructionFile } from "../src/types/desktop";

const MAX_INSTRUCTION_LENGTH = 32_000;
const PROJECT_INSTRUCTION_NAMES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"];

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Directories from `start` up to the enclosing git root, or the filesystem root. */
async function ancestors(start: string): Promise<string[]> {
  const directories: string[] = [];
  let current = resolve(start);
  while (true) {
    directories.push(current);
    if (await exists(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

/** Home-relative, forward-slash paths so analytics rows match across platforms. */
function displayPath(path: string, home: string): string {
  const relative =
    path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
  return sep === "\\" ? relative.replaceAll("\\", "/") : relative;
}

/**
 * Mirrors OpenCode's instruction lookup for analytics snapshots: the first global file that exists,
 * plus every ancestor match of the first project file name that exists. The engine itself runs with
 * project-config isolation (see OPENCODE_DISABLE_PROJECT_CONFIG), so ancestor matches are not what the
 * engine reads — this reports what is on disk. Nested instruction files are attached by OpenCode to
 * read tool output instead.
 */
export async function findInstructionFiles(options: {
  workspace: string;
  globalConfigDirectory: string;
  home: string;
}): Promise<InstructionFile[]> {
  const found: Array<{ path: string; scope: InstructionFile["scope"] }> = [];

  for (const path of [
    join(options.globalConfigDirectory, "AGENTS.md"),
    join(options.home, ".claude", "CLAUDE.md"),
  ]) {
    if (await exists(path)) {
      found.push({ path, scope: "global" });
      break;
    }
  }

  const directories = await ancestors(options.workspace);
  for (const name of PROJECT_INSTRUCTION_NAMES) {
    const matches: string[] = [];
    for (const directory of directories) {
      const path = join(directory, name);
      if (await exists(path)) matches.push(path);
    }
    if (matches.length > 0) {
      for (const path of matches) found.push({ path, scope: "project" });
      break;
    }
  }

  const files = await Promise.all(
    found.map(async ({ path, scope }) => {
      const content = await readFile(path, "utf8").catch(() => "");
      return {
        path: displayPath(path, options.home),
        scope,
        chars: content.length,
        content:
          content.length > MAX_INSTRUCTION_LENGTH
            ? `${content.slice(0, MAX_INSTRUCTION_LENGTH)}… [truncated]`
            : content,
      };
    }),
  );
  return files.filter((file) => file.content.length > 0);
}

/** Max size of the engine-global AGENTS.md, same limit the engine itself enforces. */
export const GLOBAL_INSTRUCTIONS_MAX_LENGTH = 32_000;

/** Absolute path of the AGENTS.md the engine reads from its global config directory. */
export function globalInstructionFilePath(globalConfigDirectory: string): string {
  return join(globalConfigDirectory, "AGENTS.md");
}

export async function readGlobalInstructions(globalConfigDirectory: string): Promise<string> {
  const content = await readFile(globalInstructionFilePath(globalConfigDirectory), "utf8").catch(
    () => "",
  );
  return content.length > GLOBAL_INSTRUCTIONS_MAX_LENGTH
    ? content.slice(0, GLOBAL_INSTRUCTIONS_MAX_LENGTH)
    : content;
}

export async function writeGlobalInstructions(
  globalConfigDirectory: string,
  content: unknown,
): Promise<void> {
  if (typeof content !== "string") throw new Error("Global instructions must be a string.");
  if (content.length > GLOBAL_INSTRUCTIONS_MAX_LENGTH) {
    throw new Error(
      `Global instructions must be at most ${GLOBAL_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-US")} characters.`,
    );
  }
  const target = globalInstructionFilePath(globalConfigDirectory);
  await mkdir(dirname(target), { recursive: true });
  // Write next to the target and rename, so a crash mid-write never leaves a torn file.
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, "utf8");
  await rename(temp, target);
}

/**
 * One-time seed: the engine used to load `~/BloxMind/AGENTS.md`, and BloxMind purged the
 * legacy-generated sections from it. Now that project files are off the table for the
 * engine, that file's content would be silently ignored — carry it over into the
 * engine-global AGENTS.md the first time this runs. Returns whether it migrated anything.
 */
/** One-time seed: the engine used to load `~/BloxMind/AGENTS.md`, and BloxMind purged the
 * legacy-generated sections from it. Now that project files are off the table for the
 * engine, that file's content would be silently ignored — carry it over into the
 * engine-global AGENTS.md the first time this runs. Returns whether it migrated anything. */
export function migrateWorkspaceInstructionsToGlobalSync(
  workspace: string,
  globalConfigDirectory: string,
): boolean {
  const target = globalInstructionFilePath(globalConfigDirectory);
  if (existsSync(target)) return false;
  const source = join(workspace, "AGENTS.md");
  if (!existsSync(source)) return false;
  const content = readFileSync(source, "utf8");
  if (content.trim() === "") return false;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return true;
}

const MANAGED_BLOCK_BEGIN = "<!-- bloxmind-managed:begin -->";
const MANAGED_BLOCK_END = "<!-- bloxmind-managed:end -->";

/**
 * Removes the legacy BloxMind-managed conventions block from a workspace
 * AGENTS.md. Older builds wrote that block — including now-retired Rojo
 * live-sync and default.project.json rules — into the file, and OpenCode
 * loads the workspace AGENTS.md into every session, so a leftover copy keeps
 * steering the model toward Rojo. User-authored content around the markers is
 * preserved; a file that holds only the generated heading and block is
 * deleted. Returns whether anything changed.
 */
export async function stripLegacyManagedBlock(workspace: string): Promise<boolean> {
  const target = join(workspace, "AGENTS.md");
  const content = await readFile(target, "utf8").catch(() => null);
  if (content === null) return false;

  const begin = content.indexOf(MANAGED_BLOCK_BEGIN);
  const end = content.indexOf(MANAGED_BLOCK_END);
  if (begin === -1 || end <= begin) return false;

  const remainder = `${content.slice(0, begin)}${content.slice(end + MANAGED_BLOCK_END.length)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (remainder === "" || remainder === "# BloxMind Project") {
    await rm(target, { force: true });
    return true;
  }

  await writeFile(target, `${remainder}\n`, "utf8");
  return true;
}
