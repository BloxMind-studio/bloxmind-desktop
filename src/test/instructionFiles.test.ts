import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  findInstructionFiles,
  GLOBAL_INSTRUCTIONS_MAX_LENGTH,
  migrateWorkspaceInstructionsToGlobalSync,
  readGlobalInstructions,
  stripLegacyManagedBlock,
  writeGlobalInstructions,
} from "../../electron/instructionFiles";

let root: string;

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("instruction files", () => {
  it("finds the global file and every project match of the first file name, like OpenCode", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const home = join(root, "home");
    const workspace = join(home, "BloxMind");
    const globalConfigDirectory = join(workspace, ".opencode", "config", "opencode");
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(globalConfigDirectory, { recursive: true });
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(join(globalConfigDirectory, "AGENTS.md"), "global rules");
    await writeFile(join(home, ".claude", "CLAUDE.md"), "skipped: global AGENTS.md wins");
    await writeFile(join(workspace, "AGENTS.md"), "workspace rules");
    await writeFile(join(home, "AGENTS.md"), "home rules");
    await writeFile(join(workspace, "CLAUDE.md"), "skipped: AGENTS.md matched first");

    const files = await findInstructionFiles({ workspace, globalConfigDirectory, home });

    expect(files).toEqual([
      {
        path: "~/BloxMind/.opencode/config/opencode/AGENTS.md",
        scope: "global",
        chars: 12,
        content: "global rules",
      },
      { path: "~/BloxMind/AGENTS.md", scope: "project", chars: 15, content: "workspace rules" },
      { path: "~/AGENTS.md", scope: "project", chars: 10, content: "home rules" },
    ]);
  });
});

describe("legacy managed AGENTS.md block", () => {
  it("deletes a file that holds only the generated heading and managed block", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(workspace, "AGENTS.md"),
      "# BloxMind Project\n\n<!-- bloxmind-managed:begin -->\nRojo live-sync rules\n<!-- bloxmind-managed:end -->\n",
    );

    await expect(stripLegacyManagedBlock(workspace)).resolves.toBe(true);
    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(false);
  });

  it("keeps user-authored content around the managed block", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(workspace, "AGENTS.md"),
      "# My rules\n\nKeep code tidy.\n\n<!-- bloxmind-managed:begin -->\nstale rules\n<!-- bloxmind-managed:end -->\n",
    );

    await expect(stripLegacyManagedBlock(workspace)).resolves.toBe(true);
    expect(await readFile(join(workspace, "AGENTS.md"), "utf8")).toBe(
      "# My rules\n\nKeep code tidy.\n",
    );
  });

  it("leaves files without the managed markers untouched", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "AGENTS.md"), "# My rules\n");

    await expect(stripLegacyManagedBlock(workspace)).resolves.toBe(false);
    expect(await readFile(join(workspace, "AGENTS.md"), "utf8")).toBe("# My rules\n");
    await expect(stripLegacyManagedBlock(join(workspace, "missing"))).resolves.toBe(false);
  });
});

describe("global engine instructions", () => {
  it("round-trips AGENTS.md through read/write", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const globalConfigDirectory = join(root, "config", "opencode");
    await expect(readGlobalInstructions(globalConfigDirectory)).resolves.toBe("");

    await writeGlobalInstructions(globalConfigDirectory, "Run the build before committing.\n");

    await expect(readGlobalInstructions(globalConfigDirectory)).resolves.toBe(
      "Run the build before committing.\n",
    );
  });

  it("rejects non-string content and content over the size limit", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const globalConfigDirectory = join(root, "config", "opencode");

    await expect(writeGlobalInstructions(globalConfigDirectory, 42 as never)).rejects.toThrow(
      /string/,
    );
    await expect(
      writeGlobalInstructions(
        globalConfigDirectory,
        "x".repeat(GLOBAL_INSTRUCTIONS_MAX_LENGTH + 1),
      ),
    ).rejects.toThrow(/32,000/);
  });

  it("truncates reads longer than the engine limit", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const globalConfigDirectory = join(root, "config", "opencode");
    await mkdir(globalConfigDirectory, { recursive: true });
    await writeFile(
      join(globalConfigDirectory, "AGENTS.md"),
      "x".repeat(GLOBAL_INSTRUCTIONS_MAX_LENGTH + 10),
    );

    const content = await readGlobalInstructions(globalConfigDirectory);
    expect(content.length).toBe(GLOBAL_INSTRUCTIONS_MAX_LENGTH);
  });

  it("migrates a workspace AGENTS.md into the global location once", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    const globalConfigDirectory = join(root, "config", "opencode");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "AGENTS.md"), "workspace rules\n");

    expect(migrateWorkspaceInstructionsToGlobalSync(workspace, globalConfigDirectory)).toBe(true);
    expect(migrateWorkspaceInstructionsToGlobalSync(workspace, globalConfigDirectory)).toBe(false);

    const content = await readFile(join(globalConfigDirectory, "AGENTS.md"), "utf8");
    expect(content).toBe("workspace rules\n");
  });

  it("migrates nothing when the global file already exists or there is no workspace file", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    const globalConfigDirectory = join(root, "config", "opencode");
    await mkdir(globalConfigDirectory, { recursive: true });
    await writeFile(join(globalConfigDirectory, "AGENTS.md"), "existing rules\n");
    expect(migrateWorkspaceInstructionsToGlobalSync(workspace, globalConfigDirectory)).toBe(false);

    await rm(join(globalConfigDirectory, "AGENTS.md"));
    expect(migrateWorkspaceInstructionsToGlobalSync(workspace, globalConfigDirectory)).toBe(false);
  });

  it("migrates nothing for an empty workspace AGENTS.md", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    const globalConfigDirectory = join(root, "config", "opencode");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "AGENTS.md"), "   \n");

    expect(migrateWorkspaceInstructionsToGlobalSync(workspace, globalConfigDirectory)).toBe(false);
    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(true);
  });

  it("truncates an oversized workspace AGENTS.md instead of copying it verbatim", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    const globalConfigDirectory = join(root, "config", "opencode");
    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(workspace, "AGENTS.md"),
      "x".repeat(GLOBAL_INSTRUCTIONS_MAX_LENGTH + 5_000),
    );

    expect(migrateWorkspaceInstructionsToGlobalSync(workspace, globalConfigDirectory)).toBe(true);

    const content = await readGlobalInstructions(globalConfigDirectory);
    expect(content.length).toBe(GLOBAL_INSTRUCTIONS_MAX_LENGTH);
  });

  it("surfaces a read failure instead of pretending the file is empty", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxmind-instructions-"));
    const globalConfigDirectory = join(root, "config", "opencode");
    // A directory sitting at the AGENTS.md path makes readFile fail with EISDIR.
    await mkdir(join(globalConfigDirectory, "AGENTS.md"), { recursive: true });

    await expect(readGlobalInstructions(globalConfigDirectory)).rejects.toThrow();
  });
});
