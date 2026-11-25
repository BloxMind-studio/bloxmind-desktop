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

const TAG = "v2.4.1";
const download = (assetName: string) =>
  `https://github.com/anomalyco/opencode/releases/download/${TAG}/${assetName}`;

export const PINNED_OPENCODE_RELEASE: PinnedOpenCodeRelease = {
  version: "2.4.1",
  assets: {
    "darwin-arm64": {
      assetName: "opencode-darwin-arm64.zip",
      url: download("opencode-darwin-arm64.zip"),
      sha256: "95a101eda95108478f1db43cff8fcbd4811f6c0e79af1e167301843c6a48d731",
    },
    "darwin-x64": {
      assetName: "opencode-darwin-x64.zip",
      url: download("opencode-darwin-x64.zip"),
      sha256: "a7a4c758a32488138531ab2d82be86e2a1438c35c017664f83daa1d5b63bb82c",
    },
    "win32-x64": {
      assetName: "opencode-windows-x64.zip",
      url: download("opencode-windows-x64.zip"),
      sha256: "831e00806531fabb184533ef85fead96eb92287cab2d0f21db7daaa494e75083",
    },
    "linux-x64": {
      assetName: "opencode-linux-x64.tar.gz",
      url: download("opencode-linux-x64.tar.gz"),
      sha256: "9ddd18e3faf64eaeccf6a0fcbc96a5c7a14520ae5fd5b61e5be51d894f478b47",
    },
  },
};
