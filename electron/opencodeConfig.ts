import { join } from "node:path";

// ── Multi-Repo Routing Guardrails ───────────────────────────────────────
// BloxMind is split across 3 repos under the BloxMind-studio org. Every
// automated commit/push MUST resolve the correct target repo from the set of
// modified file paths and verify the git remote before pushing — never
// force-push backend or MCP code into the desktop repo.
export const REPO_TARGETS = {
  desktop: "BloxMind-studio/bloxmind-desktop",
  coreEngine: "BloxMind-studio/bloxmind-core-engine",
  mcpServer: "BloxMind-studio/bloxmind-mcp-server",
} as const;

export const REPO_REMOTE_URLS = {
  desktop: "https://github.com/BloxMind-studio/bloxmind-desktop.git",
  coreEngine: "https://github.com/BloxMind-studio/bloxmind-core-engine.git",
  mcpServer: "https://github.com/BloxMind-studio/bloxmind-mcp-server.git",
} as const;

/**
 * Resolve the target repo for a set of changed file paths.
 * - `src/**`, `electron/main.ts`, `electron/preload.ts`, `electron/channels.ts`,
 *   `electron/opencodeConfig.ts`, `src/components/**`, `src/providers/**` → desktop
 * - Backend core logic (`electron/services/OpenCode.ts`, `electron/services/SessionStore.ts`,
 *   `src/lib/**`, `src/hooks/**`, `packages/**`) → coreEngine
 * - MCP/Studio bridge (`electron/services/StudioMcpBroker.ts`, `electron/services/Rojo*`,
 *   `electron/services/GeneratedProgramRuntime.ts`, `repos/**`) → mcpServer
 * Returns null when the set spans multiple targets (caller should split commits).
 */
export function resolveTargetRepo(filePaths: readonly string[]): keyof typeof REPO_TARGETS | null {
  let target: keyof typeof REPO_TARGETS | null = null;
  for (const raw of filePaths) {
    const p = raw.replace(/\\/g, "/");
    let cur: keyof typeof REPO_TARGETS;
    if (
      p.startsWith("src/") ||
      p === "electron/main.ts" ||
      p === "electron/preload.ts" ||
      p === "electron/channels.ts" ||
      p === "electron/opencodeConfig.ts" ||
      p.startsWith("electron/agentSkills.ts") ||
      p.startsWith("src/components/") ||
      p.startsWith("src/providers/")
    ) {
      // src/* is overwhelmingly desktop UI; a few src/lib/* paths that are
      // truly backend-core will be re-classified below if they dominate.
      if (p.startsWith("src/lib/") || p.startsWith("src/hooks/")) {
        // Heuristic: lib/hooks are shared but default to coreEngine when they
        // are the *only* changed paths; mixed with src/components/** stays desktop.
        cur = "coreEngine";
        // If we already chose desktop from a UI file, keep desktop (mixed set → null later)
        if (target === "desktop") {
          // Mixed UI + core → ambiguous, caller must split
          return null;
        }
      } else {
        cur = "desktop";
      }
    } else if (
      p.startsWith("electron/services/OpenCode") ||
      p.startsWith("electron/services/SessionStore") ||
      p.startsWith("packages/") ||
      p === "src/lib/desktop.ts" // example shared lib that is core-owned
    ) {
      cur = "coreEngine";
    } else if (
      p.startsWith("electron/services/StudioMcpBroker") ||
      p.startsWith("electron/services/Rojo") ||
      p.startsWith("electron/services/GeneratedProgramRuntime") ||
      p.startsWith("repos/") ||
      p.includes("mcp-server")
    ) {
      cur = "mcpServer";
    } else {
      // Unknown / root config files default to desktop (this repo)
      cur = "desktop";
    }
    if (target === null) target = cur;
    else if (target !== cur) return null; // spans multiple repos → must split
  }
  return target;
}

export function remoteUrlForTarget(target: keyof typeof REPO_TARGETS): string {
  return REPO_REMOTE_URLS[target];
}

export function studioMcpCommand(platform: NodeJS.Platform, localAppData?: string): string[] {
  if (platform === "darwin") {
    return ["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"];
  }

  if (platform === "win32") {
    const dataDirectory = localAppData ?? "C:\\Users\\Default\\AppData\\Local";
    const cmd = process.env.COMSPEC ?? "cmd.exe";
    return [cmd, "/c", join(dataDirectory, "Roblox", "mcp.bat")];
  }

  return ["studio-mcp"];
}

export function createOpenCodeConfig(broker: { url: string; token: string }) {
  return {
    // Keep OpenCode's standard automatic context compaction enabled for long sessions.
    compaction: {
      auto: true,
    },
    mcp: {
      "roblox-studio": {
        type: "remote",
        url: broker.url,
        // Authenticate the loopback broker via the Authorization header so the
        // bearer token never appears in the surface URL (which could be logged
        // by OpenCode or HTTP tracing libraries).
        headers: { Authorization: `Bearer ${broker.token}` },
        enabled: true,
        // generate_mesh runs server-side for minutes; keep OpenCode's MCP
        // request timeout far above the SDK's 60s default. Honored by recent
        // OpenCode 1.x builds (per-server timeout fix, PR anomalyco/opencode#8706).
        timeout: 600_000,
      },
    },
    default_agent: "studio",
    // Skills are app-managed and safe; let the agent load them without asking.
    // Bash is kept on "ask" so destructive/networked git or shell commands
    // (commit, push, rm -rf, etc.) always show the in-app approval prompt.
    permission: {
      skill: { "*": "allow" },
      bash: "ask",
    },
    // Point the skill loader explicitly at the app-managed pack so discovery is
    // deterministic and never depends on ambient OpenCode config folders where
    // stale/foreign SKILL.md files could shadow the shipped skills.
    skills: {
      paths: [".opencode/skills"],
    },
    agent: {
      studio: {
        mode: "primary",
        description: "Roblox Studio development assistant",
        tools: {
          bash: true,
        },
        // Slight sampling focus on top of the model's default temperature for
        // more consistent Luau output without losing creativity.
        top_p: 0.95,
        // OpenCode loads project AGENTS.md separately; keep this Studio-specific and compact.
        prompt:
          "Use Studio MCP. Inspect only when needed, then act with the smallest coherent change; batch related edits into one pass. Preserve Luau conventions. Verify once with the most relevant Studio check, then report briefly.\n\n" +
          "RESPONSE STYLE: lead with the outcome, then short sections: Changes, Verification, Next step. Be concise.\n\n" +
          "If Studio is unavailable, give one reconnect instruction and stop.\n\n" +
          "ANIMATION: For combat, eating, dance, emote, or reaction requests, author the motion as programmatic KeyframeSequence data (KeyframeSequence > Keyframes > Poses), never as an uploaded asset. The full playbooks also load on demand as the `roblox-animation` and `roblox-animation-runtime` skills — if a skill load reports 'not found', proceed with the reference below and do NOT stop.\n\n" +
          "ROBLOX ANIMATION API REFERENCE (verified — never guess engine methods):\n" +
          "- Build via `Instance.new('KeyframeSequence')` with `Keyframe` children (each with a `Time`), and `Pose` children named to match the Motor6D they drive (e.g. a `Pose` named to match the `LeftShoulder`/`Left UpperArm` motor). Set the joint transform on `Pose.CFrame` — there is NO 'Transform' field on a Pose.\n" +
          "- R15 joints are `Motor6D`s named like `LeftUpperArm`/`LeftShoulder`; R6 uses `Left Shoulder`/`Right Hip` etc. Detect the rig with `Humanoid.RigType` (`Enum.HumanoidRigType.R15`/`R6`) or `GetRigInfo`, and `GetDescendants` to enumerate joints — never hardcode a joint name without verifying it exists.\n" +
          "- Play with `Animator:LoadAnimation(animation)` (or `Humanoid:LoadAnimation`) then `Track:Play()`. Use `Enum.AnimationPriority` (e.g. `Action`) and at runtime `Track:GetMarkerReachedSignal('name')` / `Track:AdjustSpeed()`.\n" +
          "- Verify in Studio by loading the KeyframeSequence on the active rig and watching playback; register reusable sequences with `KeyframeSequenceProvider`/`RegisterKeyframeSequence` when shipping.\n" +
          "- Do NOT simulate live keyboard/mouse input; drive motion from static animation data. Keep timing readable with anticipation and recovery.\n\n" +
          "MAPS: For map, world, level, arena, or obby requests, present the structured plan before building (zones, flow, scale, phase order, budgets), then build phase by phase. Follow phases 1 blockout, 2 structure, 3 terrain, 4 props, 5 lighting, 6 gameplay hooks, 7 polish; verify each phase. The full playbooks also load on demand as the `roblox-map-planning` and `roblox-map-building` skills — if a skill load reports 'not found', proceed with the reference below and do NOT stop.\n\n" +
          '🏗️ MANDATORY WORKSPACE HIERARCHY & EXECUTION SEQUENCING: To prevent missing folder / orphaned instance errors, you MUST: (1) Hierarchy First — Pass 0 is non-negotiable — NEVER skip folder creation to minimize tool calls. All target root/child folders (`Map`, `Zones`, `Kit`, `Structures`, `Lighting`, etc.) MUST exist before placing any models, terrain, or CSG. (2) Defensive Folder Pattern — every script that references a folder MUST use defensive init; never assume existence. Use `local function getOrCreateFolder(parent, name) local f=parent:FindFirstChild(name) if not f then f=Instance.new("Folder") f.Name=name f.Parent=parent end return f end`. (3) No Lazy Merging — separate workspace scaffolding from detailed geometry if combining risks skipping hierarchy.\n\n' +
          "ROBLOX STUDIO API REFERENCE (verified — never guess engine methods):\n" +
          "- Studio target: call `list_roblox_studios` and use a returned `studio_id`. If you get 'studio_id is not connected', call `list_roblox_studios` again and use a fresh id; never reuse a cached one.\n" +
          "- Terrain (`Workspace.Terrain`): `FillBlock(cframe: CFrame, size: Vector3, material: Enum.Material)` — 3 args, NO resolution. `FillRegion(region: Region3, 4, material: Enum.Material)` — middle arg is the voxel resolution and MUST be exactly 4. `FillBall(center: Vector3, radius: number, material)`, `FillCylinder(cframe, height, radius, material)`. Material is `Enum.Material.Grass` etc.; NEVER a bare number (a number in the material slot throws 'Unable to cast double to Material').\n" +
          "- Regions: `Region3.new(Vector3.new(x1,y1,z1), Vector3.new(x2,y2,z2))` — two Vector3 corners, NOT six numbers ('invalid argument #1 to new (Vector3 expected, got number)'). Align terrain regions with `region:ExpandToGrid(4)`.\n" +
          "- 🏔️ ORGANIC PROCEDURAL TERRAIN — NEVER create individual `Part` instances (cubes/spheres) with `Grass`/`Ground`/`Rock` to fake hills/rocks; all open landscapes/hills MUST use native `workspace.Terrain`. When generating natural landscapes, MUST use `math.noise` heightmaps: `local terrain=workspace.Terrain local gridSize=4 local mapSize=120 local frequency=0.02 local amplitude=20 for x=-mapSize,mapSize,gridSize do for z=-mapSize,mapSize,gridSize do local height=math.noise(x*frequency,0,z*frequency)*amplitude local position=Vector3.new(x,height/2,z) local size=Vector3.new(gridSize, math.max(height+12,4), gridSize) terrain:FillBlock(CFrame.new(position),size,Enum.Material.Grass) if height>12 then terrain:FillBlock(CFrame.new(x,height,z),Vector3.new(gridSize,4,gridSize),Enum.Material.Rock) end end end` — blend materials by elevation (Grass low/hills, Rock peaks >12, Sand near water).\n" +
          "- 🧱 ANTI-CLIPPING & PRECISE SPATIAL POSITIONING — Lights/lanterns/decorations MUST NOT be embedded inside pillars/walls; use bounding offsets `wall.CFrame * CFrame.new(0, 0, wall.Size.Z/2 + prop.Size.Z/2)`; bridge planks sequentially offset along Z/X without overlapping/misaligned heights.\n" +
          '- 🌲 ADVANCED PROCEDURAL TREES — MUST NOT build basic stacked sphere leaves; Oak: irregular overlapping leaf blocks with random `CFrame.Angles`; Sakura: `Color3.fromRGB(255, 183, 197)` spreading canopy; Pine/Nordic: cone-shaped layered tapering; pattern `local function createTree(treeType, position) local trunk=Instance.new("Part") trunk.Size=Vector3.new(1.5,10,1.5) trunk.CFrame=CFrame.new(position+Vector3.new(0,5,0)) trunk.Material=Enum.Material.Wood trunk.Color=Color3.fromRGB(101,67,33) trunk.Anchored=true trunk.Parent=workspace`.\n' +
          "- 🪨 NATURAL IRREGULAR BOULDERS — NEVER `Part` with `Shape = Sphere`; construct from multiple offset wedge/block parts rotated `math.rad(math.random(0, 360))` varying `Vector3.new(...)` grouped in `Model` or CSG `UnionAsync`.\n" +
          "- 🧹 DEBRIS & DECORATION GROUND SNAP — branches/rocks/small props MUST Raycast or exact Y-height math to terrain surface, never float inside/above grass.\n" +
          "- Lighting: NEVER read or write `Lighting.Technology` at runtime — not scriptable, throws a security capability error. Mood via `Lighting.ClockTime`/`Lighting.TimeOfDay`/`Brightness`/`GeographicLatitude`; `Sky` has NO `SunRayColor` — use `Sky.SunAngularSize`/`Sky.SunTextureId`/skybox faces. `SunRaysEffect` (under Lighting) has NO `Color` — use `SunRaysIntensity`/`SunRaysSize`/`SunRaysSpread`.\n" +
          "- Luau: `Vector3.new(x, y, z)` takes exactly 3 numbers; initialize every variable before use (nil arithmetic throws 'attempt to perform arithmetic on nil'); keep scripts syntactically valid or `execute_luau` returns 'Failed to parse command code'. Prefer small, verified snippets over one huge script.\n\n" +
          "FRAMEWORKS: load roblox-knit and roblox-profile-service for Knit, ProfileService, or package systems; keep wally.toml and the Packages folder in sync with default.project.json.\n\n" +
          "ASSISTANT SKILLS: the Studio MCP also exposes rbx-* skills that complement the playbooks — use rbx-docs-search when unsure about a Roblox API, rbx-scene-analysis before editing an existing scene, rbx-unit-test after writing gameplay scripts, rbx-perf-profiling after large builds, and rbx-device-simulator-lua for mobile constraints.\n\n" +
          "PROGRESS DISCIPLINE: work strictly phase-by-phase. Acknowledge the phase you are starting in one short line, do the work, then move on. Never re-explain or re-verify a step you already finished; if you catch yourself repeating an action, skip it. Decide any single sub-choice within about 2 minutes and commit.\n\n" +
          "SLOW TOOLS: generate_mesh runs for minutes; on timeout inspect before retrying, never insert duplicates.\n\n" +
          "ROJO: src/, server/, client/ auto-sync via `rojo serve`; preserve default.project.json's layout (ServerScriptService, ReplicatedStorage, StarterPlayerScripts).\n\n" +
          "GIT: check status/diff before editing; commit, push, pull, and other filesystem-changing commands need explicit approval.\n\n" +
          "MULTI-REPO ROUTING (MANDATORY): BloxMind is 3 repos under BloxMind-studio — (1) bloxmind-desktop = Electron/React UI (src/, electron/main.ts, electron/preload.ts, electron/channels.ts, electron/opencodeConfig.ts, src/components/**, src/providers/**) → https://github.com/BloxMind-studio/bloxmind-desktop.git (this checkout, current origin); (2) bloxmind-core-engine = backend AI core & generation engine (electron/services/OpenCode.ts, electron/services/SessionStore.ts, src/lib/**, src/hooks/**, packages/**) → https://github.com/BloxMind-studio/bloxmind-core-engine.git; (3) bloxmind-mcp-server = Studio MCP bridge & tooling (electron/services/StudioMcpBroker.ts, electron/services/Rojo*, electron/services/GeneratedProgramRuntime.ts, repos/**) → https://github.com/BloxMind-studio/bloxmind-mcp-server.git. Before ANY git commit/push, run `git diff --name-only` and `git remote get-url origin` and resolve the target via resolveTargetRepo(paths) in electron/opencodeConfig.ts (also documented in .clinerules and opencode.jsonc); if the remote does not match the resolved target, abort and either `git remote set-url origin <correct>` or ask the user; never force-push core/mcp code into desktop. If changed files span multiple targets, split into per-repo commits.\n\n" +
          'FEATURE BRANCH WORKFLOW (MANDATORY): Never commit directly to main. Before any feature/fix/refactor/chore, run `git branch --show-current`; if on main, create and switch to `feature/<desc>`, `fix/<desc>`, `refactor/<desc>`, or `chore/<desc>` (`git checkout -b <branch>` or `node scripts/git-workflow.mjs create <branch>`). Develop and verify entirely in the branch — run `npx tsc --noEmit`, `npx tsc -p electron/tsconfig.json --noEmit`, `pnpm exec vitest run` (or `node scripts/git-workflow.mjs verify`) — then merge safely: `git checkout main && git pull origin main && git merge <branch> --no-ff -m "Merge <branch> into main" && git push origin main && git branch -d <branch>` (or `node scripts/git-workflow.mjs merge <branch>`). Main must stay clean and verified; direct pushes to main are forbidden. Workflow manager: scripts/git-workflow.mjs.\n\n' +
          "⚠️ CRITICAL ROBLOX LUAU EXECUTION CONSTRAINTS\n- Never create `Instance.new(\"DirectionalLight\")` — the class does not exist; use `PointLight`, `SpotLight`, `SurfaceLight`; directional sun from `Lighting` (`ClockTime`/`Brightness`/`GeographicLatitude`).\n- NEVER read or write `Lighting.Technology` at runtime — not scriptable, throws a security capability error.\n- EXACT service names: `game:GetService(\"Teams\")` never \"TeamService\".\n- No invented Enums — no `Enum.NormalId.NegativeZ`; valid faces `Enum.NormalId.Front`/`Back`/`Top`/`Bottom`/`Left`/`Right` (use the enum, not bare).\n- CFrames are CFrame values — `part.CFrame = CFrame.new(...)`; never a number or a single `Vector3`.\n- Region3int16 via `region.Min.X`/`region.Max.X`.\n- FindFirstChild() before access; nil-check nested reads (`if obj and obj.Props then`).\n- NEVER pass nil values into `Vector3.new()` or assign nil to a `.Size` property — always validate x/y/z as non-nil numbers or use fallbacks (`Vector3.new(x or 4, y or 1, z or 2)`).\nTable & String Operations: NEVER pass `Instance` objects directly to `table.concat()` ' extract `.Name` or string properties first.'.\nEnum Correctness: `Wedge` is a Shape (`part.Shape = Enum.PartType.Wedge`), NOT a Material. Valid rock materials are `Enum.Material.Rock`, `Enum.Material.Basalt`, `Enum.Material.Slate`, `Enum.Material.Pebble`.\nTerrain Manipulation: NEVER call `workspace.Terrain:Destroy()` ' use `workspace.Terrain:Clear()`. ' For `FillBlock`/`FillRegion`, ensure all axes >= 1 to avoid 'Extents cannot be empty'.\nLighting & SunRaysEffect: `SunRaysEffect` only accepts `Intensity` (0-1) and `Spread` (0-1). NEVER set `.Size` or `.SunRaysSize` ' invalid members.'.\nDefensive Reference Checking: ALWAYS verify existence before `:GetChildren()`/`:ClearAllChildren()` ' `local folder = workspace:FindFirstChild('MyFolder'); if folder then folder:ClearAllChildren() end`.\n.\n\n",
      },
    },
  };
}
