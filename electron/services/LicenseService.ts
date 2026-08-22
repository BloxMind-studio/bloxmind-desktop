import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { app, safeStorage, shell } from "electron";
import { uuid as systemUuid } from "systeminformation";
import type { LicenseStatus, RobloxProfile } from "../../src/types/license";
import {
  LICENSE_HEARTBEAT_INTERVAL_MS,
  LICENSE_LOGIN_TIMEOUT_MS,
  LICENSE_SERVER_URL,
  ROBLOX_OAUTH_CLIENT_ID,
  ROBLOX_OAUTH_REDIRECT_URI,
  ROBLOX_OAUTH_TOKEN_ENDPOINT,
  ROBLOX_OAUTH_USERINFO_ENDPOINT,
} from "../licensingConfig";
import {
  buildAuthorizeUrl,
  createCodeChallenge,
  extractCallbackUrlFromArgs,
  normalizeUserInfo,
  parseAuthCallbackUrl,
  pickSessionToken,
  randomToken,
} from "../licensingOAuth";

const REQUEST_TIMEOUT_MS = 15_000;

interface PersistedLicenseState {
  token: string;
  profile: RobloxProfile;
}

interface PendingLogin {
  state: string;
  codeVerifier: string;
  resolve: (callbackUrl: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function stateFilePath(): string {
  return join(app.getPath("userData"), "license-state.bin");
}

function isAuthRejection(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "statusCode" in error &&
    (error as { statusCode: number }).statusCode >= 400
  );
}

export interface LicenseService {
  loginWithRoblox(): Promise<LicenseStatus>;
  getLicenseStatus(): LicenseStatus;
  logout(): Promise<void>;
  restoreSession(): Promise<LicenseStatus>;
  handleAuthCallbackUrl(rawUrl: string): void;
  handleStartupArgs(argv: string[]): void;
  onStatus(listener: (status: LicenseStatus) => void): () => void;
  onRevoked(listener: () => void): () => void;
  stop(): void;
}

export function createLicenseService(): LicenseService {
  const emitter = new EventEmitter();

  let token: string | null = null;
  let profile: RobloxProfile | null = null;
  let hwid: string | null = null;
  let pendingLogin: PendingLogin | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  // LICENSING BYPASS: the Roblox-license gate is only enforced in packaged,
  // production builds that carry a configured ROBLOX_CLIENT_ID. Two situations
  // intentionally bypass the gate and launch straight into the app:
  //
  //   1. Running from source (`pnpm dev`) — development needs no client id.
  //   2. Packaged test/preview builds with NO client id configured — so a
  //      build can never dead-lock users on the sign-in screen while the
  //      production OAuth secret is not yet injected by CI.
  //
  // The full OAuth/PKCE/JWT machinery below stays intact and begins enforcing
  // as soon as a real client id is configured.
  const isBypassMode = !app.isPackaged || !ROBLOX_OAUTH_CLIENT_ID;
  if (isBypassMode && app.isPackaged) {
    console.warn("[license] ROBLOX_CLIENT_ID not set. Defaulting to local test bypass mode.");
  }

  function getStatus(): LicenseStatus {
    if (isBypassMode) {
      return { kind: "authenticated", profile: null, hwid: null };
    }
    return {
      kind: token ? "authenticated" : "unauthenticated",
      profile,
      hwid,
    };
  }

  async function computeHwid(): Promise<string> {
    try {
      const info = await systemUuid();
      const source = info.hardware || info.os || "";
      if (source) {
        return createHash("sha256").update(source.trim().toLowerCase()).digest("hex").slice(0, 32);
      }
    } catch {
      // Fall through to a stable-ish machine fingerprint.
    }
    const fallback = `${process.platform}|${hostname()}|${process.getSystemVersion?.() ?? ""}`;
    return createHash("sha256").update(fallback).digest("hex").slice(0, 32);
  }

  async function exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ROBLOX_OAUTH_REDIRECT_URI,
      client_id: ROBLOX_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    });
    const response = await fetch(ROBLOX_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Roblox token exchange failed (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const accessToken = payload.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("Roblox token exchange returned no access token");
    }
    return accessToken;
  }

  async function fetchRobloxProfile(accessToken: string): Promise<RobloxProfile> {
    const response = await fetch(ROBLOX_OAUTH_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Roblox profile request failed (HTTP ${response.status})`);
    }
    const payload: unknown = await response.json();
    const normalized = normalizeUserInfo(payload);
    if (!normalized) {
      throw new Error("Roblox profile response was missing the user id or username");
    }
    return normalized;
  }

  /**
   * Mints a session token: POST /api/v1/license/verify with the Roblox profile
   * and machine HWID. Used only on first login (no auth header).
   */
  async function verifyLicense(userProfile: RobloxProfile, machineHwid: string): Promise<string> {
    const response = await fetch(`${LICENSE_SERVER_URL}/api/v1/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        robloxUserId: userProfile.userId,
        username: userProfile.username,
        hwid: machineHwid,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const error = new Error(`License verification failed (HTTP ${response.status})`);
      (error as { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    const payload: unknown = await response.json();
    const sessionToken = pickSessionToken(payload);
    if (!sessionToken) {
      throw new Error("License server returned no session token");
    }
    return sessionToken;
  }

  /**
   * Validates an existing session: POST /api/v1/license/ping with the Bearer
   * token and the machine HWID. A 200 may carry an optional refreshed JWT;
   * a 401/403 means revoked/expired/HWID-mismatched and must wipe the session.
   * Returns the (possibly refreshed) token, or null when the server did not
   * issue a new one.
   */
  async function pingLicense(sessionToken: string, machineHwid: string): Promise<string | null> {
    const response = await fetch(`${LICENSE_SERVER_URL}/api/v1/license/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ hwid: machineHwid }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const error = new Error(`License ping failed (HTTP ${response.status})`);
      (error as { statusCode?: number }).statusCode = response.status;
      throw error;
    }
    return pickSessionToken(await response.json());
  }

  async function persistState(): Promise<void> {
    if (!token || !profile) return;
    const payload = JSON.stringify({ token, profile } satisfies PersistedLicenseState);
    if (safeStorage.isEncryptionAvailable()) {
      await writeFile(stateFilePath(), safeStorage.encryptString(payload));
    }
  }

  async function loadPersistedState(): Promise<PersistedLicenseState | null> {
    try {
      const buffer = await readFile(stateFilePath());
      const payload = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buffer)
        : buffer.toString("utf8");
      const parsed = JSON.parse(payload) as Partial<PersistedLicenseState>;
      if (
        typeof parsed.token === "string" &&
        parsed.token.length > 0 &&
        parsed.profile &&
        typeof parsed.profile.userId === "string" &&
        typeof parsed.profile.username === "string"
      ) {
        return parsed as PersistedLicenseState;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function clearPersistedState(): Promise<void> {
    try {
      await rm(stateFilePath(), { force: true });
    } catch {
      // Best-effort; stale state is ignored on the next read anyway.
    }
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      void runHeartbeat();
    }, LICENSE_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function runHeartbeat(): Promise<void> {
    if (!token || !profile) return;
    try {
      const machineHwid = hwid ?? (await computeHwid());
      const refreshed = await pingLicense(token, machineHwid);
      if (refreshed && refreshed !== token) {
        token = refreshed;
        await persistState();
        emitter.emit("status", getStatus());
      }
    } catch (error) {
      if (isAuthRejection(error)) {
        await revoke();
      }
    }
  }

  async function revoke(): Promise<void> {
    token = null;
    profile = null;
    hwid = null;
    stopHeartbeat();
    await clearPersistedState();
    emitter.emit("status", getStatus());
    emitter.emit("revoked");
  }

  async function loginWithRoblox(): Promise<LicenseStatus> {
    if (!ROBLOX_OAUTH_CLIENT_ID) {
      throw new Error(
        "Roblox sign-in is not configured. Set ROBLOX_CLIENT_ID to your Roblox OAuth app's client id.",
      );
    }
    const state = randomToken(24);
    const codeVerifier = randomToken(48);
    const codeChallenge = createCodeChallenge(codeVerifier);

    void shell.openExternal(
      buildAuthorizeUrl({ clientId: ROBLOX_OAUTH_CLIENT_ID, state, codeChallenge }),
    );

    const callbackUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingLogin !== null) {
          pendingLogin = null;
          reject(new Error("Roblox sign-in timed out. Try again."));
        }
      }, LICENSE_LOGIN_TIMEOUT_MS);
      pendingLogin = { state, codeVerifier, resolve, reject, timer };
    });

    const parsed = parseAuthCallbackUrl(callbackUrl);
    if (!parsed.ok) throw new Error(parsed.reason);
    if (parsed.state !== state) throw new Error("Roblox sign-in state mismatch; please retry");

    const accessToken = await exchangeCode(parsed.code, codeVerifier);
    const userProfile = await fetchRobloxProfile(accessToken);
    const machineHwid = await computeHwid();
    const sessionToken = await verifyLicense(userProfile, machineHwid);

    token = sessionToken;
    profile = userProfile;
    hwid = machineHwid;
    await persistState();
    startHeartbeat();
    emitter.emit("status", getStatus());
    return getStatus();
  }

  async function logout(): Promise<void> {
    if (!token) return;
    await revoke();
  }

  async function restoreSession(): Promise<LicenseStatus> {
    const persisted = await loadPersistedState();
    if (!persisted) return getStatus();
    token = persisted.token;
    profile = persisted.profile;
    hwid = await computeHwid();
    emitter.emit("status", getStatus());
    try {
      const refreshed = await pingLicense(token, hwid);
      if (refreshed && refreshed !== token) {
        token = refreshed;
        await persistState();
      }
      startHeartbeat();
    } catch (error) {
      if (isAuthRejection(error)) {
        await revoke();
      } else {
        // Network hiccup at startup: keep the session and let the heartbeat
        // validate it once connectivity returns.
        startHeartbeat();
      }
    }
    return getStatus();
  }

  function handleAuthCallbackUrl(rawUrl: string): void {
    const parsed = parseAuthCallbackUrl(rawUrl);
    const pending = pendingLogin;
    if (!pending) return;
    if (!parsed.ok) {
      clearTimeout(pending.timer);
      pendingLogin = null;
      pending.reject(new Error(parsed.reason));
      return;
    }
    if (parsed.state !== pending.state) return;
    clearTimeout(pending.timer);
    pendingLogin = null;
    pending.resolve(rawUrl);
  }

  function handleStartupArgs(argv: string[]): void {
    const callbackUrl = extractCallbackUrlFromArgs(argv);
    if (callbackUrl) handleAuthCallbackUrl(callbackUrl);
  }

  function stop(): void {
    stopHeartbeat();
    if (pendingLogin) {
      clearTimeout(pendingLogin.timer);
      pendingLogin.reject(new Error("Roblox sign-in was cancelled"));
      pendingLogin = null;
    }
  }

  return {
    loginWithRoblox,
    getLicenseStatus: getStatus,
    logout,
    restoreSession,
    handleAuthCallbackUrl,
    handleStartupArgs,
    onStatus: (listener) => {
      emitter.on("status", listener);
      return () => emitter.off("status", listener);
    },
    onRevoked: (listener) => {
      emitter.on("revoked", listener);
      return () => emitter.off("revoked", listener);
    },
    stop,
  };
}

export type { LicenseStatus, RobloxProfile };
