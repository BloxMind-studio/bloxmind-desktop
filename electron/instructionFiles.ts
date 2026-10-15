import { access, readFile, rm, writeFile } from "node:fs/promises";
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
 * Mirrors OpenCode's system instruction lookup: the first global file that exists,
 * plus every ancestor match of the first project file name that exists.
 * Nested instruction files are attached by OpenCode to read tool output instead.
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
