import { Schema } from "effect";

/**
 * Represents a single Roblox script/module discovered in the place.
 * The path is a dot-separated game path (e.g. "game.ServerScriptService.Main").
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
   * Depth in the dependency graph (0 = no dependencies, 1 = depends only on leaf modules, etc.).
   * Modules with unresolved dependencies are treated as depth 0 for calculation purposes.
   */
  dependencyDepth: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type ProjectModule = typeof ProjectModuleSchema.Type;

/**
 * The full project skeleton returned by the indexing program.
 * entryPoints are modules that nothing else depends on (orphans with no dependents).
 * circularDependencies lists pairs of paths that form a cycle.
 */
export const ProjectSkeletonSchema = Schema.Struct({
  modules: Schema.Array(ProjectModuleSchema),
  entryPoints: Schema.Array(Schema.String),
  circularDependencies: Schema.Array(Schema.Tuple(Schema.String, Schema.String)),
  totalScripts: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  totalModuleScripts: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type ProjectSkeleton = typeof ProjectSkeletonSchema.Type;

/**
 * Contract for the project-index generated program.
 * Matches the pattern used by explorer and studio-target programs.
 */
export const PROJECT_INDEX_CONTRACT = {
  name: "project-index",
  version: "1",
  inputSchemaVersion: "project-index-input-v1",
  outputSchemaVersion: "project-index-skeleton-v1",
} as const;

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

/**
 * JSON Schema for the project index program output.
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

/**
 * Strip Luau line comments (`-- ...`) and block comments (`--[[ ... ]]`)
 * from source code so that require() calls inside comments are not parsed.
 */
export function stripLuauComments(source: string): string {
  // Remove block comments --[[ ... ]] (non-greedy, multiline).
  const result = source.replace(/--\[\[[\s\S]*?\]\]/g, "");
  // Remove line comments -- ... but preserve string contents.
  // We process line by line, respecting string literals.
  const lines = result.split("\n");
  for (let i = 0; i < lines.length; i++) {
    lines[i] = stripLineComment(lines[i]);
  }
  return lines.join("\n");
}

/**
 * Remove a Luau line comment from a single line, respecting string literals.
 * A `--` inside a quoted string is not treated as a comment start.
 */
function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (inSingle) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === "-" && next === "-") {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Parse Luau require() calls from source code.
 *
 * Handles the common Roblox patterns:
 *   require(script.Parent.Module)
 *   require(game.ServerScriptService.Module)
 *   require(game:GetService("ServiceName").Path.To.Module)
 *   require(ReplicatedStorage.Shared.Util)
 *   require(someVariable) -- tracked as a variable reference
 *
 * Comments are stripped first so require() calls inside comments are ignored.
 * Returns an array of dependency paths as they appear in the require call.
 */
export function parseRequireCalls(source: string): string[] {
  const deps: string[] = [];
  const cleanedSource = stripLuauComments(source);
  // Matches require(...) where the inner expression is captured.
  // Handles nested parens for :GetService("...") calls.
  const requirePattern = /\brequire\s*\(\s*((?:[^()]+|\([^()]*\))+)\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = requirePattern.exec(cleanedSource)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;

    // Normalise the expression into a dependency key.
    const dep = normaliseRequirePath(inner);
    if (dep) deps.push(dep);
  }

  return deps;
}

/**
 * Normalise a require() argument into a canonical dependency key.
 *
 * Converts:
 *   script.Parent.ModuleName -> "script.Parent.ModuleName" (relative, kept as-is)
 *   game.ServerScriptService.Module -> "game.ServerScriptService.Module"
 *   game:GetService("ServerScriptService").Module -> "game.ServerScriptService.Module"
 *   ReplicatedStorage.Shared.Util -> "game.ReplicatedStorage.Shared.Util" (normalized with game. prefix)
 *   someVariable -> "var:someVariable" (variable reference, not resolvable statically)
 */
function normaliseRequirePath(expression: string): string | null {
  // Strip whitespace inside the expression.
  const cleaned = expression.replace(/\s+/g, "");

  // If it's a string literal, return it directly.
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    return cleaned.slice(1, -1);
  }

  // If it's a variable reference (lowercase start, no dots or colons), tag it.
  if (/^[a-z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    return `var:${cleaned}`;
  }

  // Normalise game:GetService("X") -> game.X
  const normalised = cleaned.replace(
    /game\s*:\s*GetService\s*\(\s*["']([^"']+)["']\s*\)/g,
    "game.$1",
  );

  // If it starts with "game." or a known service name, it's an absolute path.
  // Normalize to always include the game. prefix for consistent dependency resolution.
  if (/^game\./.test(normalised)) {
    return normalised;
  }
  if (/^[A-Z]/.test(normalised)) {
    return `game.${normalised}`;
  }

  // Relative paths starting with script, shared, etc.
  if (/^(script|shared|workspace|plugin)\b/i.test(normalised)) {
    return normalised;
  }

  // Fallback: return the normalised expression as-is.
  return normalised;
}

/**
 * Input to buildDependencyGraph: a module without the computed graph fields.
 * The dependentsCount and dependencyDepth are derived by the graph builder.
 */
export type ProjectModuleInput = Omit<ProjectModule, "dependentsCount" | "dependencyDepth">;

/**
 * Build a dependency graph from a list of modules.
 *
 * Computes:
 *   - dependentsCount: how many other known modules depend on each module
 *   - dependencyDepth: longest dependency chain length (0 = leaf, 1 = depends on leaves, …)
 *   - entryPoints: modules that nothing else depends on
 *   - circularDependencies: deduplicated pairs of paths that form a cycle
 *
 * Returns the enriched modules alongside the entry points and circular dependency info.
 */
export function buildDependencyGraph(modules: ProjectModuleInput[]): {
  modules: ProjectModule[];
  entryPoints: string[];
  circularDependencies: [string, string][];
} {
  const pathToModule = new Map<string, ProjectModuleInput>();
  for (const mod of modules) {
    pathToModule.set(mod.path, mod);
  }

  // Track dependents (modules that depend on each module).
  const dependents = new Map<string, Set<string>>();
  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      // Only track dependencies that resolve to known modules.
      if (pathToModule.has(dep)) {
        if (!dependents.has(dep)) dependents.set(dep, new Set());
        dependents.get(dep)!.add(mod.path);
      }
    }
  }

  // Entry points: modules that nothing else depends on.
  const entryPoints = modules
    .filter((mod) => !dependents.has(mod.path) || dependents.get(mod.path)!.size === 0)
    .map((mod) => mod.path);

  // Detect circular dependencies via DFS, deduplicating by canonical cycle key.
  // Also collect all nodes that participate in any cycle by tracing the recursion
  // stack when a back-edge is found (handles cycles longer than 2).
  const seenCycles = new Set<string>();
  const circularDependencies: [string, string][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackArr: string[] = [];
  const cycleMembers = new Set<string>();

  function dfs(current: string) {
    if (inStack.has(current)) return;
    if (visited.has(current)) return;
    visited.add(current);
    inStack.add(current);
    stackArr.push(current);

    const mod = pathToModule.get(current);
    if (mod) {
      for (const dep of mod.dependencies) {
        if (pathToModule.has(dep)) {
          if (inStack.has(dep)) {
            // Deduplicate: sort the pair so (A,B) and (B,A) map to the same key.
            const key = [current, dep].sort().join("\u2194");
            if (!seenCycles.has(key)) {
              seenCycles.add(key);
              circularDependencies.push([current, dep]);
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

  for (const mod of modules) {
    dfs(mod.path);
  }

  // Compute dependency depth via memoised DFS on resolved dependencies.
  const depthCache = new Map<string, number>();
  const computing = new Set<string>();

  function computeDepth(path: string): number {
    if (depthCache.has(path)) return depthCache.get(path)!;
    // Cycle members get depth 0 directly.
    if (cycleMembers.has(path)) {
      depthCache.set(path, 0);
      return 0;
    }
    // Guard against unexpected cycles: if we're already computing this node, skip it.
    if (computing.has(path)) return -1;
    computing.add(path);

    const mod = pathToModule.get(path);
    let maxDepDepth = 0;
    if (mod) {
      for (const dep of mod.dependencies) {
        if (pathToModule.has(dep)) {
          const depDepth = computeDepth(dep);
          // Skip cycle edges (depDepth === -1) so they don't inflate depth.
          if (depDepth >= 0 && depDepth + 1 > maxDepDepth) maxDepDepth = depDepth + 1;
        }
      }
    }

    computing.delete(path);
    depthCache.set(path, maxDepDepth);
    return maxDepDepth;
  }

  // Build enriched modules with computed fields.
  const enrichedModules: ProjectModule[] = modules.map((mod) => ({
    ...mod,
    dependentsCount: dependents.get(mod.path)?.size ?? 0,
    dependencyDepth: computeDepth(mod.path),
  }));

  return { modules: enrichedModules, entryPoints, circularDependencies };
}
