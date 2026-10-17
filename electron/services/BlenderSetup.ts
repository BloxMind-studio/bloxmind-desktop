import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import extractZip from "extract-zip";
import { x as extractTar } from "tar";

import type { BlenderSetupResult } from "../../src/types/desktop";

const execFileAsync = promisify(execFile);

/** The Python package that runs the bridge and owns the Blender addon. */
export const BLENDER_MCP_PACKAGE = "mcp-for-blender";
/** Where the package installs its addon inside a Blender addons directory. */
const ADDON_FILENAME = "blender_mcp.py";
/** Marker the headless enable script prints; parsed back out of Blender's stdout. */
const RESULT_MARKER = "BLOXMIND_ADDON_RESULT ";
const UV_API = "https://api.github.com/repos/astral-sh/uv/releases/latest";
const UV_TIMEOUT_MS = 120_000;
const UV_LOOKUP_TIMEOUT_MS = 15_000;
const INSTALL_ADDON_TIMEOUT_MS = 300_000;
const BLENDER_VERSION_TIMEOUT_MS = 60_000;
const ENABLE_ADDON_TIMEOUT_MS = 240_000;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable seams so the orchestrator is testable without touching the real machine. */
export interface BlenderSetupEnvironment {
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
  home: string;
  /** Where BloxMind keeps the uv it downloads. */
  cacheDirectory: string;
  fetchFn: typeof fetch;
  run: (command: string, args: string[], options: { timeoutMs: number; env?: NodeJS.ProcessEnv }) => Promise<RunResult>;
  pathExists: (path: string) => Promise<boolean>;
  isDirectory: (path: string) => Promise<boolean>;
  readDirectory: (path: string) => Promise<string[]>;
  blenderRunning: () => Promise<boolean>;
  launch: (executable: string) => Promise<void>;
  log: (line: string) => void;
}

export function defaultBlenderSetupEnvironment(cacheDirectory: string): BlenderSetupEnvironment {
  return {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    home: process.env.USERPROFILE ?? process.env.HOME ?? "",
    cacheDirectory,
    fetchFn: fetch,
    run: async (command, args, options) => {
      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          timeout: options.timeoutMs,
          env: { ...process.env, NO_COLOR: "1", ...options.env },
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
        return { code: 0, stdout, stderr };
      } catch (cause) {
        const error = cause as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        return {
          code: typeof error.code === "number" ? error.code : 1,
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? error.message ?? "",
        };
      }
    },
    pathExists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    isDirectory: async (path) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
    readDirectory: async (path) => {
      try {
        return await readdir(path);
      } catch {
        return [];
      }
    },
    blenderRunning: async () => {
      try {
        const { processes } = await import("systeminformation");
        const list = await processes();
        return list.list.some((entry) => entry.name?.toLowerCase().includes("blender"));
      } catch {
        return false;
      }
    },
    launch: async (executable) => {
      const child = spawn(executable, [], { detached: true, stdio: "ignore" });
      child.unref();
    },
    log: (line) => console.log(`[blender] ${line}`),
  };
}

// ── uv ────────────────────────────────────────────────────────────────────

/** uv release asset for a platform, or null when uv has no build for it. */
export function uvAssetName(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "win32") {
    if (arch === "x64") return "uv-x86_64-pc-windows-msvc.zip";
    if (arch === "arm64") return "uv-aarch64-pc-windows-msvc.zip";
    return null;
  }
  if (platform === "darwin") {
    if (arch === "arm64") return "uv-aarch64-apple-darwin.tar.gz";
    if (arch === "x64") return "uv-x86_64-apple-darwin.tar.gz";
    return null;
  }
  if (platform === "linux") {
    if (arch === "x64") return "uv-x86_64-unknown-linux-gnu.tar.gz";
    if (arch === "arm64") return "uv-aarch64-unknown-linux-gnu.tar.gz";
    return null;
  }
  return null;
}

export function uvxExecutableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "uvx.exe" : "uvx";
}

/** Searches PATH, then uv's own installer locations, for an existing uvx. */
export async function findUvx(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
  pathExists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  const exe = uvxExecutableName(platform);
  const entries = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = join(entry, exe);
    if (await pathExists(candidate)) return candidate;
  }
  const fallbacks = [
    join(home, ".local", "bin", exe),
    join(home, ".cargo", "bin", exe),
  ];
  if (platform !== "win32") {
    fallbacks.push("/opt/homebrew/bin/uvx", "/usr/local/bin/uvx");
  }
  for (const candidate of fallbacks) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

/** The newest uvx in BloxMind's own cache, so setup works with no network on repeat runs. */
async function findCachedUvx(
  environment: BlenderSetupEnvironment,
): Promise<string | null> {
  const root = join(environment.cacheDirectory, "uv");
  const versions = (await environment.readDirectory(root)).filter((name) => /^\d+\./.test(name));
  versions.sort((left, right) => {
    const a = left.split(".").map(Number);
    const b = right.split(".").map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const diff = (b[i] ?? 0) - (a[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  for (const version of versions) {
    const candidate = join(root, version, uvxExecutableName(environment.platform));
    if (await environment.pathExists(candidate)) return candidate;
  }
  return null;
}

/** Downloads and extracts uv into BloxMind's cache. Returns the uvx path. */
export async function downloadUv(
  environment: BlenderSetupEnvironment,
): Promise<string | null> {
  const assetName = uvAssetName(environment.platform, environment.arch);
  if (!assetName) return null;

  let release: {
    tag_name?: unknown;
    assets?: { name?: unknown; browser_download_url?: unknown; digest?: unknown }[];
  };
  try {
    const response = await environment.fetchFn(UV_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "BloxMind",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(UV_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    release = (await response.json()) as typeof release;
  } catch {
    return null;
  }

  const tag = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : null;
  const asset = (release.assets ?? []).find((candidate) => candidate.name === assetName);
  const url = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : null;
  const digest =
    typeof asset?.digest === "string" ? asset.digest.match(/^sha256:([a-f\d]{64})$/i)?.[1] : null;
  if (!tag || !url || !digest) return null;

  const destination = join(environment.cacheDirectory, "uv", tag);
  const uvxPath = join(destination, uvxExecutableName(environment.platform));
  if (await environment.pathExists(uvxPath)) return uvxPath;

  let archive: Buffer;
  try {
    const response = await environment.fetchFn(url, {
      headers: { "User-Agent": "BloxMind" },
      signal: AbortSignal.timeout(UV_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    archive = Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
  if (createHash("sha256").update(archive).digest("hex") !== digest.toLowerCase()) return null;

  const archivePath = join(environment.cacheDirectory, "uv", assetName);
  try {
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await writeFile(archivePath, archive);
    if (assetName.endsWith(".zip")) {
      await extractZip(archivePath, { dir: destination });
    } else {
      await extractTar({ file: archivePath, cwd: destination, strict: true });
    }
    await rm(archivePath, { force: true });
  } catch {
    return null;
  }
  if (environment.platform !== "win32") {
    try {
      await (await import("node:fs/promises")).chmod(uvxPath, 0o755);
    } catch {
      return null;
    }
  }
  return (await environment.pathExists(uvxPath)) ? uvxPath : null;
}

// ── Blender discovery ─────────────────────────────────────────────────────

export function blenderConfigBase(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string | null {
  if (platform === "win32") {
    return env.APPDATA ? join(env.APPDATA, "Blender Foundation", "Blender") : null;
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Blender");
  }
  return join(home, ".config", "blender");
}

/** Installed Blender executables, newest install location first. */
export async function findBlenderExecutables(
  environment: BlenderSetupEnvironment,
): Promise<string[]> {
  const found: string[] = [];
  const { platform, env, home } = environment;

  const onPath = platform === "win32" ? "blender.exe" : "blender";
  for (const entry of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(entry, onPath);
    if (await environment.pathExists(candidate)) {
      found.push(candidate);
      break;
    }
  }

  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
      (root): root is string => Boolean(root),
    );
    for (const root of roots) {
      const foundation = join(root, "Blender Foundation");
      const installs = (await environment.readDirectory(foundation))
        .filter((name) => name.startsWith("Blender"))
        .sort()
        .reverse();
      for (const install of installs) {
        const candidate = join(foundation, install, "blender.exe");
        if (await environment.pathExists(candidate)) found.push(candidate);
      }
    }
    if (env["ProgramFiles(x86)"]) {
      const steam = join(env["ProgramFiles(x86)"], "Steam", "steamapps", "common", "Blender", "blender.exe");
      if (await environment.pathExists(steam)) found.push(steam);
    }
  } else if (platform === "darwin") {
    for (const apps of ["/Applications", join(home, "Applications")]) {
      const entries = (await environment.readDirectory(apps))
        .filter((name) => name.startsWith("Blender") && name.endsWith(".app"))
        .sort()
        .reverse();
      for (const entry of entries) {
        const candidate = join(apps, entry, "Contents", "MacOS", "Blender");
        if (await environment.pathExists(candidate)) found.push(candidate);
      }
    }
  } else {
    for (const candidate of ["/snap/bin/blender", "/usr/bin/blender", "/usr/local/bin/blender"]) {
      if (await environment.pathExists(candidate)) found.push(candidate);
    }
  }
  return found;
}

/** "4.5" from `blender --version` output, or null. */
export function parseBlenderVersion(output: string): string | null {
  const match = /Blender\s+(\d+)\.(\d+)/.exec(output);
  return match ? `${match[1]}.${match[2]}` : null;
}

export async function blenderVersion(
  environment: BlenderSetupEnvironment,
  executable: string,
): Promise<string | null> {
  const result = await environment.run(executable, ["--version"], {
    timeoutMs: BLENDER_VERSION_TIMEOUT_MS,
  });
  return result.code === 0 ? parseBlenderVersion(result.stdout) : null;
}

/** Newest Blender (by version), or null when none answers `--version`. */
export async function newestBlender(
  environment: BlenderSetupEnvironment,
): Promise<{ executable: string; version: string } | null> {
  let best: { executable: string; version: string } | null = null;
  for (const executable of await findBlenderExecutables(environment)) {
    const version = await blenderVersion(environment, executable);
    if (!version) continue;
    if (!best || compareDotted(version, best.version) > 0) best = { executable, version };
  }
  return best;
}

function compareDotted(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * False when saving preferences would cost the user Blender's settings-import
 * choice: a new Blender version with other versions around but no saved
 * preferences yet, where writing userpref.blend skips the migration prompt.
 */
export async function safeToSavePrefs(
  environment: BlenderSetupEnvironment,
  base: string,
  version: string,
): Promise<boolean> {
  if (await environment.pathExists(join(base, version, "config", "userpref.blend"))) return true;
  const entries = await environment.readDirectory(base);
  const others = entries.filter((name) => /^\d+\.\d+$/.test(name) && name !== version);
  return others.length === 0;
}

/** The module name Blender loads an installed addon file under. */
export function addonModuleName(target: string): string {
  const parts = target.split(/[\\/]/);
  const fileName = parts.at(-1) ?? "blender_mcp.py";
  const stem = fileName.replace(/\.py$/, "");
  if (parts.at(-2) === "user_default" && parts.at(-3) === "extensions") {
    return `bl_ext.user_default.${stem}`;
  }
  return stem;
}

// ── The setup flow ────────────────────────────────────────────────────────

/**
 * Runs inside Blender: enables the addon (unless another copy is already
 * enabled under a different module name, which would clash) and saves
 * preferences so it loads on the next launch. Prints a single parseable line.
 */
const ENABLE_ADDON_SCRIPT = `
import json, sys
import addon_utils, bpy
module = sys.argv[sys.argv.index("--") + 1]
result = {"already": [], "enabled": False, "error": None}
try:
    names = {"MCP for Blender", "Blender MCP"}
    enabled = {a.module for a in bpy.context.preferences.addons}
    for mod in addon_utils.modules(refresh=True):
        if mod.__name__ in enabled and addon_utils.module_bl_info(mod).get("name") in names:
            result["already"].append(mod.__name__)
    if not result["already"]:
        result["enabled"] = addon_utils.enable(module, default_set=True) is not None
        if result["enabled"]:
            bpy.ops.wm.save_userpref()
        else:
            result["error"] = "Blender couldn't load " + module
except Exception as e:
    result["error"] = str(e)
print("${RESULT_MARKER}" + json.dumps(result))
`;

export function buildEnableAddonScript(): string {
  return ENABLE_ADDON_SCRIPT;
}

/** Finds the installed addon file in a directory, or null. */
async function findInstalledAddon(
  environment: BlenderSetupEnvironment,
  addonsDirectory: string,
): Promise<string | null> {
  const expected = join(addonsDirectory, ADDON_FILENAME);
  if (await environment.pathExists(expected)) return expected;
  for (const entry of await environment.readDirectory(addonsDirectory)) {
    if (!entry.endsWith(".py")) continue;
    const candidate = join(addonsDirectory, entry);
    try {
      const text = await readFile(candidate, "utf8");
      if (/["']name["']\s*:\s*["'](?:MCP for Blender|Blender MCP)["']/.test(text)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

export interface BlenderEnableOutcome {
  enabled: boolean;
  already: boolean;
  message: string;
}

/** Enables the addon in a headless Blender run and saves preferences. */
export async function enableAddonHeadless(
  environment: BlenderSetupEnvironment,
  executable: string,
  module: string,
): Promise<BlenderEnableOutcome> {
  const result = await environment.run(
    executable,
    ["--background", "--python-expr", ENABLE_ADDON_SCRIPT, "--", module],
    { timeoutMs: ENABLE_ADDON_TIMEOUT_MS, env: { BLENDERMCP_NO_UPDATE_CHECK: "1" } },
  );
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.startsWith(RESULT_MARKER)) continue;
    try {
      const payload = JSON.parse(line.slice(RESULT_MARKER.length)) as {
        already?: string[];
        enabled?: boolean;
        error?: string | null;
      };
      if (payload.already && payload.already.length > 0) {
        return { enabled: true, already: true, message: "The Blender bridge addon was already enabled" };
      }
      if (payload.enabled) {
        return { enabled: true, already: false, message: "Enabled the Blender bridge addon" };
      }
      return { enabled: false, already: false, message: payload.error ?? "Blender didn't enable the addon" };
    } catch {
      return { enabled: false, already: false, message: "Blender returned an unreadable result" };
    }
  }
  return {
    enabled: false,
    already: false,
    message: result.stderr.trim().split(/\r?\n/).at(-1) || "Blender exited without a result",
  };
}

/**
 * Everything behind the "Set up automatically" button: make sure uvx exists,
 * install the bridge addon into the newest Blender, enable it, and open
 * Blender so the bridge comes up. Never throws for expected failures; the
 * result carries user-facing detail either way.
 */
export async function runBlenderSetup(
  environment: BlenderSetupEnvironment,
): Promise<BlenderSetupResult> {
  const steps: string[] = [];
  const note = (line: string) => {
    steps.push(line);
    environment.log(line);
  };
  const result: BlenderSetupResult = {
    ok: false,
    uvxPath: null,
    blenderExe: null,
    blenderVersion: null,
    blenderRunning: false,
    launched: false,
    addon: "not_found",
    detail: "",
    steps,
  };

  // 1. uvx: PATH first, then BloxMind's cache, then a fresh download.
  let uvx = await findUvx(environment.platform, environment.env, environment.home, environment.pathExists);
  if (uvx) {
    note("Found uv already installed");
  } else {
    uvx = await findCachedUvx(environment);
    if (!uvx) {
      note("Downloading uv (the tool runner for the Blender bridge)…");
      uvx = await downloadUv(environment);
    }
    if (!uvx) {
      result.detail =
        "Couldn't install uv, the runner the Blender bridge needs. Check your internet connection and try again.";
      note(result.detail);
      return result;
    }
  }
  result.uvxPath = uvx;

  // 2. Blender itself.
  const blender = await newestBlender(environment);
  result.blenderRunning = await environment.blenderRunning();
  if (!blender) {
    result.detail =
      "Blender wasn't found. Install it from blender.org, open it once, then run setup again.";
    note(result.detail);
    return result;
  }
  result.blenderExe = blender.executable;
  result.blenderVersion = blender.version;
  note(`Found Blender ${blender.version}`);

  // 3. Install the addon into the newest Blender's addons folder.
  const base = blenderConfigBase(environment.platform, environment.env, environment.home);
  if (!base) {
    result.detail = "Couldn't locate Blender's settings folder; install the addon manually instead.";
    note(result.detail);
    return result;
  }
  const addonsDirectory = join(base, blender.version, "scripts", "addons");
  try {
    await mkdir(addonsDirectory, { recursive: true });
  } catch {
    result.detail = `Couldn't create Blender's addons folder at ${addonsDirectory}.`;
    note(result.detail);
    return result;
  }
  note("Installing the Blender bridge addon…");
  const install = await environment.run(
    uvx,
    [
      "--refresh-package",
      BLENDER_MCP_PACKAGE,
      "--no-progress",
      `${BLENDER_MCP_PACKAGE}@latest`,
      "install-addon",
      "--addons-dir",
      addonsDirectory,
    ],
    // PYTHONIOENCODING: the installer prints a "→" glyph, which crashes
    // Python's cp1252 console encoding on some Windows setups.
    { timeoutMs: INSTALL_ADDON_TIMEOUT_MS, env: { PYTHONIOENCODING: "utf-8" } },
  );
  const addonPath = await findInstalledAddon(environment, addonsDirectory);
  if (install.code !== 0 && !addonPath) {
    result.detail = `Installing the addon failed: ${lastLine(install.stderr || install.stdout)}`;
    note(result.detail);
    return result;
  }
  if (!addonPath) {
    result.detail = "The addon installer finished but no addon file appeared; try again.";
    note(result.detail);
    return result;
  }

  // 4. Enable it: headless Blender writes the preference so it loads on launch.
  if (result.blenderRunning) {
    // Enabling while Blender runs would race Blender's own preference file on exit.
    result.addon = "needs_blender_open";
    note("Blender is open, so the addon couldn't be enabled yet.");
  } else if (!(await safeToSavePrefs(environment, base, blender.version))) {
    result.addon = "manual_enable";
    note(
      `Open Blender ${blender.version} once (choose whether to import settings), then run setup again — or tick "MCP for Blender" in Preferences → Add-ons.`,
    );
  } else {
    const enable = await enableAddonHeadless(
      environment,
      blender.executable,
      addonModuleName(addonPath),
    );
    if (enable.enabled) {
      result.addon = "enabled";
      note(enable.message);
    } else {
      result.addon = "manual_enable";
      note(`${enable.message}. Tick "MCP for Blender" in Blender's Preferences → Add-ons.`);
    }
  }

  // 5. Open Blender so the bridge comes up; the addon starts its server on launch.
  if (!result.blenderRunning) {
    try {
      await environment.launch(blender.executable);
      result.launched = true;
      note("Opening Blender — the bridge starts automatically.");
    } catch {
      note("Couldn't open Blender automatically; open it yourself when ready.");
    }
  }

  result.addon === "enabled" || result.addon === "needs_blender_open" || result.addon === "manual_enable"
    ? (result.ok = true)
    : (result.ok = false);
  result.detail =
    result.addon === "enabled"
      ? result.launched
        ? "Blender is set up and opening now."
        : "Blender is set up. The bridge starts the next time Blender opens."
      : result.addon === "needs_blender_open"
        ? "The addon is installed. Quit Blender, then click Set up automatically again to finish."
        : result.addon === "manual_enable"
          ? "Addon installed. Finish by enabling it once in Blender's Preferences → Add-ons."
          : result.detail;
  note(result.detail);
  return result;
}

function lastLine(text: string): string {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.at(-1) ?? "no output";
}

/** Finds the newest Blender executable for the "Open Blender" button. */
export async function launchBlender(
  environment: BlenderSetupEnvironment,
): Promise<{ launched: boolean; executable: string | null }> {
  const blender = await newestBlender(environment);
  if (!blender) return { launched: false, executable: null };
  await environment.launch(blender.executable);
  return { launched: true, executable: blender.executable };
}
