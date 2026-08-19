import type { AppEngine, AppGeneratedFile, AppProject, AppTarget, AppThemeMode } from "./types";

/** Directories that never belong to the generated app skeleton. */
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".opencode", "dist"]);

/**
 * BloxMind manifest the apps agent writes at the project root. Mirrors the
 * identity fields of {@link AppProject} so the read-back doesn't have to guess,
 * and is excluded from the returned `files` list.
 */
export interface AppManifest {
  name?: unknown;
  description?: unknown;
  target?: unknown;
  theme?: unknown;
  engine?: unknown;
  entry?: unknown;
}

/** Workspace-relative folder that holds the app named `appId`. */
export function appProjectDirectory(appId: string): string {
  return `apps/${appId}`;
}

function readManifest(value: string): AppManifest {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as AppManifest)
      : {};
  } catch {
    return {};
  }
}

function manifestTarget(value: unknown): AppTarget {
  return value === "mobile" ? "mobile" : "desktop";
}

function manifestTheme(value: unknown): AppThemeMode {
  return value === "light" ? "light" : "dark";
}

function manifestEngine(value: unknown): AppEngine {
  return value === "3d" ? "3d" : "web";
}

export interface ReadProjectOptions {
  name?: string;
  description?: string;
  target?: AppTarget;
  theme?: AppThemeMode;
  engine?: AppEngine;
  entry?: string;
}

/**
 * Recursively read a generated app project back from the workspace. The apps
 * agent writes real files into `apps/<appId>`; this walks that folder through
 * the OpenCode file API and reassembles a full {@link AppProject} for the
 * in-app preview, explorer, and export.
 *
 * Throws `"The generator returned an empty response."` when the folder is
 * missing or holds no text files, which `isTransientGenerationError` matches so
 * the studio can give the run one fresh retry.
 */
export async function readProjectFromWorkspace(
  client: {
    file: {
      list(
        params: { path: string },
        options?: { throwOnError?: boolean },
      ): Promise<{ data?: Array<{ name: string; path: string; type: string; ignored?: boolean }> }>;
      read(
        params: { path: string },
        options?: { throwOnError?: boolean },
      ): Promise<{ data?: { type: string; content: string } }>;
    };
  },
  appId: string,
  fallback: ReadProjectOptions = {},
): Promise<AppProject> {
  const root = appProjectDirectory(appId);

  const files: AppGeneratedFile[] = [];
  // Collected by the walk's nested closure; a holder object keeps TypeScript's
  // control-flow analysis from narrowing it away.
  const state: { manifest: AppManifest | null } = { manifest: null };

  // `names` is the app-relative path segment stack (relative to apps/<appId>);
  // `nodePath` is the workspace-relative path passed to the file API.
  async function walk(cwd: string, names: string[]): Promise<void> {
    let nodes;
    try {
      const listed = await client.file.list({ path: cwd }, { throwOnError: true });
      nodes = Array.isArray(listed.data) ? listed.data : [];
    } catch {
      // The folder may have been created between calls or never existed.
      return;
    }
    for (const node of nodes) {
      if (node.type === "directory") {
        if (SKIP_DIRECTORIES.has(node.name)) continue;
        await walk(node.path, [...names, node.name]);
        continue;
      }
      const relative = [...names, node.name].join("/");
      if (names.length === 0 && node.name === "bloxmind.json") {
        const manifestRead = await client.file.read({ path: node.path }, { throwOnError: true });
        if (manifestRead.data && manifestRead.data.type === "text") {
          state.manifest = readManifest(manifestRead.data.content);
        }
        continue;
      }
      const contentRead = await client.file.read({ path: node.path }, { throwOnError: true });
      if (!contentRead.data || contentRead.data.type !== "text") continue;
      files.push({ path: relative, content: contentRead.data.content });
    }
  }

  await walk(root, []);

  if (files.length === 0) {
    throw new Error("The generator returned an empty response.");
  }

  const manifest = state.manifest;
  const manifestName =
    typeof manifest?.name === "string" && manifest.name.trim()
      ? manifest.name.trim().slice(0, 64)
      : "";
  const manifestDescription =
    typeof manifest?.description === "string" ? manifest.description.slice(0, 400) : "";
  const manifestEntry =
    typeof manifest?.entry === "string" && manifest.entry.trim() ? manifest.entry.trim() : "";

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    name: manifestName || fallback.name || "Generated App",
    description: manifestDescription || fallback.description || "",
    target: manifest ? manifestTarget(manifest.target) : (fallback.target ?? "desktop"),
    theme: manifest ? manifestTheme(manifest.theme) : (fallback.theme ?? "dark"),
    engine: manifest ? manifestEngine(manifest.engine) : (fallback.engine ?? "web"),
    entry: manifestEntry || fallback.entry || "src/main.tsx",
    files,
  };
}
