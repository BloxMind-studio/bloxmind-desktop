import { createHash, randomBytes } from "node:crypto";

import {
  BLOXMIND_PROTOCOL,
  ROBLOX_OAUTH_AUTHORIZE_ENDPOINT,
  ROBLOX_OAUTH_REDIRECT_URI,
  ROBLOX_OAUTH_SCOPES,
} from "./licensingConfig";

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function randomToken(byteLength: number): string {
  return base64UrlEncode(randomBytes(byteLength));
}

export function createCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

export interface AuthorizeParams {
  clientId: string;
  state: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl({ clientId, state, codeChallenge }: AuthorizeParams): string {
  const url = new URL(ROBLOX_OAUTH_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", ROBLOX_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ROBLOX_OAUTH_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type CallbackResult =
  | { ok: true; code: string; state: string }
  | { ok: false; reason: string };

export function parseAuthCallbackUrl(rawUrl: string): CallbackResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Malformed callback URL" };
  }
  if (url.protocol !== `${BLOXMIND_PROTOCOL}:`) {
    return { ok: false, reason: "Callback URL does not use the BloxMind protocol" };
  }
  if (url.host !== "auth" || url.pathname !== "/roblox/callback") {
    return { ok: false, reason: "Callback URL is not a Roblox auth redirect" };
  }
  const error = url.searchParams.get("error");
  if (error) return { ok: false, reason: error };
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return { ok: false, reason: "Callback URL is missing the auth code" };
  return { ok: true, code, state };
}

export function extractCallbackUrlFromArgs(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith(`${BLOXMIND_PROTOCOL}://`)) return arg;
  }
  return null;
}

/** Normalizes the many plausible JWT shapes a licensing server may return. */
export function pickSessionToken(response: unknown): string | null {
  if (response === null || typeof response !== "object") return null;
  const candidate = (response as Record<string, unknown>).token;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  const jwt = (response as Record<string, unknown>).jwt;
  if (typeof jwt === "string" && jwt.length > 0) return jwt;
  const data = (response as Record<string, unknown>).data;
  if (data !== null && typeof data === "object") {
    const dataToken = (data as Record<string, unknown>).token;
    if (typeof dataToken === "string" && dataToken.length > 0) return dataToken;
    const dataJwt = (data as Record<string, unknown>).jwt;
    if (typeof dataJwt === "string" && dataJwt.length > 0) return dataJwt;
  }
  return null;
}

export interface NormalizedUserInfo {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

/** Maps an OIDC userinfo payload to the fields the license server needs. */
export function normalizeUserInfo(payload: unknown): NormalizedUserInfo | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const userId = String(record.sub ?? record.userId ?? record.id ?? "");
  const username = String(record.preferred_username ?? record.name ?? record.username ?? "");
  if (!userId || !username) return null;
  const normalized: NormalizedUserInfo = { userId, username };
  const displayName = record.name ?? record.displayName;
  if (typeof displayName === "string") normalized.displayName = displayName;
  const avatarUrl = record.picture;
  if (typeof avatarUrl === "string") normalized.avatarUrl = avatarUrl;
  return normalized;
}
