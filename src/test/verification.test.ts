/**
 * Tests for the user-selectable verification level.
 *
 * The level lives in Settings → Behavior and rides along with every message,
 * so these tests pin the option list and the exact guidance each level sends.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERIFICATION_LEVEL,
  VERIFICATION_OPTIONS,
  verificationGuidance,
} from "@/lib/verification";

describe("verification levels", () => {
  it("offers every level exactly once", () => {
    const values = VERIFICATION_OPTIONS.map((option) => option.value);
    expect(values).toEqual(["off", "ask", "quick", "full"]);
    expect(new Set(values).size).toBe(values.length);
    expect(DEFAULT_VERIFICATION_LEVEL).toBe("quick");
  });

  it("describes what each level does", () => {
    for (const option of VERIFICATION_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
      expect(option.instruction.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the default level for missing or unknown values", () => {
    expect(verificationGuidance(undefined)).toBe(verificationGuidance(DEFAULT_VERIFICATION_LEVEL));
    expect(verificationGuidance(null)).toBe(verificationGuidance(DEFAULT_VERIFICATION_LEVEL));
    expect(verificationGuidance("nonsense" as never)).toBe(
      verificationGuidance(DEFAULT_VERIFICATION_LEVEL),
    );
  });

  it("sends the matching instruction for the chosen level", () => {
    const off = verificationGuidance("off");
    expect(off).toContain("## Verification level: Off");
    expect(off).toContain("Do not verify the change");

    const ask = verificationGuidance("ask");
    expect(ask).toContain("## Verification level: Ask me");
    expect(ask).toContain("ask the user to try it in Studio");

    const quick = verificationGuidance("quick");
    expect(quick).toContain("## Verification level: Quick check");
    expect(quick).toContain("one screenshot");
    expect(quick).toContain("Do not run playtests");
    expect(quick).toContain("simulated clicks");

    const full = verificationGuidance("full");
    expect(full).toContain("## Verification level: Full test");
    expect(full).toContain("playtest the place");
    expect(full).toContain("logs");
  });

  it("treats a mis-aimed check as a test mistake, not a product bug", () => {
    for (const option of VERIFICATION_OPTIONS) {
      const guidance = verificationGuidance(option.value);
      expect(guidance).toContain("A missed click or wrong target is a test mistake, not a bug");
      expect(guidance).toContain("correct the check at most once");
      expect(guidance).toContain("Never re-run a check that already passed");
    }
  });

  it("lets an explicit request in the user's message still run", () => {
    for (const option of VERIFICATION_OPTIONS) {
      expect(verificationGuidance(option.value)).toContain(
        "A test the user asks for in their own message still runs.",
      );
    }
  });
});
