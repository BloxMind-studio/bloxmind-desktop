import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("ships Knit and ProfileService framework skills", () => {
    const names = AGENT_SKILLS.map((skill) => skill.relativePath);
    expect(names).toContain(".opencode/skills/roblox-knit/SKILL.md");
    expect(names).toContain(".opencode/skills/roblox-profile-service/SKILL.md");
  });
  it("ships the /mcp-setup command skill and references session isolation", () => {
    const skill = AGENT_SKILLS.find((s) => s.relativePath.endsWith("mcp-setup/SKILL.md"));
    expect(skill).toBeDefined();
    const content = skill?.content;
    expect(content).toBeDefined();
    expect(content).toContain("Enable Studio as MCP server");
    expect(content).toContain("Manage MCP Servers");
    expect(content).toContain("Assistant");
    expect(content).toMatch(/roblox-studio/);
    expect(content).toContain("Rojo.rbxm");
    // New isolated-workspace standard, never the old shared root.
    expect(content).toContain("~/BloxMind/sessions/{sessionId}/");
    expect(content).not.toContain("~/BloxMind/\n");
    // Trigger phrasing the agent should recognise.
    expect(content).toMatch(/mcp-setup/);
    expect(content).toMatch(/connect|setup|troubleshoot/i);
    expect(content).toMatch(/port/);
  });

  it("ships the /roblox-script and /roblox-ui command skills", () => {
    const script = AGENT_SKILLS.find((s) => s.relativePath.endsWith("roblox-script/SKILL.md"));
    const ui = AGENT_SKILLS.find((s) => s.relativePath.endsWith("roblox-ui/SKILL.md"));
    expect(script).toBeDefined();
    expect(ui).toBeDefined();
    expect(script?.content).toContain("StarterPlayerScripts");
    expect(script?.content).toContain("ServerScriptService");
    expect(script?.content).toContain("ReplicatedStorage");
    expect(script?.content).toContain("Type-safe Luau");
    expect(ui?.content).toContain("ScreenGui");
    expect(ui?.content).toContain("UIScale");
    expect(ui?.content).toMatch(/Roact|Fusion/);
    expect(ui?.content).toContain("src/client");
  });

  it("registers all three slash commands as skills in AGENTS.md", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    await writeAgentsMarkdown(workspace);

    const agentsMd = await readFile(join(workspace, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("/mcp-setup");
    expect(agentsMd).toContain("/roblox-script");
    expect(agentsMd).toContain("/roblox-ui");
    expect(agentsMd).toMatch(/how do i setup\s+mcp/i);
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

  it("guards the agent against hallucinated APIs and live-input brute force", () => {
    const runtime = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-animation-runtime/SKILL.md"),
    )?.content;
    expect(runtime).toBeDefined();
    expect(runtime).toMatch(/NEVER guess engine methods/);
    expect(runtime).toContain("GetRigInfo");
    expect(runtime).toContain("GetDescendants");
    expect(runtime).toContain("Motor6D.Transform");
    expect(runtime).toMatch(/Pose\.Name/);
    expect(runtime).toContain("user_keyboard_input");
    expect(runtime).toMatch(/statically/);
  });

  it("bakes API-verification and static-verification rules into AGENTS.md", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    await writeAgentsMarkdown(workspace);

    const agentsMd = await readFile(join(workspace, "AGENTS.md"), "utf8");
    expect(agentsMd).toMatch(/Never guess/i);
    expect(agentsMd).toContain("GetRigInfo");
    expect(agentsMd).toMatch(/simulated\s+keyboard input/i);
    expect(agentsMd).toContain("Motor6D.Transform");
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

  it("drives construction from a JSON blueprint with grid snapping and stud proportions", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).toMatch(/Blueprint contract/);
    expect(building).toContain("grid_size");
    expect(building).toContain("map_bounds");
    expect(building).toMatch(/grid_size` is the snap unit/i);
    expect(building).toMatch(/Z-fighting/i);
    expect(building).toMatch(/Stud proportions/);
    expect(building).toMatch(/12-16 studs tall/i);
    expect(building).toMatch(/8-10 studs wide/i);
    expect(building).toMatch(/R15/i);
  });

  it("forbids the DirectionalLight class and Lighting.Technology; uses runtime-safe lights and post-processing", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).not.toContain("Enum.Technology.Future");
    expect(building).toContain("NEVER");
    expect(building).toContain("DirectionalLight");
    expect(building).toContain('game:GetService("Teams")');
    expect(building).not.toContain("Lighting.Technology = Enum");
    expect(building).toContain("NegativeZ");
    expect(building).toContain("region.Min.X");
    expect(building).toContain("BloomEffect");
    expect(building).toContain("ColorCorrectionEffect");
    expect(building).toMatch(/SunRays/);
    expect(building).toMatch(/PointLight/);
    expect(building).toMatch(/SpotLight/);
    expect(building).toMatch(/SurfaceLight/);
    expect(building).toContain(".Size");
    expect(building).toMatch(/nil values into .*Vector3\.new/);
    expect(building).toContain("Vector3.new(x or 4, y or 1, z or 2)");
    expect(building).toMatch(/asset palette/i);
    expect(building).toMatch(/Toolbox/i);
    expect(building).toMatch(/Clone/i);
    // API guardrails for the 5 captured Luau runtime errors
    // (skill markdown renders escaped backticks as plain ones)
    expect(building).toContain("`Instance` objects directly to `table.concat()`");
    expect(building).toContain("Enum.PartType.Wedge");
    expect(building).toMatch(/NEVER call .*Terrain:Destroy/i);
    expect(building).toContain("workspace.Terrain:Clear()");
    expect(building).toMatch(/NEVER set .*\.SunRaysSize/);
    expect(building).toMatch(/Intensity` \(0-1\) and `Spread/);
    expect(building).toContain("Enum.Material.Rock");
    expect(building).not.toContain("Enum.Material.Wedge");
    expect(building).toContain("ClearAllChildren");
  });

  it("uses GeometryService for runtime CSG and forbids the phantom SolidModeling service", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).toContain('game:GetService("GeometryService")');
    expect(building).toContain("UnionAsync");
    expect(building).toContain("SubtractAsync");
    expect(building).toContain("IntersectAsync");
    expect(building).toContain("SweepPartAsync");
    expect(building).toContain("FragmentAsync");
    expect(building).toContain("SolidModeling");
    expect(building).toContain("there is **no");
    expect(building).toContain("service**");
    expect(building).toMatch(/pre-bake/i);
    expect(building).toMatch(/verify it .* Command Bar/);
  });

  it("teaches standard Knit Service and Controller structure with Wally wiring", () => {
    const knit = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-knit/SKILL.md"),
    )?.content;
    expect(knit).toBeDefined();
    expect(knit).toContain("Knit.CreateService");
    expect(knit).toContain("Knit.CreateController");
    expect(knit).toContain("Client = {}");
    expect(knit).toContain("Knit.Start()");
    expect(knit).toContain("Knit.CreateRemote");
    expect(knit).toMatch(/Client_/);
    expect(knit).toContain("sleitnick/knit");
    expect(knit).toMatch(/wally\.toml/);
    expect(knit).toMatch(/Packages/);
    expect(knit).toMatch(/default\.project\.json/);
    expect(knit).toMatch(/separation of concerns/i);
    expect(knit).toMatch(/ServerScriptService/);
    expect(knit).toMatch(/StarterPlayerScripts/);
  });

  it("teaches ProfileService session locking, auto-save, and fallback defaults", () => {
    const profileService = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-profile-service/SKILL.md"),
    )?.content;
    expect(profileService).toBeDefined();
    expect(profileService).toContain("ProfileService.GetProfileStore");
    expect(profileService).toContain("LoadProfileAsync");
    expect(profileService).toContain("AddUserId");
    expect(profileService).toContain("RemoveUserId");
    expect(profileService).toContain("ListenToRelease");
    expect(profileService).toContain("Reconcile");
    expect(profileService).toContain("profile:Release");
    expect(profileService).toMatch(/session lock/i);
    expect(profileService).toMatch(/auto.sav/i);
    expect(profileService).toMatch(/fallback default/i);
    expect(profileService).toContain("madstudioroblox/profile-service");
    expect(profileService).toMatch(/wally\.toml/);
    expect(profileService).toMatch(/data loss/i);
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

  it("prunes foreign skill folders that are not part of the shipped pack", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    // Simulate a leftover from an older app generation (e.g. the removed
    // Apps/Game/Agent studios) that OpenCode discovery should never see.
    const foreign = join(workspace, ".opencode", "skills", "roblox-game");
    await mkdir(foreign, { recursive: true });
    await writeFile(
      join(foreign, "SKILL.md"),
      "---\nname: roblox-game\ndescription: stale\n---\n\n# stale\n",
      "utf8",
    );

    await writeAgentSkills(workspace);

    await expect(readFile(join(foreign, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(readdir(join(workspace, ".opencode", "skills"))).resolves.toHaveLength(
      AGENT_SKILLS.length,
    );
    for (const skill of AGENT_SKILLS) {
      const target = join(workspace, ...skill.relativePath.split("/"));
      await expect(readFile(target, "utf8")).resolves.toBe(skill.content);
    }
  });

  it("preserves user-added skills that are not on the stale list", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    const custom = join(workspace, ".opencode", "skills", "my-own-skill");
    await mkdir(custom, { recursive: true });
    await writeFile(
      join(custom, "SKILL.md"),
      "---\nname: my-own-skill\ndescription: mine\n---\n\n# mine\n",
      "utf8",
    );

    await writeAgentSkills(workspace);

    await expect(readFile(join(custom, "SKILL.md"), "utf8")).resolves.toContain("mine");
  });

  it("mirrors the pack into the global skills directory when provided", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    const globalRoot = await mkdtemp(join(tmpdir(), "bloxmind-global-skills-"));
    tempDirectories.push(workspace, globalRoot);

    // A stale leftover in the global root must be pruned there too.
    const staleGlobal = join(globalRoot, "roblox-toolbox");
    await mkdir(staleGlobal, { recursive: true });
    await writeFile(join(staleGlobal, "SKILL.md"), "stale", "utf8");

    await writeAgentSkills(workspace, globalRoot);

    await expect(readdir(globalRoot)).resolves.toHaveLength(AGENT_SKILLS.length);
    for (const skill of AGENT_SKILLS) {
      const segments = skill.relativePath.split("/");
      const target = join(globalRoot, ...segments.slice(-2));
      await expect(readFile(target, "utf8")).resolves.toBe(skill.content);
    }
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

  it("tells the agent to stay time-aware and cap deliberation at about 2 minutes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bloxmind-skills-"));
    tempDirectories.push(workspace);

    await writeAgentsMarkdown(workspace);

    const agentsMd = await readFile(join(workspace, "AGENTS.md"), "utf8");
    expect(agentsMd).toMatch(/time-aware/i);
    expect(agentsMd).toMatch(/2 minutes/i);
    expect(agentsMd).toMatch(/overthink/i);
    expect(agentsMd).toMatch(/never loop/i);
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

  it("prevents prop clipping with bounding offsets and bridge alignment", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).toContain("ANTI-CLIPPING");
    expect(building).toContain("No Internal Props");
    expect(building).toContain("wall.CFrame * CFrame.new(0, 0, wall.Size.Z/2 + prop.Size.Z/2)");
    expect(building).toContain("Bridge Alignment");
    expect(building).toMatch(/sequentially offset/i);
  });

  it("supports advanced procedural tree variations with multi-species patterns", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).toContain("ADVANCED PROCEDURAL TREE");
    expect(building).toContain("createTree");
    expect(building).toContain("Color3.fromRGB(255, 183, 197)");
    expect(building).toContain("Oak Tree");
    expect(building).toContain("Sakura");
    expect(building).toContain("Pine");
    expect(building).toContain("CFrame.Angles");
    expect(building).toMatch(/MUST NOT build basic stacked sphere/i);
  });

  it("forbids perfect spherical rocks and requires irregular boulder construction", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).toContain("NATURAL IRREGULAR BOULDERS");
    expect(building).toContain("Shape = Sphere");
    expect(building).toContain("math.rad(math.random(0, 360))");
    expect(building).toContain("Vector3.new(...)");
    expect(building).toContain("UnionAsync");
    expect(building).toMatch(/wedge\/block/i);
  });

  it("requires debris and decoration ground snap via Raycasting", () => {
    const building = AGENT_SKILLS.find((skill) =>
      skill.relativePath.endsWith("roblox-map-building/SKILL.md"),
    )?.content;
    expect(building).toBeDefined();
    expect(building).toContain("DEBRIS & DECORATION GROUND SNAP");
    expect(building).toMatch(/Raycasting/i);
    expect(building).toMatch(/Y-height math/i);
    expect(building).toMatch(/terrain surface/i);
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
