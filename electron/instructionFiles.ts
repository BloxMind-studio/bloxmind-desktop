import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
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

/**
 * Windows refuses a rename onto a file another reader has open (EPERM, EBUSY,
 * EACCES) for a moment. Retry briefly, as graceful-fs does.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!transient || attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}

export async function readGlobalInstructions(globalConfigDirectory: string): Promise<string> {
  const target = globalInstructionFilePath(globalConfigDirectory);
  let content: string;
  try {
    content = await readFile(target, "utf8");
  } catch (error) {
    // A missing file is an empty draft; a corrupt or unreadable one is an error
    // the caller must surface instead of silently overwriting.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
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
  // Write next to the target and rename atomically, so a crash mid-write can
  // never leave a torn file; the temp name is unique per write.
  const temp = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temp, content, "utf8");
    await renameWithRetry(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * One-time seed: the engine used to load `~/BloxMind/AGENTS.md`, and BloxMind purged the
 * legacy-generated sections from it. Now that project files are off the table for the
 * engine, that file's content would be silently ignored — carry it over into the
 * engine-global AGENTS.md the first time this runs. Returns whether it migrated anything.
 */
export function migrateWorkspaceInstructionsToGlobalSync(
  workspace: string,
  globalConfigDirectory: string,
): boolean {
  const target = globalInstructionFilePath(globalConfigDirectory);
  if (existsSync(target)) return false;
  const source = join(workspace, "AGENTS.md");
  if (!existsSync(source)) return false;
  // Read the file with a cap so a corrupt or huge legacy file can't stall startup,
  // then write it atomically through the same pattern as a normal save.
  let size = 0;
  try {
    size = statSync(source).size;
  } catch {
    return false;
  }
  if (size > 4 * 1024 * 1024) return false;
  let content: string;
  try {
    content = readFileSync(source, "utf8");
  } catch {
    return false;
  }
  if (content.trim() === "") return false;
  if (content.length > GLOBAL_INSTRUCTIONS_MAX_LENGTH) {
    content = content.slice(0, GLOBAL_INSTRUCTIONS_MAX_LENGTH);
  }
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(temp, content, "utf8");
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(temp, target);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
        if (!transient || attempt >= 6) throw error;
        const waitUntil = Date.now() + 10 * 2 ** attempt;
        while (Date.now() < waitUntil) {}
      }
    }
    return true;
  } catch {
    rmSync(temp, { force: true });
    return false;
  }
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
