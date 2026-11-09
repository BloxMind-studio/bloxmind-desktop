import { describe, expect, it, vi } from "vitest";
import { normalizeExecutionError, normalizePermissionRequest } from "@/lib/oc2Normalize";
import {
  createOpencodeClient,
  translateOc2FilePart,
  translateOc2Message,
} from "@/lib/opencode/client";

describe("OC2 OAuth adapter (stubbed engine)", () => {
  const oauthIntegration = {
    id: "anthropic",
    name: "Anthropic",
    methods: [
      { type: "env", names: ["ANTHROPIC_API_KEY"] },
      { id: "browser", type: "oauth", label: "Sign in with browser" },
    ],
  };

  function stubEngine() {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: `${init?.method ?? "GET"} ${url.pathname}`, body });
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname === "/api/provider/anthropic") {
        return json({ id: "anthropic", name: "Anthropic", integrationID: "anthropic" });
      }
      if (url.pathname === "/api/integration") {
        return json({ location: { directory: "ws" }, data: [oauthIntegration] });
      }
      if (url.pathname === "/api/integration/anthropic/connect/oauth") {
        return json({
          attemptID: "att-1",
          url: "https://auth.example.com/authorize",
          instructions: "Finish in your browser",
          mode: "code",
        });
      }
      if (url.pathname === "/api/integration/anthropic/connect/oauth/att-1/complete") {
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("resolves the OAuth method by dialog index and maps mode to method", async () => {
    const { calls, fetchImpl } = stubEngine();
    const client = createOpencodeClient({
      baseUrl: "http://127.0.0.1:1",
      directory: "ws",
      fetch: fetchImpl,
    });

    // The dialog shows oauth/key methods only; the env method before the oauth
    // one must not shift the index.
    const res = await client.provider.oauth.authorize({ providerID: "anthropic", method: 0 });

    expect(res.data).toMatchObject({
      url: "https://auth.example.com/authorize",
      method: "code",
      instructions: "Finish in your browser",
      attemptID: "att-1",
    });
    const connect = calls.find(
      (call) => call.url === "POST /api/integration/anthropic/connect/oauth",
    );
    expect(connect?.body).toMatchObject({ methodID: "browser" });
  });

  it("completes the OAuth attempt through the stored attempt id", async () => {
    const { calls, fetchImpl } = stubEngine();
    const client = createOpencodeClient({
      baseUrl: "http://127.0.0.1:1",
      directory: "ws",
      fetch: fetchImpl,
    });

    await client.provider.oauth.authorize({ providerID: "anthropic", method: 0 });
    const res = await client.provider.oauth.callback({
      providerID: "anthropic",
      method: 0,
      code: "abc123",
    });

    expect(res.data).toBe(true);
    const complete = calls.find(
      (call) => call.url === "POST /api/integration/anthropic/connect/oauth/att-1/complete",
    );
    expect(complete).toBeDefined();
  });
});

describe("OC2 permission normalization", () => {
  it("maps OC2 asked/list requests to the OC1 shape the UI renders", () => {
    const normalized = normalizePermissionRequest({
      id: "p1",
      sessionID: "s1",
      action: "write",
      resources: ["src/index.lua"],
      metadata: { source: "studio" },
    });
    expect(normalized).toMatchObject({
      id: "p1",
      sessionID: "s1",
      permission: "write",
      patterns: ["src/index.lua"],
      metadata: { source: "studio" },
    });
  });

  it("leaves already-OC1 requests untouched", () => {
    const normalized = normalizePermissionRequest({
      id: "p2",
      sessionID: "s1",
      permission: "read",
      patterns: ["a"],
      metadata: {},
    });
    expect(normalized).toMatchObject({ permission: "read", patterns: ["a"] });
  });
});

describe("OC2 error normalization", () => {
  it("maps SessionStructuredError to the OC1 { name, data } shape the UI reads", () => {
    const normalized = normalizeExecutionError({
      type: "ContextOverflowError",
      message: "prompt too long",
      status: 400,
      response: { body: "maximum context length exceeded" },
    });
    expect(normalized).toMatchObject({
      name: "ContextOverflowError",
      data: { message: "prompt too long", responseBody: "maximum context length exceeded" },
    });
  });

  it("passes OC1-shaped errors through", () => {
    const input = { name: "ProviderAuthError", data: { message: "nope" } };
    expect(normalizeExecutionError(input)).toBe(input);
  });
});

describe("OC2 file parts", () => {
  it("rebuilds a data URI from an inline base64 payload", () => {
    const part = translateOc2FilePart({
      data: "QUJD",
      mime: "image/png",
      source: { type: "inline" },
      name: "shot.png",
    });
    expect(part).toEqual({
      type: "file",
      mime: "image/png",
      url: "data:image/png;base64,QUJD",
      filename: "shot.png",
    });
  });

  it("uses the source URI for remote files", () => {
    const part = translateOc2FilePart({
      mime: "image/png",
      source: { type: "uri", uri: "https://example.com/shot.png" },
    });
    expect(part.url).toBe("https://example.com/shot.png");
  });
});

describe("OC2 message translation", () => {
  it("normalizes an assistant error carried by the timeline message", () => {
    const { info } = translateOc2Message("s1", {
      id: "m1",
      type: "assistant",
      agent: "studio",
      model: { providerID: "anthropic", id: "claude" },
      time: { created: 1 },
      content: [],
      error: {
        type: "ProviderAuthError",
        message: "bad key",
        status: 401,
        response: { body: "invalid api key" },
      },
    });
    expect(info.error).toMatchObject({
      name: "ProviderAuthError",
      data: { responseBody: "invalid api key", statusCode: 401 },
    });
  });
});
