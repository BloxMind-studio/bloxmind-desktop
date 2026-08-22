import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads `KEY=VALUE` lines from `.env` files without overriding variables that
 * are already present in the process environment. A dependency-free stand-in
 * for dotenv so the client id (and license URL) can be injected per stage:
 *
 * - Local dev: `<cwd>/.env`
 * - Production build: ship a `.env` via electron-builder `extraResources`
 *   (placed at `process.resourcesPath/.env`)
 */
function loadEnvFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    if (!filePath) continue;
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

const envFileCandidates = [
  join(process.cwd(), ".env"),
  typeof process.resourcesPath === "string" ? join(process.resourcesPath, ".env") : "",
];

loadEnvFiles(envFileCandidates);

export const LICENSE_SERVER_URL =
  process.env.BLOXMIND_LICENSE_API_URL?.trim() ||
  "https://bloxmind-core-engine-production.up.railway.app";

export const ROBLOX_OAUTH_AUTHORIZE_ENDPOINT = "https://apis.roblox.com/oauth/v1/authorize";
export const ROBLOX_OAUTH_TOKEN_ENDPOINT = "https://apis.roblox.com/oauth/v1/token";
export const ROBLOX_OAUTH_USERINFO_ENDPOINT = "https://apis.roblox.com/oauth/v1/userinfo";

/** The redirect URI registered in the Roblox Creator Dashboard OAuth app. */
export const ROBLOX_OAUTH_REDIRECT_URI = "bloxmind://auth/roblox/callback";

/** Custom protocol name; must match the redirect URI scheme. */
export const BLOXMIND_PROTOCOL = "bloxmind";

/**
 * Roblox OAuth app client id. Primary var: `ROBLOX_CLIENT_ID`
 * (`ROBLOX_OAUTH_CLIENT_ID` kept as a backwards-compatible alias).
 */
export const ROBLOX_OAUTH_CLIENT_ID =
  process.env.ROBLOX_CLIENT_ID?.trim() ?? process.env.ROBLOX_OAUTH_CLIENT_ID?.trim() ?? "";
export const ROBLOX_OAUTH_SCOPES = process.env.ROBLOX_OAUTH_SCOPES?.trim() ?? "openid profile";

export const LICENSE_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
export const LICENSE_LOGIN_TIMEOUT_MS = 5 * 60_000;
