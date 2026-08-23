import { join } from "node:path";

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
          "ROBLOX STUDIO API REFERENCE (verified — never guess engine methods):\n" +
          "- Studio target: call `list_roblox_studios` and use a returned `studio_id`. If you get 'studio_id is not connected', call `list_roblox_studios` again and use a fresh id; never reuse a cached one.\n" +
          "- Terrain (`Workspace.Terrain`): `FillBlock(cframe: CFrame, size: Vector3, material: Enum.Material)` — 3 args, NO resolution. `FillRegion(region: Region3, 4, material: Enum.Material)` — middle arg is the voxel resolution and MUST be exactly 4. `FillBall(center: Vector3, radius: number, material)`, `FillCylinder(cframe, height, radius, material)`. Material is `Enum.Material.Grass` etc.; NEVER a bare number (a number in the material slot throws 'Unable to cast double to Material').\n" +
          "- Regions: `Region3.new(Vector3.new(x1,y1,z1), Vector3.new(x2,y2,z2))` — two Vector3 corners, NOT six numbers ('invalid argument #1 to new (Vector3 expected, got number)'). Align terrain regions with `region:ExpandToGrid(4)`.\n" +
          "- Lighting: `Lighting.Technology = Enum.Technology.Future`. `Sky` has NO `SunRayColor` — use `Sky.SunAngularSize`/`Sky.SunTextureId`/skybox faces. `SunRaysEffect` (under Lighting) has NO `Color` — use `SunRaysIntensity`/`SunRaysSize`/`SunRaysSpread`.\n" +
          "- Luau: `Vector3.new(x, y, z)` takes exactly 3 numbers; initialize every variable before use (nil arithmetic throws 'attempt to perform arithmetic on nil'); keep scripts syntactically valid or `execute_luau` returns 'Failed to parse command code'. Prefer small, verified snippets over one huge script.\n\n" +
          "FRAMEWORKS: load roblox-knit and roblox-profile-service for Knit, ProfileService, or package systems; keep wally.toml and the Packages folder in sync with default.project.json.\n\n" +
          "ASSISTANT SKILLS: the Studio MCP also exposes rbx-* skills that complement the playbooks — use rbx-docs-search when unsure about a Roblox API, rbx-scene-analysis before editing an existing scene, rbx-unit-test after writing gameplay scripts, rbx-perf-profiling after large builds, and rbx-device-simulator-lua for mobile constraints.\n\n" +
          "SLOW TOOLS: generate_mesh runs for minutes; on timeout inspect before retrying, never insert duplicates.\n\n" +
          "ROJO: src/, server/, client/ auto-sync via `rojo serve`; preserve default.project.json's layout (ServerScriptService, ReplicatedStorage, StarterPlayerScripts). After restore_checkpoint, wait for Rojo to pick up reverted files.\n\n" +
          "GIT: check status/diff before editing; commit, push, pull, and other filesystem-changing commands need explicit approval.",
      },
    },
  };
}
