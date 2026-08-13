import { describe, expect, it } from "vitest";

import { compareReleaseVersions, parseReleaseVersion } from "../../electron/releaseVersion";

describe("parseReleaseVersion", () => {
  it("parses plain semver", () => {
    expect(parseReleaseVersion("0.9.5")).toEqual({ major: 0, minor: 9, patch: 5 });
  });

  it("strips a leading v", () => {
    expect(parseReleaseVersion("v0.9.5")).toEqual({ major: 0, minor: 9, patch: 5 });
  });

  it("ignores trailing pre-release or build metadata", () => {
    expect(parseReleaseVersion("1.2.3-beta.1")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("returns null for unparseable input", () => {
    expect(parseReleaseVersion("latest")).toBeNull();
    expect(parseReleaseVersion("")).toBeNull();
  });
});

describe("compareReleaseVersions", () => {
  it("reports equal versions as equal", () => {
    const a = parseReleaseVersion("0.9.5");
    const b = parseReleaseVersion("v0.9.5");
    expect(a && b && compareReleaseVersions(a, b)).toBe(0);
  });

  it("compares numerically instead of lexicographically", () => {
    const newer = parseReleaseVersion("0.10.0");
    const older = parseReleaseVersion("0.9.5");
    expect(newer && older && compareReleaseVersions(newer, older)).toBeGreaterThan(0);
    expect(newer && older && compareReleaseVersions(older, newer)).toBeLessThan(0);
  });

  it("orders major above minor above patch", () => {
    const one = parseReleaseVersion("1.0.0");
    const pointNine = parseReleaseVersion("0.9.9");
    expect(one && pointNine && compareReleaseVersions(one, pointNine)).toBeGreaterThan(0);
  });
});
