import { join, win32 } from "node:path";

import { STUDIO_MCP_SERVER_NAME } from "../src/lib/bloxbotProgramManifest";
import { type McpServerConfig, toEngineMcpConfig, validateMcpServer } from "../src/lib/mcpServers";

export interface StudioMcpWindowsEnvironment {
  localAppData?: string;
  comSpec?: string;
  systemRoot?: string;
}

export function studioMcpCommand(
  platform: NodeJS.Platform,
  environment: StudioMcpWindowsEnvironment = {},
): string[] {
  if (platform === "darwin") {
    return ["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"];
  }

  if (platform === "win32") {
    const dataDirectory = environment.localAppData ?? "C:\\Users\\Default\\AppData\\Local";
    // Resolve cmd.exe absolutely: the MCP stdio transport spawns with a reduced
    // environment, so a PATH without System32 makes a bare "cmd.exe" fail with ENOENT.
    const systemRoot = environment.systemRoot ?? "C:\\Windows";
    const comSpec = environment.comSpec ?? win32.join(systemRoot, "System32", "cmd.exe");
    return [comSpec, "/c", win32.join(dataDirectory, "Roblox", "mcp.bat")];
  }

  return ["studio-mcp"];
}

/**
 * The file Roblox Studio installs for its MCP helper, or null when the command is looked up
 * on PATH. When the file is missing, Studio isn't installed or hasn't set up MCP yet.
 */
export function studioMcpInstallPath(
  platform: NodeJS.Platform,
  environment: StudioMcpWindowsEnvironment = {},
): string | null {
  if (platform === "darwin" || platform === "win32") {
    return studioMcpCommand(platform, environment).at(-1) ?? null;
  }
  return null;
}

export interface OpenCodeRuntimePaths {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

/**
 * Directories OpenCode scans for SKILL.md. Packaged builds read the skills
 * electron-builder copies to resources/skills (see `extraResources`), while
 * development runs read the repository copy.
 */
export function skillDirectories(runtime: OpenCodeRuntimePaths): string[] {
  return runtime.isPackaged
    ? [join(runtime.resourcesPath, "skills")]
    : [join(runtime.appPath, ".agents", "skills")];
}

export function createOpenCodeConfig(
  broker: { url: string },
  skillsPaths: readonly string[] = [],
  mcpServers: readonly McpServerConfig[] = [],
) {
  // User-configured servers sit beside the built-in Studio bridge. Invalid
  // entries and reserved names are skipped rather than failing engine startup;
  // Settings validates before saving, so this is the last line of defense.
  const extraMcpServers = Object.fromEntries(
    mcpServers
      .filter((server) => validateMcpServer(server) === null)
      .map((server) => [server.name, toEngineMcpConfig(server)]),
  );
  const mcp: Record<string, ReturnType<typeof toEngineMcpConfig>> = {
    [STUDIO_MCP_SERVER_NAME]: {
      type: "remote",
      url: broker.url,
      enabled: true,
    },
    ...extraMcpServers,
  };
  return {
    // Keep OpenCode's standard automatic context compaction enabled for long sessions.
    compaction: {
      auto: true,
    },
    // Only advertised when a skill actually ships, so OpenCode never scans a missing directory.
    ...(skillsPaths.length > 0 ? { skills: { paths: [...skillsPaths] } } : {}),
    mcp,
    default_agent: "studio",
    agent: {
      studio: {
        mode: "primary",
        description: "Roblox Studio development assistant",
        // OpenCode loads project AGENTS.md separately; keep this Studio-specific and compact.
        prompt:
          "BloxMind is a standalone AI workspace: it works directly against Roblox Studio through the Studio MCP bridge. There is no Rojo, no default.project.json, and no local filesystem-to-Studio syncing — never look for, assume, or mention them; inspect and write only through the Studio MCP tools. Inspect before editing; never guess what MCP can read. Discover Studios when needed, choose by Studio ID and Place ID, and pass studio_id on every Studio-specific tool call; never call set_active_studio. Make the smallest coherent change, preserve Luau conventions, verify through reinspection and the most relevant Studio check, and report briefly. If Studio is unavailable, give one reconnect instruction, then stop retrying.",
      },
    },
  };
}
