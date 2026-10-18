import type { Config, OpencodeClient } from "@opencode-ai/sdk/v2/client";

import { STUDIO_MCP_SERVER_NAME } from "./bloxbotProgramManifest";

/** One extra MCP server the user configured in Settings → Integrations. */
export interface McpServerConfig {
  /** Unique name; shown to the agent as the tool prefix. */
  name: string;
  type: "local" | "remote";
  /** Full command line for `local` servers, first entry is the executable. */
  command: string[] | null;
  /** Streamable HTTP endpoint for `remote` servers. */
  url: string | null;
  enabled: boolean;
  /**
   * Extra environment variables for `local` servers. The Blender preset uses
   * this to switch the bridge's anonymous telemetry off.
   */
  environment?: Record<string, string> | null;
}

export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

/**
 * The Studio-side companion to the Blender bridge: Cautioned's "Blender
 * Animations (ultimate edition)" plugin, which moves R15 rigs and animations
 * between Blender and Studio. Roblox requires Creator Store plugins to be
 * installed from its own listing, so the best an app can do is open this page.
 */
export const BLENDER_ANIMATIONS_PLUGIN_ID = 16708835782;
export const BLENDER_ANIMATIONS_PLUGIN_URL =
  "https://create.roblox.com/store/asset/16708835782/Blender-Animations-ultimate-edition";

/** The built-in Studio bridge is written by the app and can't be shadowed. */
export function isReservedMcpServerName(name: string): boolean {
  return name.toLowerCase() === STUDIO_MCP_SERVER_NAME;
}

/**
 * Validate one server for the engine and the UI. Returns a user-facing error
 * string, or null when the server is complete. Name uniqueness across the list
 * is the caller's to enforce (see `validateMcpServers`).
 */
export function validateMcpServer(server: McpServerConfig): string | null {
  if (!MCP_SERVER_NAME_PATTERN.test(server.name)) {
    return "Use 1–48 letters, numbers, dashes or underscores.";
  }
  if (isReservedMcpServerName(server.name)) {
    return "That name is reserved by the built-in Studio connection.";
  }
  if (server.type === "local") {
    if (!server.command || server.command.length === 0) {
      return "Enter the command that starts the server.";
    }
  } else {
    if (!server.url?.trim()) return "Enter the server URL.";
    try {
      const parsed = new URL(server.url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "Only http:// and https:// URLs are supported.";
      }
    } catch {
      return "That URL doesn't look valid.";
    }
  }
  return null;
}

/** Validate a whole list; returns the first error per server name. */
export function validateMcpServers(servers: readonly McpServerConfig[]): Map<string, string> {
  const errors = new Map<string, string>();
  const seen = new Set<string>();
  for (const server of servers) {
    const error = validateMcpServer(server);
    if (error) {
      errors.set(server.name, error);
      continue;
    }
    const key = server.name.toLowerCase();
    if (seen.has(key)) {
      errors.set(server.name, "Every server needs a unique name.");
      continue;
    }
    seen.add(key);
  }
  return errors;
}

/**
 * Split a command line into argv entries, honoring double quotes so paths with
 * spaces work ("C:\\Program Files\\uv\\uvx.exe" blender-mcp).
 */
export function parseCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      hasToken = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === " " || char === "\t") {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

/** Keeps only usable string env vars for the engine; returns null when empty. */
export function normalizeEnvironment(
  environment: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!environment) return null;
  const entries = Object.entries(environment).filter(
    ([key, value]) => key.trim() !== "" && typeof value === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/** The engine-facing config entry for one server. Disabled servers are kept. */
export function toEngineMcpConfig(
  server: McpServerConfig,
):
  | { type: "local"; command: string[]; environment?: Record<string, string>; enabled: boolean }
  | { type: "remote"; url: string; enabled: boolean } {
  if (server.type === "local") {
    const environment = normalizeEnvironment(server.environment);
    return {
      type: "local",
      command: [...(server.command ?? [])],
      ...(environment ? { environment } : {}),
      enabled: server.enabled,
    };
  }
  return { type: "remote", url: server.url?.trim() ?? "", enabled: server.enabled };
}

/**
 * The config entries to push into the running engine for `servers`, including
 * `disabled` placeholders for servers the user removed so they stop serving
 * tools immediately. Removal can't delete the entry outright: the server's
 * config schema rejects `null` MCP entries, and the app rewrites the engine
 * config file from scratch on the next start, which is when removed servers
 * disappear for good.
 */
export function buildMcpConfigPatch(
  servers: readonly McpServerConfig[],
  removedNames: readonly string[] = [],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const server of servers) {
    if (validateMcpServer(server)) continue;
    patch[server.name] = toEngineMcpConfig(server);
  }
  for (const name of removedNames) {
    if (isReservedMcpServerName(name)) continue;
    patch[name] ??= { enabled: false };
  }
  return patch;
}

/**
 * Push the MCP server list into the running OpenCode server and reconcile the
 * connection state of each entry. Verified against the local 1.19.x server:
 * a config update hot-applies new servers (and auto-connects them), a partial
 * `{ enabled }` update flips an existing entry, and `disconnect` stops one
 * immediately. Failures are the caller's to surface; individual connect or
 * disconnect misses are ignored because the engine may not know a lazy entry.
 */
export async function applyMcpServers(
  client: OpencodeClient,
  servers: readonly McpServerConfig[],
  removedNames: readonly string[] = [],
): Promise<void> {
  const patch = buildMcpConfigPatch(servers, removedNames);
  if (Object.keys(patch).length > 0) {
    const configApi = client.global?.config;
    if (configApi) {
      await configApi.update({ config: { mcp: patch } as Config }, { throwOnError: true });
    }
  }
  const mcpApi = client.mcp;
  if (!mcpApi) return;
  const tasks: Promise<unknown>[] = [];
  for (const server of servers) {
    if (validateMcpServer(server)) continue;
    tasks.push(
      (server.enabled
        ? mcpApi.connect({ name: server.name })
        : mcpApi.disconnect({ name: server.name })
      ).catch(() => undefined),
    );
  }
  for (const name of removedNames) {
    if (isReservedMcpServerName(name)) continue;
    tasks.push(mcpApi.disconnect({ name }).catch(() => undefined));
  }
  await Promise.all(tasks);
}

/**
 * The one-click Blender integration: drives Blender through the Blender MCP
 * bridge. `uvxPath` comes from the automated setup so the entry keeps working
 * even when uv isn't on the user's PATH.
 */
export function blenderMcpServer(uvxPath?: string | null): McpServerConfig {
  return {
    name: "blender",
    type: "local",
    command: [uvxPath ?? "uvx", "mcp-for-blender"],
    url: null,
    enabled: true,
    // The bridge would otherwise collect anonymous usage telemetry.
    environment: { DISABLE_TELEMETRY: "1" },
  };
}
