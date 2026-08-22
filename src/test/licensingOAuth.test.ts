import { describe, expect, it } from "vitest";

import {
  base64UrlEncode,
  buildAuthorizeUrl,
  createCodeChallenge,
  extractCallbackUrlFromArgs,
  normalizeUserInfo,
  parseAuthCallbackUrl,
  pickSessionToken,
  randomToken,
} from "../../electron/licensingOAuth";

describe("base64UrlEncode / randomToken", () => {
  it("produces URL-safe output without padding", () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 254]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique random tokens", () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("createCodeChallenge", () => {
  it("is deterministic for the same verifier", () => {
    const verifier = randomToken(48);
    expect(createCodeChallenge(verifier)).toBe(createCodeChallenge(verifier));
  });

  it("is S256-length (43 base64url chars)", () => {
    const challenge = createCodeChallenge(randomToken(48));
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes the PKCE and OAuth parameters", () => {
    const url = buildAuthorizeUrl({ clientId: "test-client", state: "abc", codeChallenge: "xyz" });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://apis.roblox.com");
    expect(parsed.pathname).toBe("/oauth/v1/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-client");
    expect(parsed.searchParams.get("redirect_uri")).toBe("bloxmind://auth/roblox/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("openid profile");
    expect(parsed.searchParams.get("state")).toBe("abc");
    expect(parsed.searchParams.get("code_challenge")).toBe("xyz");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("parseAuthCallbackUrl", () => {
  it("parses a valid callback", () => {
    const result = parseAuthCallbackUrl("bloxmind://auth/roblox/callback?code=abc&state=xyz");
    expect(result).toEqual({ ok: true, code: "abc", state: "xyz" });
  });

  it("rejects malformed URLs", () => {
    expect(parseAuthCallbackUrl("not a url")).toEqual({
      ok: false,
      reason: "Malformed callback URL",
    });
  });

  it("rejects non-bloxmind protocols", () => {
    expect(parseAuthCallbackUrl("https://auth/roblox/callback?code=abc&state=xyz")).toEqual({
      ok: false,
      reason: "Callback URL does not use the BloxMind protocol",
    });
  });

  it("rejects a wrong path", () => {
    expect(parseAuthCallbackUrl("bloxmind://auth/other?code=abc&state=xyz")).toEqual({
      ok: false,
      reason: "Callback URL is not a Roblox auth redirect",
    });
  });

  it("surfaces an OAuth error", () => {
    expect(
      parseAuthCallbackUrl("bloxmind://auth/roblox/callback?error=access_denied&state=xyz"),
    ).toEqual({ ok: false, reason: "access_denied" });
  });

  it("rejects a callback missing the code", () => {
    expect(parseAuthCallbackUrl("bloxmind://auth/roblox/callback?state=xyz")).toEqual({
      ok: false,
      reason: "Callback URL is missing the auth code",
    });
  });
});

describe("extractCallbackUrlFromArgs", () => {
  it("finds a bloxmind deep-link among argv", () => {
    const argv = ["C:\\app.exe", "--flag", "bloxmind://auth/roblox/callback?code=abc&state=xyz"];
    expect(extractCallbackUrlFromArgs(argv)).toBe(
      "bloxmind://auth/roblox/callback?code=abc&state=xyz",
    );
  });

  it("returns null when no deep-link is present", () => {
    expect(extractCallbackUrlFromArgs(["C:\\app.exe", "--flag"])).toBeNull();
  });
});

describe("pickSessionToken", () => {
  it("reads a top-level token", () => {
    expect(pickSessionToken({ token: "jwt" })).toBe("jwt");
  });

  it("reads a top-level jwt", () => {
    expect(pickSessionToken({ jwt: "jwt" })).toBe("jwt");
  });

  it("reads a nested data.token", () => {
    expect(pickSessionToken({ data: { token: "jwt" } })).toBe("jwt");
  });

  it("reads a nested data.jwt", () => {
    expect(pickSessionToken({ data: { jwt: "jwt" } })).toBe("jwt");
  });

  it("returns null for missing or non-string tokens", () => {
    expect(pickSessionToken({})).toBeNull();
    expect(pickSessionToken({ token: 42 })).toBeNull();
    expect(pickSessionToken(null)).toBeNull();
  });
});

describe("normalizeUserInfo", () => {
  it("maps sub and preferred_username", () => {
    expect(
      normalizeUserInfo({
        sub: "123456",
        preferred_username: "PlayerOne",
        picture: "https://x/p.png",
      }),
    ).toEqual({ userId: "123456", username: "PlayerOne", avatarUrl: "https://x/p.png" });
  });

  it("falls back to name when preferred_username is missing", () => {
    expect(normalizeUserInfo({ sub: "123456", name: "PlayerOne" })).toEqual({
      userId: "123456",
      username: "PlayerOne",
      displayName: "PlayerOne",
    });
  });

  it("returns null when identity claims are missing", () => {
    expect(normalizeUserInfo({})).toBeNull();
    expect(normalizeUserInfo(null)).toBeNull();
  });
});
