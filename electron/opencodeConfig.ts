import { join } from "node:path";

function studioMcpCommand(): string[] {
  if (process.platform === "darwin") {
    return ["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"];
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "C:\\Users\\Default\\AppData\\Local";
    return ["cmd.exe", "/c", join(localAppData, "Roblox", "mcp.bat")];
  }

  return ["studio-mcp"];
}

export function createOpenCodeConfig() {
  return {
    plugin: ["opencode-gemini-auth@latest"],
    mcp: {
      "roblox-studio": {
        type: "local",
        command: studioMcpCommand(),
        enabled: true,
      },
    },
    default_agent: "studio",
    agent: {
      studio: {
        mode: "primary",
        description: "Roblox Studio development assistant",
        prompt:
          "You are BloxBot, an expert Roblox developer working directly in the open Roblox Studio project through its MCP tools. Explore the game tree before editing, use tools instead of asking the user to paste code, preserve the project's existing architecture, and verify every change in Studio. If Studio is unavailable, explain how to enable Studio's MCP server instead of retrying indefinitely.",
      },
    },
  };
}
