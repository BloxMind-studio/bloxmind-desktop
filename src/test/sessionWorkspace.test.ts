import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homeDirs: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => homeDirs[0],
  },
}));

import {
  ensureSessionWorkspace,
  PROJECT_SOURCE_DIRS,
  purgeLegacyRootWorkspace,
  type SESSION_PROJECT_JSON,
  sessionsRoot,
  sessionWorkspaceDir,
} from "../../electron/sessionWorkspace";

function homeRoot(): string {
  return homeDirs[0];
}

beforeEach(async () => {
  homeDirs.push(await mkdtemp(join(tmpdir(), "bloxmind-home-")));
});

afterEach(async () => {
  const dir = homeDirs.pop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("sessionWorkspace", () => {
  it("roots sessions under ~/BloxMind/sessions", () => {
    expect(sessionsRoot()).toBe(join(homeRoot(), "BloxMind", "sessions"));
    expect(sessionWorkspaceDir("abc")).toBe(join(homeRoot(), "BloxMind", "sessions", "abc"));
  });

  it("creates a nested src/server|src/client|src/shared tree and project.json", async () => {
    const dir = await ensureSessionWorkspace("ses_1");
    expect(dir).toBe(join(homeRoot(), "BloxMind", "sessions", "ses_1"));

    for (const sub of PROJECT_SOURCE_DIRS) {
      const stat = await import("node:fs").then((fs) => fs.statSync(join(dir, sub)));
      expect(stat.isDirectory()).toBe(true);
    }

    const project = JSON.parse(
      await readFile(join(dir, "default.project.json"), "utf8"),
    ) as typeof SESSION_PROJECT_JSON;
    expect(project.tree.ReplicatedStorage.BloxMind.$path).toBe("src/shared");
    expect(project.tree.ServerScriptService.Server.$path).toBe("src/server");
    expect(project.tree.StarterPlayer.StarterPlayerScripts.Client.$path).toBe("src/client");
  });

  it("purgeLegacyRootWorkspace removes stray files but keeps sessions/ and dot-dirs", async () => {
    const root = join(homeRoot(), "BloxMind");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "old_script.lua"), "-- legacy", "utf8");
    await mkdir(join(root, "legacy_project"), { recursive: true });
    await writeFile(join(root, "legacy_project", "init.lua"), "x", "utf8");
    await mkdir(join(root, "sessions"), { recursive: true });
    await mkdir(join(root, ".opencode"), { recursive: true });

    await purgeLegacyRootWorkspace();

    const remaining = await readdir(root);
    expect(remaining).toContain("sessions");
    expect(remaining).toContain(".opencode");
    expect(remaining).not.toContain("old_script.lua");
    expect(remaining).not.toContain("legacy_project");
  });

  it("purgeLegacyRootWorkspace tolerates a missing workspace root", async () => {
    await expect(purgeLegacyRootWorkspace()).resolves.toBeUndefined();
  });
});
