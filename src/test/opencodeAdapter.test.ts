import { describe, expect, it } from "vitest";
import { normalizeExecutionError, normalizePermissionRequest } from "@/lib/oc2Normalize";
import { translateOc2FilePart, translateOc2Message } from "@/lib/opencode/client";

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
