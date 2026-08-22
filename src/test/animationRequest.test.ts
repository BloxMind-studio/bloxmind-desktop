import { describe, expect, it } from "vitest";
import { formatAnimationPrompt } from "@/lib/animationRequest";

describe("formatAnimationPrompt", () => {
  it("includes rig, loop, and verification instructions", () => {
    const prompt = formatAnimationPrompt({
      brief: "A heavy sword slash with recovery",
      kind: "combat combo",
      rig: "both",
      duration: "1.5s",
      loop: false,
      beats: ["wind-up", "impact", "recover"],
      notes: "No root motion",
    });

    expect(prompt).toContain("roblox-animation");
    expect(prompt).toContain("roblox-animation-runtime");
    expect(prompt).toContain("Rig target: Both");
    expect(prompt).toContain("Loop: no");
    expect(prompt).toContain("Key beats: wind-up | impact | recover");
    expect(prompt).toContain("Verify playback in Studio");
  });
});
