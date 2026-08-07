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

export function createOpenCodeConfig(broker: { url: string }) {
  return {
    // Keep OpenCode's standard automatic context compaction enabled for long sessions.
    compaction: {
      auto: true,
    },
    mcp: {
      "roblox-studio": {
        type: "remote",
        url: broker.url,
        enabled: true,
      },
    },
    default_agent: "studio",
    agent: {
      studio: {
        mode: "primary",
        description: "Roblox Studio development assistant",
        // OpenCode loads project AGENTS.md separately; keep this Studio-specific and compact.
        prompt:
          "Use Studio MCP directly. Act on the request with the smallest coherent change. Inspect only when needed to avoid guessing. Preserve Luau conventions. Verify once with the most relevant Studio check, then report briefly. If Studio is unavailable, give one reconnect instruction and stop.\n\n" +
          "ROJO LIVE-SYNC: All files you write under src/, server/, or client/ auto-sync live to Roblox Studio via the running `rojo serve` (default port 34872). Preserve default.project.json's structural layout and standard Roblox pathing (ServerScriptService, ReplicatedStorage, StarterPlayerScripts). After a restore_checkpoint, wait briefly for Rojo to pick up the reverted filesystem content before reporting the code as live-synced.",
      },
    },
  };
}
