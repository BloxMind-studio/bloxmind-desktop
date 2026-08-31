import { describe, expect, it } from "vitest";
import {
  autoCorrectLuauSource,
  validateLuauSource,
  validateMcpToolCall,
  validateGeneratedProgramSource,
} from "@/lib/robloxApiValidator";

describe("Roblox API Validator", () => {
  it("catches invalid Instance.new class", () => {
    const r = validateLuauSource(`local x = Instance.new("DirectionalLight")`);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.type === "forbidden-class")).toBe(true);
  });

  it("allows valid Instance.new class", () => {
    const r = validateLuauSource(`local x = Instance.new("Part")`);
    expect(r.valid).toBe(true);
  });

  it("catches unknown class", () => {
    const r = validateLuauSource(`Instance.new("FakeClass123")`);
    expect(r.issues.some((i) => i.type === "invalid-class")).toBe(true);
  });

  it("catches invalid Enum item", () => {
    const r = validateLuauSource(`local m = Enum.Material.Wedge`);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.type === "invalid-enum-item" || i.type === "invalid-material-as-parttype")).toBe(true);
  });

  it("catches invalid Enum.NormalId", () => {
    const r = validateLuauSource(`local n = Enum.NormalId.NegativeZ`);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.type === "invalid-enum-item")).toBe(true);
  });

  it("allows valid Enum", () => {
    const r = validateLuauSource(`local m = Enum.Material.Grass`);
    expect(r.valid).toBe(true);
  });

  it("catches invalid service GetService", () => {
    const r = validateLuauSource(`game:GetService("TeamService")`);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.type === "invalid-service")).toBe(true);
  });

  it("catches Lighting.Technology", () => {
    const r = validateLuauSource(`local t = game:GetService("Lighting").Technology`);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.type === "forbidden-property")).toBe(true);
  });

  it("catches Terrain:Destroy", () => {
    const r = validateLuauSource(`workspace.Terrain:Destroy()`);
    expect(r.valid).toBe(false);
  });

  it("ignores comments", () => {
    const r = validateLuauSource(`-- Instance.new("DirectionalLight") is in comment\nlocal x= Instance.new("Part")`);
    expect(r.valid).toBe(true);
  });

  it("validates MCP tool call with Luau payload", () => {
    const r = validateMcpToolCall("execute_luau", { code: `Instance.new("DirectionalLight")` });
    expect(r.valid).toBe(false);
  });

  it("passes non-luau tool", () => {
    const r = validateMcpToolCall("list_roblox_studios", {});
    expect(r.valid).toBe(true);
  });

  it("auto-corrects common typos", () => {
    const { corrected, applied } = autoCorrectLuauSource(`Instance.new("DirectionalLight") game:GetService("TeamService")`);
    expect(corrected).toContain("PointLight");
    expect(corrected).toContain("Teams");
    expect(applied.length).toBeGreaterThan(0);
  });

  it("validateGeneratedProgramSource extracts errors", () => {
    const envelopeSource = `
      async function run({ callTool }) {
        await callTool("execute_luau", { code: "local x = Instance.new(\\"DirectionalLight\\") local y = Enum.Material.Wedge" });
      }
    `;
    const r = validateGeneratedProgramSource(envelopeSource);
    expect(r.valid).toBe(false);
  });

  it("catches invalid property PointLight.BlinkRate", () => {
    const r = validateLuauSource(`local light = Instance.new("PointLight")\nlight.BlinkRate = 5`);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.type === "invalid-property" && i.raw?.includes("BlinkRate"))).toBe(true);
  });

  it("allows valid PointLight properties and does not flag Part.Size", () => {
    const r = validateLuauSource(`local light = Instance.new("PointLight")\nlight.Brightness = 2\nlight.Range = 10\nlocal p = Instance.new("Part")\np.Size = Vector3.new(4,1,2)`);
    expect(r.valid).toBe(true);
  });

  it("suggests SunRaysEffect for SunRays and LeafyGrass for Leaf", () => {
    const r1 = validateLuauSource(`Instance.new("SunRays")`);
    expect(r1.issues[0].suggestion).toContain("SunRaysEffect");
    const r2 = validateLuauSource(`local x = Enum.Material.Leaf`);
    expect(r2.issues[0].suggestion).toContain("LeafyGrass");
  });
});
