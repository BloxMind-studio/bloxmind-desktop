import type { ProjectIndexProgramEnvelope } from "@/lib/projectIndex";

// ── Inline sandbox helpers ───────────────────────────────────────────────
//
// The following constants are embedded as raw strings inside the generated
// program source. They run inside the Roblox Studio sandbox (not the Electron
// renderer), so they must be self-contained and import-free.

/**
 * Normalise MCP result content into a plain object.
 *
 * MCP tools return results in various shapes: `{ content: [...] }`, raw
 * arrays, JSON strings, or plain objects. This helper unwraps the common
 * `content` array format (extracting `json` or `text` parts) and falls back
 * to JSON-parsing string content.
 *
 * Same pattern used by the existing built-in Studio programs.
 * Kept inline because these sources run in the generated program sandbox.
 */
const NORMALIZE_MCP_RESULT = `
function normalizeMcpResult(result: unknown): any {
  const content = result && typeof result === "object" && !Array.isArray(result)
    ? (result as any).structuredContent ?? (result as any).content
    : result;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if ((part as any).type === "json") return (part as any).json;
      if ((part as any).type === "text" && typeof (part as any).text === "string") {
        return parseMcpText((part as any).text);
      }
    }
  }
  if (typeof content === "string") return parseMcpText(content);
  return content;
}

// Studio MCP can put a note such as "Note: Output limited to N nodes" before
// the JSON, so fall back to parsing from the first bracket.
function parseMcpText(text: string): any {
  try { return JSON.parse(text); } catch {}
  const starts = [text.indexOf("["), text.indexOf("{")].filter((index) => index > 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  if (start > 0) {
    try { return JSON.parse(text.slice(start)); } catch {}
  }
  return text;
}

// Studio reports tool failures as a normal result with isError set. Without
// this check the error text is mistaken for an empty tree.
function mcpErrorText(result: unknown): string | null {
  if (!result || typeof result !== "object" || (result as any).isError !== true) return null;
  const content = (result as any).content;
  const text = Array.isArray(content)
    ? content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join(" ").trim()
    : "";
  return text || "Studio returned an error";
}`;

/**
 * Inline Luau comment stripper + `require()` parser that runs inside the
 * Roblox Studio sandbox.
 *
 * This mirrors `stripLuauComments` + `parseRequireCalls` from the TS side
 * (`src/lib/projectIndex.ts`) but is written as plain JavaScript since it
 * runs in the generated program sandbox without TypeScript compilation.
 *
 * - `stripComments(source)` — removes `--[[ ... ]]` block comments and
 *   `-- ...` line comments (respecting string literals).
 * - `parseRequires(source)` — extracts canonical dependency keys from all
 *   `require()` calls, normalising `game:GetService("X")` to `game.X` and
 *   tagging variable references with `var:`.
 */
const REQUIRE_PARSER = `
function stripComments(source) {
  // Remove block comments --[[ ... ]] (non-greedy, multiline).
  let result = source.replace(/--\\[\\[[\\s\\S]*?\\]\\]/g, "");
  // Remove line comments respecting string literals.
  const lines = result.split("\\n");
  for (let i = 0; i < lines.length; i++) {
    let inSingle = false, inDouble = false;
    const line = lines[i];
    for (let j = 0; j < line.length - 1; j++) {
      const ch = line[j], next = line[j + 1];
      if (inSingle) { if (ch === "\\\\") { j++; continue; } if (ch === "'") inSingle = false; continue; }
      if (inDouble) { if (ch === "\\\\") { j++; continue; } if (ch === '"') inDouble = false; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === "-" && next === "-") { lines[i] = line.slice(0, j); break; }
    }
  }
  return lines.join("\\n");
}

function parseRequires(source) {
  const deps = [];
  const cleaned = stripComments(source);
  // Match require(...) capturing the inner expression.
  // Handles nested parens used by :GetService("Foo").
  const re = /require\\s*\\(\\s*((?:[^()]+|\\([^()]*\\))+)\\s*\\)/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    let expr = m[1].trim();
    if (!expr) continue;
    // Strip whitespace inside the expression.
    expr = expr.replace(/\\s+/g, "");
    // If it's a string literal, extract the value.
    if (
      (expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'"))
    ) {
      deps.push(expr.slice(1, -1));
      continue;
    }
    // Normalise game:GetService("X") -> game.X
    expr = expr.replace(/game\\s*:\\s*GetService\\s*\\(\\s*["']([^"']+)["']\\s*\\)/g, "game.$1");
    // Tag simple variable references with var: prefix (lowercase, no dots/colons)
    if (/^[a-z_][a-zA-Z0-9_]*$/.test(expr)) {
      deps.push("var:" + expr);
      continue;
    }
    // Normalize capitalized service paths (e.g. ReplicatedStorage.Foo) to game. prefix
    if (!expr.startsWith("game.") && !expr.startsWith("script") && /^[A-Z]/.test(expr)) {
      expr = "game." + expr;
    }
    deps.push(expr);
  }
  return deps;
}`;

/**
 * Helpers embedded in the program: strip Studio's line-number gutter and pick
 * the source text out of the shapes `script_read` can return.
 */
const SCRIPT_SOURCE_HELPERS = `
// script_read prefixes each line with "LINE→" so the model can cite lines.
// Strip that gutter before measuring or parsing the source.
function stripLineNumbers(text: string): string {
  const lines = text.split(/\\r?\\n/);
  if (!/^\\s*\\d+\\u2192/.test(lines[0] || "")) return text;
  return lines.map(function (line) {
    return line.replace(/^\\s*\\d+\\u2192\\s?/, "");
  }).join("\\n");
}

function scriptSource(result: unknown): string | null {
  const data = normalizeMcpResult(result);
  if (typeof data === "string") return data;
  if (data && typeof data.source === "string") return data.source;
  if (data && typeof data.content === "string") return data.content;
  if (Array.isArray(data)) {
    for (const part of data) {
      if (part && typeof part.text === "string") return part.text;
    }
  }
  return null;
}

function treeRows(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.instances)) return raw.instances;
  if (Array.isArray(raw?.results)) return raw.results;
  return [];
}

// Relative requires such as require(script.Parent.Util) are common. Resolve
// them against the requiring script so the graph can link them to a real file.
function resolveDependency(dep: string, scriptPath: string): string {
  if (dep.indexOf("script") !== 0) return dep;
  let expr = dep
    .replace(/:(?:WaitForChild|FindFirstChild)\\s*\\(\\s*["']([^"']+)["']\\s*\\)/g, ".$1")
    .replace(/\\[\\s*["']([^"']+)["']\\s*\\]/g, ".$1");
  const parts = expr.split(".");
  if (parts[0] !== "script") return dep;
  const resolved = scriptPath.split(".");
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part === "Parent") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join(".");
}`;

// ── Program source ───────────────────────────────────────────────────────

/**
 * The full built-in project index program source.
 *
 * This string is compiled and executed by the `GeneratedProgramRuntime`.
 * It discovers every script-type instance in the place via the
 * `search_game_tree` MCP tool, reads each script's source via `script_read`,
 * parses `require()` calls, and builds a dependency graph with:
 * - Entry point detection (modules nothing depends on)
 * - Circular dependency detection (DFS with stack tracing)
 * - Dependency depth computation (memoised, cycle-safe)
 * - Dependents count for each module
 *
 * Studio's tools require a `studio_id` and a `datamodel_type`, so the program
 * receives the selected target as `{ studioId }` and falls back from Edit to
 * Server/Client during a playtest. A tool error is reported, never treated as
 * an empty place. Every discovered script is counted even when its source
 * cannot be read; only its dependency list is then unknown.
 *
 * The program is read-only and never modifies the place.
 */
const projectIndexSource = `
${NORMALIZE_MCP_RESULT}
${REQUIRE_PARSER}
${SCRIPT_SOURCE_HELPERS}
async function run({ input, callTool }: { input: { studioId?: string }; callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> }) {
  const studioId = typeof input?.studioId === "string" ? input.studioId : "";
  if (!studioId) {
    throw new Error("The project index needs a Studio target. Select one in BloxMind and try again.");
  }

  // Studio requires a data model type: "Edit" normally, "Server"/"Client"
  // during a playtest. Try the filtered pass first; on a place with no scripts
  // (or a Studio build that rejects the LuaSourceContainer filter) retry
  // without the filter and keep whatever scripts the tree contains.
  let rows: any[] | null = null;
  const errors: Array<[string, string]> = [];
  outer: for (const datamodelType of ["Edit", "Server", "Client"]) {
    let lastError = "";
    for (const useFilter of [true, false]) {
      let result: unknown;
      try {
        const args: Record<string, unknown> = {
          studio_id: studioId,
          datamodel_type: datamodelType,
          max_depth: 10,
          head_limit: 100000,
        };
        // IsA("LuaSourceContainer") matches Script, LocalScript and
        // ModuleScript, so one pass returns only the scripts we index.
        if (useFilter) args.instance_type = "LuaSourceContainer";
        result = await callTool("search_game_tree", args);
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause);
        break;
      }
      const error = mcpErrorText(result);
      if (error) {
        lastError = error;
        break;
      }
      const candidate = treeRows(normalizeMcpResult(result));
      if (candidate.length > 0) {
        rows = candidate;
        break outer;
      }
      if (!useFilter) {
        // A successful unfiltered read is the real answer, even when empty.
        rows = candidate;
        break outer;
      }
    }
    if (lastError) errors.push([datamodelType, lastError]);
  }

  if (rows === null) {
    const first = errors.length > 0 ? errors[0][1] : "Studio did not return a place tree";
    const rest = errors
      .slice(1)
      .filter(function (entry) {
        return entry[1] !== first && !/not available in \\w+ mode/i.test(entry[1]);
      })
      .map(function (entry) { return entry[0].toLowerCase() + " data model: " + entry[1]; });
    throw new Error(rest.length > 0 ? first + " (" + rest.join("; ") + ")" : first);
  }

  const byPath = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const className = typeof row.className === "string" ? row.className : "";
    if (className !== "Script" && className !== "LocalScript" && className !== "ModuleScript") continue;
    const rawPath = typeof row.fullPath === "string" ? row.fullPath
      : typeof row.path === "string" ? row.path : "";
    if (!rawPath) continue;
    const path = rawPath.startsWith("game.") ? rawPath : "game." + rawPath;
    if (byPath.has(path)) continue;

    const properties = row.properties && typeof row.properties === "object" ? row.properties : {};
    const segments = path.split(".");
    const instanceName =
      typeof row.name === "string" && row.name ? row.name :
      typeof properties.Name === "string" && properties.Name ? properties.Name :
      typeof row.Name === "string" && row.Name ? row.Name :
      segments[segments.length - 1] || path;

    byPath.set(path, {
      path: path,
      name: instanceName,
      className: className,
      source: null,
      readError: null,
    });
  }

  const scripts = [...byPath.values()].sort(function (a, b) {
    return a.path.localeCompare(b.path);
  });

  // Read sources with bounded concurrency. The runtime ends a program after
  // 60s, so keep a reserve: a large place returns complete counts plus the
  // dependencies learned so far instead of failing outright.
  const CONCURRENCY = 6;
  const READ_BUDGET_MS = 30_000;
  const startedAt = Date.now();
  let cursor = 0;
  let budgetExhausted = false;

  async function readNext(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= scripts.length) return;
      if (Date.now() - startedAt > READ_BUDGET_MS) {
        budgetExhausted = true;
        return;
      }
      const script = scripts[index];
      try {
        const result = await callTool("script_read", {
          studio_id: studioId,
          target_file: script.path,
          should_read_entire_file: true,
        });
        const error = mcpErrorText(result);
        if (error) {
          script.readError = error;
          continue;
        }
        const source = scriptSource(result);
        if (source === null) {
          script.readError = "Studio returned no source";
          continue;
        }
        script.source = stripLineNumbers(source);
      } catch (cause) {
        script.readError = cause instanceof Error ? cause.message : String(cause);
      }
    }
  }

  const readers = [];
  const readerCount = Math.min(CONCURRENCY, scripts.length);
  for (let i = 0; i < readerCount; i++) readers.push(readNext());
  await Promise.all(readers);

  let unreadableScripts = 0;
  for (const script of scripts) {
    if (script.source === null) unreadableScripts++;
  }

  const modules = scripts.map(function (script) {
    const source: string | null = script.source;
    // De-duplicate: a module that requires the same path twice is one edge.
    // Resolve relative paths against this script so the graph can link them.
    const dependencies = source === null ? [] : [...new Set(parseRequires(source).map(function (dep) {
      return resolveDependency(dep, script.path);
    }))];
    return {
      path: script.path,
      name: script.name,
      className: script.className,
      sourceLength: source === null ? 0 : source.length,
      dependencies: dependencies,
    };
  });

  let totalScripts = 0;
  let totalModuleScripts = 0;
  for (const mod of modules) {
    if (mod.className === "ModuleScript") totalModuleScripts++;
    else totalScripts++;
  }

  // Detect entry points and compute dependentsCount for each module.
  const requiredBy = new Map();
  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      if (!requiredBy.has(dep)) requiredBy.set(dep, new Set());
      requiredBy.get(dep).add(mod.path);
    }
  }
  const entryPoints = modules
    .filter(function (mod) { return !requiredBy.has(mod.path) || requiredBy.get(mod.path).size === 0; })
    .map(function (mod) { return mod.path; });

  // Detect circular dependencies via DFS, deduplicating by canonical cycle key.
  // Also collect all nodes that participate in any cycle by tracing the recursion
  // stack when a back-edge is found.
  const seenCycles = new Set();
  const circularDeps = [];
  const visited = new Set();
  const inStack = new Set();
  const stackArr = [];
  const cycleMembers = new Set();
  const pathMap = new Map();
  for (const mod of modules) pathMap.set(mod.path, mod);

  function dfs(current) {
    if (inStack.has(current)) return;
    if (visited.has(current)) return;
    visited.add(current);
    inStack.add(current);
    stackArr.push(current);
    const mod = pathMap.get(current);
    if (mod) {
      for (const dep of mod.dependencies) {
        if (pathMap.has(dep)) {
          if (inStack.has(dep)) {
            const key = [current, dep].sort().join("\\u2194");
            if (!seenCycles.has(key)) {
              seenCycles.add(key);
              circularDeps.push([current, dep]);
            }
            // Mark all nodes on the stack between dep and current as cycle members.
            const idx = stackArr.indexOf(dep);
            if (idx !== -1) {
              for (let i = idx; i < stackArr.length; i++) {
                cycleMembers.add(stackArr[i]);
              }
            }
          } else {
            dfs(dep);
          }
        }
      }
    }
    inStack.delete(current);
    stackArr.pop();
  }
  for (const mod of modules) dfs(mod.path);

  // Compute dependency depth via memoised DFS on resolved dependencies.
  // Cycle members get depth 0 to avoid infinite recursion and inflated values.
  const depthCache = new Map();
  const computing = new Set();
  function computeDepth(path) {
    if (depthCache.has(path)) return depthCache.get(path);
    if (cycleMembers.has(path)) { depthCache.set(path, 0); return 0; }
    if (computing.has(path)) return -1;
    computing.add(path);
    const mod = pathMap.get(path);
    let maxDepDepth = 0;
    if (mod) {
      for (const dep of mod.dependencies) {
        if (pathMap.has(dep)) {
          const depDepth = computeDepth(dep);
          if (depDepth >= 0 && depDepth + 1 > maxDepDepth) maxDepDepth = depDepth + 1;
        }
      }
    }
    computing.delete(path);
    depthCache.set(path, maxDepDepth);
    return maxDepDepth;
  }

  // Enrich modules with computed graph fields.
  const enrichedModules = modules.map(function (mod) {
    return {
      path: mod.path,
      name: mod.name,
      className: mod.className,
      sourceLength: mod.sourceLength,
      dependencies: mod.dependencies,
      dependentsCount: (requiredBy.get(mod.path) || new Set()).size,
      dependencyDepth: computeDepth(mod.path),
    };
  });

  return {
    modules: enrichedModules,
    entryPoints: entryPoints,
    circularDependencies: circularDeps,
    totalScripts: totalScripts,
    totalModuleScripts: totalModuleScripts,
    unreadableScripts: unreadableScripts,
    partial: budgetExhausted,
  };
}`;

// ── Exported envelope ────────────────────────────────────────────────────

/**
 * Built-in project index program that runs locally via the
 * `GeneratedProgramRuntime`.
 *
 * It is the app's own reader for the open place: it asks Studio for the script
 * tree, reads each script with the selected Studio target, and returns a
 * dependency map the assistant receives in its system prompt. The program is
 * read-only and never modifies the place.
 */
export const BUILTIN_PROJECT_INDEX_PROGRAM: ProjectIndexProgramEnvelope = {
  version: 1,
  contract: {
    name: "project-index",
    version: "1",
    inputSchemaVersion: "project-index-input-v1",
    outputSchemaVersion: "project-index-skeleton-v1",
  },
  source: projectIndexSource,
};
