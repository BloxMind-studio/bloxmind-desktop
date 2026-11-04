import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const skill = readFileSync(
  join(process.cwd(), ".agents", "skills", "roblox-world-boundaries", "SKILL.md"),
  "utf8",
);

describe("roblox-world-boundaries skill", () => {
  it("declares the frontmatter OpenCode needs to advertise it", () => {
    expect(skill).toContain("name: roblox-world-boundaries");
    expect(skill).toMatch(/description: Use whenever creating/);
  });

  it("covers every layer that keeps a map from ending in empty space", () => {
    expect(skill).toContain("## Layer 1 - Sky and atmosphere");
    expect(skill).toContain("## Layer 2 - Backdrop / matte painting");
    expect(skill).toContain("## Layer 3 - Ground and terrain edges");
    expect(skill).toContain("## Layer 4 - Perimeter and out-of-bounds");
    expect(skill).toContain("CanQuery = false");
    expect(skill).toContain("server-side");
  });

  it("ends with a verification pass before the map is called complete", () => {
    expect(skill).toContain("## Verify before reporting complete");
    expect(skill).toContain("## Common mistakes");
  });
});
