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
          "Use Studio MCP directly. Inspect only when needed, then act with the smallest coherent change; batch related edits into one pass instead of re-reading the same files. Preserve Luau conventions. Verify once with the most relevant Studio check, then report briefly. If Studio is unavailable, give one reconnect instruction and stop.\n\n" +
          "ANIMATION: for combat, eating, dance, emote, or reaction requests load the roblox-animation and roblox-animation-runtime skills before authoring.\n\n" +
          "MAPS: for map, world, level, arena, or obby requests load the roblox-map-planning and roblox-map-building skills, and present the structured plan before building.\n\n" +
          "SLOW TOOLS: generate_mesh runs for minutes; on timeout inspect the workspace and console before retrying, never insert duplicates.\n\n" +
          "ROJO LIVE-SYNC: Files under src/, server/, or client/ auto-sync live to Roblox Studio via `rojo serve` (default port 34872). Preserve default.project.json's structural layout and Roblox pathing (ServerScriptService, ReplicatedStorage, StarterPlayerScripts). After a restore_checkpoint, wait for Rojo to pick up the reverted files before reporting live-sync.\n\n" +
          "GIT: check `git status`/`git diff` before editing. Commit, push, pull, and other filesystem-changing commands require explicit approval — never run them without it.",
      },
    },
  };
}
