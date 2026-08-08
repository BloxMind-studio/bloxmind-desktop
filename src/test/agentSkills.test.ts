import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AGENT_SKILLS, writeAgentSkills, writeAgentsMarkdown } from "../../electron/agentSkills";

// OpenCode's documented frontmatter contract for SKILL.md files: name and
// description are required; name is 1-64 chars of lowercase alphanumeric with
// single hyphens and must match the containing directory; description is
// 1-1024 characters.
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("Missing frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

describe("agent skill pack", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    for (const directory of tempDirectories) {
      await rm(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  it("ships an authoring playbook and a runtime playback guide", () => {
    const names = AGENT_SKILLS.map((skill) => skill.relativePath);
    expect(names).toContain(".opencode/skills/roblox-animation/SKILL.md");
    expect(names).toContain(".opencode/skills/roblox-animation-runtime/SKILL.md");
  });

  it("ships map planning and map building skills", () => {
    const names = AGENT_SKILLS.map((skill) => skill.relativePath);
    expect(names).toContain(".opencode/skills/roblox-map-planning/SKILL.md");
    expect(names).toContain(".opencode/skills/roblox-map-building/SKILL.md");
  });

  it("satisfies OpenCode's frontmatter and naming contract", () => {
    for (const skill of AGENT_SKILLS) {
      const fields = parseFrontmatter(skill.content);
      const segments = skill.relativePath.split("/");
      const directoryName = segments[segments.length - 2];
      expect(fields.name).toBe(directoryName);
      expect(fields.name.length).toBeGreaterThanOrEqual(1);
      expect(fields.name.length).toBeLessThanOrEqual(64);
      expect(fields.name).toMatch(SKILL_NAME_PATTERN);
      expect(fields.description.length).toBeGreaterThanOrEqual(1);
      expect(fields.description.length).toBeLessThanOrEqual(1024);
    }
  });

  it("covers pro combat, eating, and dance recipes plus the register-not-upload pipeline", () => {
    const authoring = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-animation/SKILL.md"),
    )?.content;
    expect(authoring).toBeDefined();
    expect(authoring).toContain("RegisterKeyframeSequence");
    expect(authoring).toMatch(/anticipation/i);
    expect(authoring).toMatch(/follow-through/i);
    expect(authoring).toMatch(/combo/i);
    expect(authoring).toMatch(/hit reaction/i);
    expect(authoring).toMatch(/eat/i);
    expect(authoring).toMatch(/dance/i);
    expect(authoring).toContain("LeftShoulder");
    expect(authoring).toMatch(/rbxassetid/);
  });

  it("supports R6 rigs with a full motor map, detection, and dual-rig strategy", () => {
    const authoring = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-animation/SKILL.md"),
    )?.content;
    expect(authoring).toBeDefined();
    expect(authoring).toContain("RootJoint");
    expect(authoring).toContain("Left Shoulder");
    expect(authoring).toContain("Right Hip");
    expect(authoring).toContain("HumanoidRigType");
    expect(authoring).toMatch(/rig detection/i);
    expect(authoring).toMatch(/dual-rig/i);
  });

  it("documents priorities, marker chaining, session-local IDs, and rig-aware playback", () => {
    const runtime = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-animation-runtime/SKILL.md"),
    )?.content;
    expect(runtime).toBeDefined();
    expect(runtime).toContain("AnimationPriority");
    expect(runtime).toContain("GetMarkerReachedSignal");
    expect(runtime).toContain("AdjustSpeed");
    expect(runtime).toMatch(/session-local/i);
    expect(runtime).toContain("HumanoidRigType");
    expect(runtime).toMatch(/Rig-aware playback/);
  });

  it("enforces plan-before-build with zoning, scale numbers, and flow", () => {
    const planning = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-planning/SKILL.md"),
    )?.content;
    expect(planning).toBeDefined();
    expect(planning).toMatch(/Never start building immediately/);
    expect(planning).toMatch(/Zoning/);
    expect(planning).toMatch(/Flow/);
    expect(planning).toMatch(/landmark/i);
    expect(planning).toMatch(/studs/);
    expect(planning).toMatch(/Build Plan/);
    expect(planning).toMatch(/budget/i);
  });

  it("covers the phased build pipeline, terrain, lighting, and performance budgets", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).toContain("Phase 1");
    expect(building).toContain("Blockout");
    expect(building).toContain("Workspace.Terrain");
    expect(building).toContain("Atmosphere");
    expect(building).toContain("SpawnLocation");
    expect(building).toContain("Anchored = true");
    expect(building).toContain("ServerStorage.MapKit");
    expect(building).toMatch(/StreamingEnabled/);
    expect(building).toMatch(/budget/i);
  });

  it("writes every skill to the OpenCode workspace layout", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    await writeAgentSkills(workspace);

    for (const skill of AGENT_SKILLS) {
      const target = join(workspace, ...skill.relativePath.split("/"));
      await expect(readFile(target, "utf8")).resolves.toBe(skill.content);
    }
  });

  it("overwrites stale skills so upgrades ship on relaunch", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    await writeAgentSkills(workspace);
    await writeAgentSkills(workspace);

    const target = join(workspace, ...AGENT_SKILLS[0].relativePath.split("/"));
    await expect(readFile(target, "utf8")).resolves.toBe(AGENT_SKILLS[0].content);
  });

  it("creates the workspace AGENTS.md with efficiency and quality conventions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    await writeAgentsMarkdown(workspace);

    const agentsMd = await readFile(join(workspace, "AGENTS.md"), "utf8");
    expect(agentsMd).toMatch(/Efficiency/);
    expect(agentsMd).toMatch(/batch all edits to a file into one pass/i);
    expect(agentsMd).toMatch(/Luau quality/);
    expect(agentsMd).toContain("bloxmind-managed:begin");
  });

  it("appends the managed block without touching user-authored AGENTS.md content", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);
    const userContent = "# My Project Rules\n\nAlways use tabs.\n";
    await writeFile(join(workspace, "AGENTS.md"), userContent, "utf8");

    await writeAgentsMarkdown(workspace);

    const agentsMd = await readFile(join(workspace, "AGENTS.md"), "utf8");
    expect(agentsMd.startsWith(userContent)).toBe(true);
    expect(agentsMd).toContain("bloxmind-managed:begin");
  });

  it("refreshes the managed block in place and preserves surrounding content", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);
    await writeAgentsMarkdown(workspace);
    const before = await readFile(join(workspace, "AGENTS.md"), "utf8");
    const withUserNote = `${before}\n## My own notes\n\nKeep these.\n`;
    await writeFile(join(workspace, "AGENTS.md"), withUserNote, "utf8");

    await writeAgentsMarkdown(workspace);

    const agentsMd = await readFile(join(workspace, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## My own notes");
    expect(agentsMd).toContain("Keep these.");
    expect(agentsMd.match(/bloxmind-managed:begin/g)?.length).toBe(1);
  });

  it("ships AGENTS.md alongside the skill pack", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    await writeAgentSkills(workspace);

    await expect(readFile(join(workspace, "AGENTS.md"), "utf8")).resolves.toMatch(
      /bloxmind-managed/,
    );
  });
});
