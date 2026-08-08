/** Parsed semantic version used by the update check. */
export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a version like "0.9.5" or "v0.9.5" (leading "v" allowed, trailing
 * pre-release/build metadata ignored). Returns null for unparseable input.
 */
export function parseReleaseVersion(version: string): ReleaseVersion | null {
  const match = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Numeric semver comparison: negative when a < b, 0 when equal, positive when
 * a > b. String comparison is deliberately avoided ("0.10.0" vs "0.9.5").
 */
export function compareReleaseVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
