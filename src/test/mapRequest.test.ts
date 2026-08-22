import { describe, expect, it } from "vitest";
import { formatMapPrompt } from "@/lib/mapRequest";

describe("formatMapPrompt", () => {
  it("asks for the plan before building", () => {
    const prompt = formatMapPrompt({
      brief: "A neon arena with a tower in the middle",
      mode: "arena",
      playerCount: "8 players",
      traversalTime: "2 minutes",
      themePillars: ["neon dusk", "glass water"],
      landmarks: ["central tower", "spawn vista"],
      zones: ["spawn", "main loop", "high ground"],
      notes: "Keep the route readable",
    });

    expect(prompt).toContain("roblox-map-planning");
    expect(prompt).toContain("roblox-map-building");
    expect(prompt).toContain("present the written build plan before any building starts");
    expect(prompt).toContain("Theme pillars: neon dusk, glass water");
    expect(prompt).toContain("Zones: spawn, main loop, high ground");
  });
});
