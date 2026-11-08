/**
 * The known-good OpenCode release BloxMind installs when there is no cached copy and
 * GitHub's release API can't be reached (for example when it rate-limits a shared IP).
 * It downloads straight from github.com/.../releases/download/..., which the API limit
 * does not cover, and is verified against the SHA-256 below.
 *
 * To bump it:
 * 1. Pick a stable 1.x.x release that BloxMind has run with.
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

const TAG = "v1.19.5";
const download = (assetName: string) =>
  `https://github.com/anomalyco/opencode/releases/download/${TAG}/${assetName}`;

export const PINNED_OPENCODE_RELEASE: PinnedOpenCodeRelease = {
  version: "1.19.5",
  assets: {
    "darwin-arm64": {
      assetName: "opencode-darwin-arm64.zip",
      url: download("opencode-darwin-arm64.zip"),
      sha256: "c1c9e62521192192ef4c3ed1355ada2144055bddb61682217e997b03c55203c1",
    },
    "darwin-x64": {
      assetName: "opencode-darwin-x64.zip",
      url: download("opencode-darwin-x64.zip"),
      sha256: "b0212efa6db347187225a17fa3a31c6b261bf4c9f1589a290b0ca902d720d250",
    },
    "win32-x64": {
      assetName: "opencode-windows-x64.zip",
      url: download("opencode-windows-x64.zip"),
      sha256: "09a6e693157f0887e504f2cf4357a8cbddc5ead5d0dffb9a269dcc47c48640f5",
    },
    "linux-x64": {
      assetName: "opencode-linux-x64.tar.gz",
      url: download("opencode-linux-x64.tar.gz"),
      sha256: "588310a336fa3b9df36b3f0225b26f679d453efaad0cf3d66c3651ef3ec1647a",
    },
  },
};
