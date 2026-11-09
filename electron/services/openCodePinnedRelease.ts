/**
 * The known-good OpenCode release BloxMind installs when there is no cached copy and
 * GitHub's release API can't be reached (for example when it rate-limits a shared IP).
 * It downloads straight from github.com/.../releases/download/..., which the API limit
 * does not cover, and is verified against the SHA-256 below.
 *
 * To bump it:
 * 1. Pick a stable OpenCode 2.x release that BloxMind has run with.
 * 2. Copy each asset's `digest` (without the `sha256:` prefix) from
 *    `gh api repos/anomalyco/opencode/releases/tags/<tag>`.
 * 3. Run `pnpm check:opencode-pin` to confirm the hashes match GitHub's published digests.
 */

export interface PinnedOpenCodeAsset {
  readonly assetName: string;
  readonly url: string;
  readonly sha256: string;
}

export interface PinnedOpenCodeRelease {
  readonly version: string;
  /** Keyed by `${platform}-${arch}`, one entry per platform BloxMind supports. */
  readonly assets: Readonly<Record<string, PinnedOpenCodeAsset>>;
}

const TAG = "v2.2.6";
const download = (assetName: string) =>
  `https://github.com/anomalyco/opencode/releases/download/${TAG}/${assetName}`;

export const PINNED_OPENCODE_RELEASE: PinnedOpenCodeRelease = {
  version: "2.2.6",
  assets: {
    "darwin-arm64": {
      assetName: "opencode-darwin-arm64.zip",
      url: download("opencode-darwin-arm64.zip"),
      sha256: "15491608f6b0bc4debe5eac35eab629a2b07ea9a1fbac68ad53bcea59fcc4b45",
    },
    "darwin-x64": {
      assetName: "opencode-darwin-x64.zip",
      url: download("opencode-darwin-x64.zip"),
      sha256: "b2962dc445d873df56ae7d3ba7e66502b046bbc4dafa820eca18d0303a98a29c",
    },
    "win32-x64": {
      assetName: "opencode-windows-x64.zip",
      url: download("opencode-windows-x64.zip"),
      sha256: "f75c16b33b8523fe1ff41e7d97e3ae654a47d59a0e327def24db2d9291bb24be",
    },
    "linux-x64": {
      assetName: "opencode-linux-x64.tar.gz",
      url: download("opencode-linux-x64.tar.gz"),
      sha256: "08bb21d6326ce740d91cce7ebe88a6536933f6e1e30353b91a06b01f25da306c",
    },
  },
};
