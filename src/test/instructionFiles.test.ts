import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findInstructionFiles, stripLegacyManagedBlock } from "../../electron/instructionFiles";

let root: string;

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("instruction files", () => {
  it("finds the global file and every project match of the first file name, like OpenCode", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxbot-instructions-"));
    const home = join(root, "home");
    const workspace = join(home, "BloxBot");
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
        path: "~/BloxBot/.opencode/config/opencode/AGENTS.md",
        scope: "global",
        chars: 12,
        content: "global rules",
      },
      { path: "~/BloxBot/AGENTS.md", scope: "project", chars: 15, content: "workspace rules" },
      { path: "~/AGENTS.md", scope: "project", chars: 10, content: "home rules" },
    ]);
  });
});

describe("legacy managed AGENTS.md block", () => {
  it("deletes a file that holds only the generated heading and managed block", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxbot-instructions-"));
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
    root = await mkdtemp(join(tmpdir(), "bloxbot-instructions-"));
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
    root = await mkdtemp(join(tmpdir(), "bloxbot-instructions-"));
    const workspace = join(root, "home", "BloxMind");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "AGENTS.md"), "# My rules\n");

    await expect(stripLegacyManagedBlock(workspace)).resolves.toBe(false);
    expect(await readFile(join(workspace, "AGENTS.md"), "utf8")).toBe("# My rules\n");
    await expect(stripLegacyManagedBlock(join(workspace, "missing"))).resolves.toBe(false);
  });
});
