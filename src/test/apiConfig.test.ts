import { describe, expect, it } from "vitest";
import { resolveApiEndpoint } from "@/lib/apiConfig";
import type { OpenCodeInfo } from "@/types/desktop";

function info(port = 4096): OpenCodeInfo {
  return { authorization: "Bearer local-token", port, workspace: "/tmp/ws" };
}

describe("resolveApiEndpoint (desktop)", () => {
  it("returns cloud mode when the URL is set", () => {
    const result = resolveApiEndpoint(info(), "https://engine.example.com", "secret-token");
    expect(result).toEqual({
      isCloud: true,
      baseUrl: "https://engine.example.com",
      authorization: "Bearer secret-token",
    });
  });

  it("strips trailing slashes from the cloud baseUrl", () => {
    const result = resolveApiEndpoint(info(), "https://engine.example.com/", "secret-token");
    expect(result.baseUrl).toBe("https://engine.example.com");
  });

  it("returns local mode when the URL is not set", () => {
    const result = resolveApiEndpoint(info(4096), null, null);
    expect(result).toEqual({
      isCloud: false,
      baseUrl: "http://127.0.0.1:4096",
      authorization: "Bearer local-token",
    });
  });

  it("returns null authorization when cloud URL is set but token is empty", () => {
    const result = resolveApiEndpoint(info(), "https://engine.example.com", null);
    expect(result.isCloud).toBe(true);
    expect(result.authorization).toBeNull();
  });
});
