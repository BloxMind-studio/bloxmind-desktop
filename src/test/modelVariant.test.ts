import { describe, expect, it } from "vitest";
import { resolveVariantForModel } from "@/lib/modelVariant";

describe("resolveVariantForModel", () => {
  it("keeps a variant the new model still offers", () => {
    expect(resolveVariantForModel("high", ["low", "medium", "high"])).toBe("high");
  });

  it("falls back to medium when the choice is not offered", () => {
    expect(resolveVariantForModel("high", ["low", "medium"])).toBe("medium");
  });

  it("defaults to medium when nothing is selected yet", () => {
    expect(resolveVariantForModel(null, ["low", "medium", "high"])).toBe("medium");
  });

  it("leaves the model default alone when it has no medium variant", () => {
    expect(resolveVariantForModel(null, [])).toBeNull();
    expect(resolveVariantForModel("high", ["low"])).toBeNull();
  });
});
