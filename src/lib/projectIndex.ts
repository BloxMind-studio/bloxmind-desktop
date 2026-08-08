import { Schema } from "effect";

// ── Schema definitions ──────────────────────────────────────────────────

/**
 * Represents a single Roblox script or module discovered in the place.
 *
 * The `path` is a dot-separated game path (e.g. `"game.ServerScriptService.Main"`).
 * The `dependencies` array holds canonical dependency keys produced by
 * {@link parseRequireCalls} — absolute paths are prefixed with `game.`,
 * relative paths are kept as-is, and variable references are tagged `var:`.
 */
export const ProjectModuleSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024)),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  className: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  sourceLength: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  dependencies: Schema.Array(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1024))),

  /**
   * Number of other known modules that depend on this module.
   * High values indicate "hub" modules that are widely required.
   */
  dependentsCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),

  /**
   * Depth in the dependency graph.
   *
   * - `0` — leaf module with no resolved dependencies.
   * - `1` — depends only on leaf modules.
   * - `N` — longest chain of resolved dependencies is `N` levels deep.
   *
   * Modules that participate in a cycle are assigned depth `0` to avoid
   * infinite recursion and inflated values.
   */
  dependencyDepth: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type ProjectModule = typeof ProjectModuleSchema.Type;

/**
 * The full project skeleton returned by the indexing program.
 *
 * - `entryPoints` — modules that nothing else depends on (top-level scripts).
 * - `circularDependencies` — deduplicated `[from, to]` pairs that form a cycle.
 */
export const ProjectSkeletonSchema = Schema.Struct({
  modules: Schema.Array(ProjectModuleSchema),
  entryPoints: Schema.Array(Schema.String),
  circularDependencies: Schema.Array(Schema.Tuple(Schema.String, Schema.String)),
  totalScripts: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  totalModuleScripts: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type ProjectSkeleton = typeof ProjectSkeletonSchema.Type;

// ── Contract & envelope schemas ──────────────────────────────────────────

/**
 * Versioned contract for the project-index generated program.
 * Matches the pattern used by explorer and studio-target programs.
 */
export const PROJECT_INDEX_CONTRACT = {
  name: "project-index",
  version: "1",
  inputSchemaVersion: "project-index-input-v1",
  outputSchemaVersion: "project-index-skeleton-v1",
} as const;

/**
 * Schema for the envelope that wraps an AI-generated or built-in program
 * source string. The contract fields ensure the program matches the
 * expected input/output versions.
 */
export const ProjectIndexProgramEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  contract: Schema.Struct({
    name: Schema.Literal(PROJECT_INDEX_CONTRACT.name),
    version: Schema.Literal(PROJECT_INDEX_CONTRACT.version),
    inputSchemaVersion: Schema.Literal(PROJECT_INDEX_CONTRACT.inputSchemaVersion),
    outputSchemaVersion: Schema.Literal(PROJECT_INDEX_CONTRACT.outputSchemaVersion),
  }),
  source: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100_000)),
});

export type ProjectIndexProgramEnvelope = typeof ProjectIndexProgramEnvelopeSchema.Type;

// ── JSON Schemas (for AI structured output) ──────────────────────────────

/**
 * JSON Schema for the project index program envelope output.
 * Used by the AI to generate structured output matching our contract.
 */
export const PROJECT_INDEX_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "contract", "source"],
  properties: {
    version: { const: 1 },
    contract: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version", "inputSchemaVersion", "outputSchemaVersion"],
      properties: {
        name: { const: PROJECT_INDEX_CONTRACT.name },
        version: { const: PROJECT_INDEX_CONTRACT.version },
        inputSchemaVersion: { const: PROJECT_INDEX_CONTRACT.inputSchemaVersion },
        outputSchemaVersion: { const: PROJECT_INDEX_CONTRACT.outputSchemaVersion },
      },
    },
    source: { type: "string", minLength: 1, maxLength: 100_000 },
  },
} as const;

/**
 * JSON Schema for the project skeleton output (the result of running
 * the index program). Mirrors {@link ProjectSkeletonSchema} for AI
 * structured-output validation.
 */
export const PROJECT_INDEX_SKELETON_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "modules",
    "entryPoints",
    "circularDependencies",
    "totalScripts",
    "totalModuleScripts",
  ],
  properties: {
    modules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "path",
          "name",
          "className",
          "sourceLength",
          "dependencies",
          "dependentsCount",
          "dependencyDepth",
        ],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 1024 },
          name: { type: "string", minLength: 1, maxLength: 256 },
          className: { type: "string", minLength: 1, maxLength: 64 },
          sourceLength: { type: "integer", minimum: 0 },
          dependencies: { type: "array", items: { type: "string" } },
          dependentsCount: { type: "integer", minimum: 0 },
          dependencyDepth: { type: "integer", minimum: 0 },
        },
      },
    },
    entryPoints: { type: "array", items: { type: "string" } },
    circularDependencies: {
      type: "array",
      items: {
        type: "array",
        prefixItems: [{ type: "string" }, { type: "string" }],
        minItems: 2,
        maxItems: 2,
      },
    },
    totalScripts: { type: "integer", minimum: 0 },
    totalModuleScripts: { type: "integer", minimum: 0 },
  },
} as const;

// ── Luau source parsing ──────────────────────────────────────────────────

/**
 * Strip Luau line comments (`-- ...`) and block comments (`--[[ ... ]]`)
 * from source code so that `require()` calls inside comments are not parsed.
 *
 * Block comments are removed first (non-greedy, multiline), then line
 * comments are stripped per-line while respecting string literals so that
 * `--` inside a quoted string is not mistaken for a comment start.
 *
 * @param source - Raw Luau source code.
 * @returns Source code with comments removed, preserving newlines.
 */
export function stripLuauComments(source: string): string {
  // Remove block comments --[[ ... ]] (non-greedy, multiline).
  const result = source.replace(/--\[\[[\s\S]*?\]\]/g, "");

  // Remove line comments per-line, respecting string literals so that
  // `--` inside a quoted string is not treated as a comment start.
  const lines = result.split("\n");
  for (let i = 0; i < lines.length; i++) {
    lines[i] = stripLineComment(lines[i]);
  }
  return lines.join("\n");
}

/**
 * Remove a Luau line comment from a single line, respecting string literals.
 *
 * A `--` inside a single- or double-quoted string is not treated as a
 * comment start. Escape sequences (`\'`, `\"`) are handled so that escaped
 * quotes don't prematurely close the string.
 *
 * @param line - A single line of Luau source (no newlines).
 * @returns The line with any trailing `-- ...` comment removed.
 */
function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    const next = line[i + 1];

    // Inside a single-quoted string: skip escaped chars, look for closing quote.
    if (inSingle) {
      if (ch === "\\") {
        i++; // skip the escaped character
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }

    // Inside a double-quoted string: skip escaped chars, look for closing quote.
    if (inDouble) {
      if (ch === "\\") {
        i++; // skip the escaped character
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    // Not inside a string — track string entry points.
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }

    // Found `--` outside a string → this is a line comment start.
    if (ch === "-" && next === "-") {
      return line.slice(0, i);
    }
  }

  return line;
}

/**
 * Parse Luau `require()` calls from source code.
 *
 * Handles the common Roblox patterns:
 * - `require(script.Parent.Module)` — relative paths, kept as-is
 * - `require(game.ServerScriptService.Module)` — absolute `game.` paths
 * - `require(game:GetService("ServiceName").Path.To.Module)` — normalised to `game.ServiceName...`
 * - `require(ReplicatedStorage.Shared.Util)` — capitalised service names get `game.` prefix
 * - `require(someVariable)` — tagged as `var:someVariable` (not statically resolvable)
 *
 * Comments are stripped first (via {@link stripLuauComments}) so that
 * `require()` calls inside comments are ignored.
 *
 * @param source - Raw Luau source code.
 * @returns Array of canonical dependency key strings.
 */
export function parseRequireCalls(source: string): string[] {
  const deps: string[] = [];
  const cleanedSource = stripLuauComments(source);

  // Matches require(...) capturing the inner expression.
  // The pattern handles one level of nested parens for :GetService("...") calls.
  const requirePattern = /\brequire\s*\(\s*((?:[^()]+|\([^()]*\))+)\s*\)/g;

  for (const match of cleanedSource.matchAll(requirePattern)) {
    const inner = (match[1] ?? "").trim();
    if (!inner) continue;

    // Normalise the expression into a canonical dependency key.
    const dep = normaliseRequirePath(inner);
    if (dep) deps.push(dep);
  }

  return deps;
}

/**
 * Normalise a `require()` argument into a canonical dependency key.
 *
 * Conversion rules:
 * - String literal `"path.to.Module"` → `path.to.Module` (extracted value)
 * - Variable reference `someVar` → `var:someVar` (not statically resolvable)
 * - `game:GetService("X").Foo` → `game.X.Foo` (GetService normalised)
 * - `game.ReplicatedStorage.Foo` → kept as-is (already absolute)
 * - `ReplicatedStorage.Foo` → `game.ReplicatedStorage.Foo` (capitalised → `game.` prefix)
 * - `script.Parent.Foo` → kept as-is (relative path)
 *
 * @param expression - The raw expression inside `require(...)`.
 * @returns Canonical dependency key, or `null` if the expression is empty.
 */
function normaliseRequirePath(expression: string): string | null {
  // Strip all whitespace inside the expression for consistent matching.
  const cleaned = expression.replace(/\s+/g, "");

  // Edge case: empty expression after whitespace removal.
  if (!cleaned) return null;

  // String literal — extract the value between quotes.
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    return cleaned.slice(1, -1);
  }

  // Variable reference (lowercase start, no dots/colons) — tag with var: prefix
  // since it can't be resolved to a known module path statically.
  if (/^[a-z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    return `var:${cleaned}`;
  }

  // Normalise game:GetService("X") → game.X for consistent path matching.
  const normalised = cleaned.replace(
    /game\s*:\s*GetService\s*\(\s*["']([^"']+)["']\s*\)/g,
    "game.$1",
  );

  // Already an absolute game. path — return as-is.
  if (/^game\./.test(normalised)) {
    return normalised;
  }

  // Capitalised service name (e.g. ReplicatedStorage.Foo) — prefix with game.
  if (/^[A-Z]/.test(normalised)) {
    return `game.${normalised}`;
  }

  // Relative paths starting with script, shared, workspace, or plugin — kept as-is.
  if (/^(script|shared|workspace|plugin)\b/i.test(normalised)) {
    return normalised;
  }

  // Fallback: return the normalised expression as-is for unknown patterns.
  return normalised;
}

// ── Dependency graph builder ─────────────────────────────────────────────

/**
 * Input to {@link buildDependencyGraph}: a module without the computed
 * graph fields. The `dependentsCount` and `dependencyDepth` are derived
 * by the graph builder.
 */
export type ProjectModuleInput = Omit<ProjectModule, "dependentsCount" | "dependencyDepth">;

/**
 * Build a dependency graph from a list of modules.
 *
 * Computes:
 * - `dependentsCount` — how many other known modules depend on each module
 * - `dependencyDepth` — longest resolved dependency chain length
 *   (`0` = leaf, `1` = depends on leaves, …)
 * - `entryPoints` — modules that nothing else depends on
 * - `circularDependencies` — deduplicated `[from, to]` pairs that form a cycle
 *
 * Cycle detection uses DFS with a recursion stack. When a back-edge is
 * found, all nodes on the stack between the target and current node are
 * marked as cycle members. This ensures cycles longer than 2 nodes
 * (e.g. A→B→C→A) are fully detected, not just the back-edge endpoints.
 *
 * @param modules - Raw module descriptors without computed graph fields.
 * @returns Enriched modules with computed fields, entry points, and cycles.
 */
export function buildDependencyGraph(modules: ProjectModuleInput[]): {
  modules: ProjectModule[];
  entryPoints: string[];
  circularDependencies: [string, string][];
} {
  // Index modules by path for O(1) lookups.
  const pathToModule = new Map<string, ProjectModuleInput>();
  for (const mod of modules) {
    pathToModule.set(mod.path, mod);
  }

  // ── Dependents tracking ────────────────────────────────────────────────

  // Build a reverse map: for each dependency, which modules depend on it?
  // Only dependencies that resolve to known modules are tracked.
  const dependents = new Map<string, Set<string>>();
  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      if (pathToModule.has(dep)) {
        if (!dependents.has(dep)) dependents.set(dep, new Set());
        dependents.get(dep)!.add(mod.path);
      }
    }
  }

  // Entry points: modules with zero dependents (nothing requires them).
  const entryPoints = modules
    .filter((mod) => !dependents.has(mod.path) || dependents.get(mod.path)!.size === 0)
    .map((mod) => mod.path);

  // ── Cycle detection (DFS with recursion stack) ─────────────────────────

  // Deduplicate cycles by canonical sorted key so (A,B) and (B,A) map to the same entry.
  const seenCycles = new Set<string>();
  const circularDependencies: [string, string][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackArr: string[] = [];
  const cycleMembers = new Set<string>();

  function dfs(current: string) {
    // Skip already-visited or already-on-stack nodes.
    if (inStack.has(current)) return;
    if (visited.has(current)) return;

    visited.add(current);
    inStack.add(current);
    stackArr.push(current);

    const mod = pathToModule.get(current);
    if (mod) {
      for (const dep of mod.dependencies) {
        // Only follow edges to known modules.
        if (pathToModule.has(dep)) {
          if (inStack.has(dep)) {
            // Back-edge found → cycle detected.
            // Deduplicate by sorted pair key so (A,B) and (B,A) are the same cycle.
            const key = [current, dep].sort().join("\u2194");
            if (!seenCycles.has(key)) {
              seenCycles.add(key);
              circularDependencies.push([current, dep]);
            }

            // Mark all nodes on the stack between dep and current as cycle members.
            // This catches intermediate nodes in longer cycles (e.g. B in A→B→C→A).
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

  // Run DFS from every module to catch disconnected cycles.
  for (const mod of modules) {
    dfs(mod.path);
  }

  // ── Dependency depth computation (memoised DFS) ────────────────────────

  const depthCache = new Map<string, number>();
  const computing = new Set<string>();

  function computeDepth(path: string): number {
    // Return cached result if available.
    if (depthCache.has(path)) return depthCache.get(path)!;

    // Cycle members get depth 0 directly to avoid infinite recursion
    // and prevent inflated depth values from circular edges.
    if (cycleMembers.has(path)) {
      depthCache.set(path, 0);
      return 0;
    }

    // Guard against unexpected cycles: if we're already computing this
    // node, return -1 to signal "skip this edge" to the caller.
    if (computing.has(path)) return -1;
    computing.add(path);

    const mod = pathToModule.get(path);
    let maxDepDepth = 0;
    if (mod) {
      for (const dep of mod.dependencies) {
        if (pathToModule.has(dep)) {
          const depDepth = computeDepth(dep);
          // Skip cycle edges (depDepth === -1) so they don't inflate depth.
          if (depDepth >= 0 && depDepth + 1 > maxDepDepth) {
            maxDepDepth = depDepth + 1;
          }
        }
      }
    }

    computing.delete(path);
    depthCache.set(path, maxDepDepth);
    return maxDepDepth;
  }

  // ── Enrich modules with computed fields ────────────────────────────────

  const enrichedModules: ProjectModule[] = modules.map((mod) => ({
    ...mod,
    dependentsCount: dependents.get(mod.path)?.size ?? 0,
    dependencyDepth: computeDepth(mod.path),
  }));

  return { modules: enrichedModules, entryPoints, circularDependencies };
}
