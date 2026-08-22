import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Data, Effect, Layer } from "effect";
import extractZip from "extract-zip";
import { x as extractTar } from "tar";

// ── Types ────────────────────────────────────────────────────────────────

export class RojoInstallError extends Data.TaggedError("RojoInstallError")<{
  message: string;
  cause?: unknown;
}> {}

export type RojoInstallPhase =
  | "release-lookup"
  | "binary-download"
  | "binary-extract"
  | "plugin-download"
  | "plugin-install"
  | "done";

export interface RojoInstallProgress {
  phase: RojoInstallPhase;
  percent?: number;
  message: string;
}

export interface RojoInstallResult {
  version: string;
  binaryPath: string;
  pluginPath: string;
}

export interface RojoInstallerOptions {
  binDirectory: string;
  pluginsDirectory: string;
}

export interface RojoInstaller {
  readonly install: (
    onProgress: (progress: RojoInstallProgress) => void,
  ) => Effect.Effect<RojoInstallResult, RojoInstallError>;
  readonly getBinaryPath: () => Effect.Effect<string | null, RojoInstallError>;
  readonly checkInstalled: () => Effect.Effect<boolean, RojoInstallError>;
}

export class RojoInstallerTag extends Effect.Tag("@BloxMind/RojoInstaller")<
  RojoInstallerTag,
  RojoInstaller
>() {}

// ── Constants ────────────────────────────────────────────────────────────

const GITHUB_RELEASES_API = "https://api.github.com/repos/rojo-rbx/rojo/releases/latest";
const PLUGIN_NAME = "Rojo.rbxm";
const BINARY_NAME = process.platform === "win32" ? "rojo.exe" : "rojo";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface LatestRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function toEffectTry<T>(fn: () => Promise<T>, message: string): Effect.Effect<T, RojoInstallError> {
  return Effect.tryPromise({
    try: fn,
    catch: (cause) => new RojoInstallError({ message, cause }),
  });
}

async function downloadFile(
  url: string,
  destination: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "BloxMind" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} while downloading ${url}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const reader = response.body.getReader();

  const nodeStream = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        received += value.byteLength;
        onProgress(received, total);
        this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });

  const sink = createWriteStream(destination, { mode: 0o600 });
  await pipeline(nodeStream, sink);
}

async function getLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(GITHUB_RELEASES_API, {
    headers: { "User-Agent": "BloxMind" },
  });
  if (!response.ok) {
    throw new Error(`GitHub API responded with HTTP ${response.status}`);
  }
  const data = (await response.json()) as LatestRelease;
  if (!data.tag_name || !Array.isArray(data.assets)) {
    throw new Error("GitHub API returned an unexpected release payload");
  }
  return data;
}

function findBinaryAsset(release: LatestRelease): ReleaseAsset {
  const arch = /^(arm64|aarch64)$/i.test(process.arch) ? "aarch64" : "x86_64";
  let platformPattern: string;
  if (process.platform === "win32") {
    platformPattern = "windows";
  } else if (process.platform === "darwin") {
    platformPattern = "macos";
  } else {
    platformPattern = "linux";
  }
  // Match assets like: rojo-<version>-<platform>-<arch>.zip
  const pattern = new RegExp(`rojo-.*-${platformPattern}-${arch}\\.zip$`, "i");
  const asset = release.assets.find((a) => pattern.test(a.name));
  if (!asset) {
    // Fallback: match any zip for this platform (ignore arch)
    const fallbackPattern = new RegExp(`rojo-.*-${platformPattern}-.*\\.zip$`, "i");
    const fallback = release.assets.find((a) => fallbackPattern.test(a.name));
    if (!fallback) {
      throw new Error(
        `No ${platformPattern} Rojo binary found in release ${release.tag_name}. Supported assets: ${release.assets.map((a) => a.name).join(", ")}`,
      );
    }
    return fallback;
  }
  return asset;
}

function findPluginAsset(release: LatestRelease): ReleaseAsset {
  const asset = release.assets.find((a) => /\.rbxm$/i.test(a.name));
  if (!asset) {
    throw new Error(`No plugin (.rbxm) asset found in release ${release.tag_name}`);
  }
  return asset;
}

async function extractArchive(archivePath: string, destinationDir: string): Promise<void> {
  await mkdir(destinationDir, { recursive: true });
  if (archivePath.endsWith(".zip")) {
    await extractZip(archivePath, { dir: destinationDir });
    return;
  }
  if (archivePath.endsWith(".tar.gz")) {
    await extractTar({ file: archivePath, cwd: destinationDir, strict: true });
    return;
  }
  throw new Error(`Cannot extract ${archivePath}: unsupported archive format`);
}

async function findBinaryInDir(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name === BINARY_NAME) return full;
    if (entry.isDirectory()) {
      const nested = await findBinaryInDir(full);
      if (nested) return nested;
    }
  }
  return null;
}

export function resolvePluginsDirectory(): string {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) return join(local, "Roblox", "Plugins");
    return join(os.homedir(), "AppData", "Local", "Roblox", "Plugins");
  }
  return join(os.homedir(), "Library", "Application Support", "Roblox", "Plugins");
}

// ── Roblox Studio Auto-Restart ──────────────────────────────────────────

async function isRobloxStudioRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    // Use tasklist to check for RobloxStudioBeta.exe
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("tasklist", { encoding: "utf8", windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout as string);
      });
    });
    return stdout.includes("RobloxStudioBeta.exe") || stdout.includes("RobloxStudio.exe");
  } catch {
    return false;
  }
}

// ── Implementation ───────────────────────────────────────────────────────

function buildInstaller(options: RojoInstallerOptions): RojoInstaller {
  const binaryPath = join(options.binDirectory, BINARY_NAME);

  function report(
    onProgress: (p: RojoInstallProgress) => void,
    phase: RojoInstallPhase,
    message: string,
    percent?: number,
  ): void {
    onProgress({ phase, message, ...(percent !== undefined ? { percent } : {}) });
  }

  return {
    install: (onProgress) =>
      Effect.gen(function* () {
        yield* toEffectTry(
          () => mkdir(options.binDirectory, { recursive: true }),
          "Failed to create bin directory",
        );

        report(onProgress, "release-lookup", "Checking for the latest Rojo release…");
        const release = yield* toEffectTry(
          () => getLatestRelease(),
          "Failed to fetch Rojo release info",
        );
        const version = release.tag_name.replace(/^v/, "");

        const binaryAsset = findBinaryAsset(release);
        const zipTemp = join(options.binDirectory, `rojo-${version}.zip`);
        report(onProgress, "binary-download", `Downloading Rojo ${version}…`, 0);
        yield* toEffectTry(
          () =>
            downloadFile(binaryAsset.browser_download_url, zipTemp, (received, total) => {
              const pct =
                total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined;
              report(
                onProgress,
                "binary-download",
                `Downloading Rojo ${version}… ${pct ?? received}%`,
                pct,
              );
            }),
          "Failed to download Rojo binary",
        );

        report(onProgress, "binary-extract", "Extracting Rojo binary…", 100);
        const extractDir = join(options.binDirectory, `extract-${version}`);
        yield* toEffectTry(
          () => extractArchive(zipTemp, extractDir),
          "Failed to extract Rojo binary",
        );
        const found = yield* toEffectTry(
          () => findBinaryInDir(extractDir),
          "Failed to locate extracted Rojo binary",
        );
        if (!found) {
          return yield* Effect.fail(
            new RojoInstallError({
              message: `Could not find ${BINARY_NAME} inside the downloaded archive`,
            }),
          );
        }
        yield* toEffectTry(
          () => mkdir(options.binDirectory, { recursive: true }),
          "Failed to prepare bin directory",
        );
        yield* toEffectTry(() => copyFile(found, binaryPath), "Failed to install Rojo binary");
        if (process.platform !== "win32") {
          yield* toEffectTry(
            () => chmod(binaryPath, 0o755),
            "Failed to mark Rojo binary executable",
          );
        }
        yield* toEffectTry(
          () =>
            rm(extractDir, { recursive: true, force: true }).then(() =>
              rm(zipTemp, { force: true }),
            ),
          "Failed to clean up Rojo install temp files",
        );

        const pluginAsset = findPluginAsset(release);
        const pluginTemp = join(options.binDirectory, `${PLUGIN_NAME}.tmp`);
        report(onProgress, "plugin-download", "Downloading Roblox Studio plugin…", 0);
        yield* toEffectTry(
          () =>
            downloadFile(pluginAsset.browser_download_url, pluginTemp, (received, total) => {
              const pct =
                total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined;
              report(onProgress, "plugin-download", "Downloading Roblox Studio plugin…", pct);
            }),
          "Failed to download Rojo Studio plugin",
        );

        report(onProgress, "plugin-install", "Installing plugin into Roblox Studio…", 100);
        yield* toEffectTry(
          () => mkdir(options.pluginsDirectory, { recursive: true }),
          "Failed to create Studio Plugins folder",
        );
        const pluginPath = join(options.pluginsDirectory, PLUGIN_NAME);
        yield* toEffectTry(
          () => copyFile(pluginTemp, pluginPath),
          "Failed to copy plugin into Roblox Studio",
        );
        yield* toEffectTry(
          () => rm(pluginTemp, { force: true }),
          "Failed to clean up plugin temp file",
        );

        // Do not terminate Studio or risk losing unsaved work. The plugin is
        // installed for the next Studio launch; users can restart explicitly.
        const wasRunning = yield* toEffectTry(
          () => isRobloxStudioRunning(),
          "Failed to check if Roblox Studio is running",
        );
        if (wasRunning) {
          report(
            onProgress,
            "done",
            "Rojo is installed. Restart Roblox Studio to load the plugin.",
            100,
          );
        } else {
          report(onProgress, "done", "Rojo environment is fully set up!", 100);
        }
        return { version, binaryPath, pluginPath };
      }),

    getBinaryPath: () =>
      Effect.gen(function* () {
        const exists = yield* toEffectTry(
          () =>
            access(binaryPath).then(
              () => true,
              () => false,
            ),
          "Failed to check Rojo binary",
        );
        return exists ? binaryPath : null;
      }),
    checkInstalled: () =>
      Effect.gen(function* () {
        const binaryExists = yield* toEffectTry(
          () =>
            access(binaryPath).then(
              () => true,
              () => false,
            ),
          "Failed to check Rojo binary",
        );
        if (!binaryExists) return false;
        const pluginPath = join(options.pluginsDirectory, PLUGIN_NAME);
        const pluginExists = yield* toEffectTry(
          () =>
            access(pluginPath).then(
              () => true,
              () => false,
            ),
          "Failed to check Rojo plugin",
        );
        return pluginExists;
      }),
  };
}

export function makeRojoInstallerLayer(options: RojoInstallerOptions) {
  return Layer.sync(RojoInstallerTag, () => buildInstaller(options));
}
