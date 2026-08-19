import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { flushSync } from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { transform } from "sucrase";

import type { AppGeneratedFile } from "./types";

/**
 * In-app runtime for generated apps. Compiles the generated Vite + React +
 * TypeScript project on the fly (sucrase), wires a tiny CommonJS module loader
 * that resolves local files plus the handful of host modules the generator is
 * allowed to import, and mounts the React app into the provided window (an
 * isolated iframe in the UI, or any window in tests).
 */

interface HostModule {
  __esModule: true;
  default: unknown;
  [key: string]: unknown;
}

function hostModule(namespace: Record<string, unknown>, fallback: unknown): HostModule {
  return { ...namespace, __esModule: true, default: namespace.default ?? fallback };
}

const REACT_NS = React as unknown as Record<string, unknown>;
const REACT_DOM_NS = ReactDOM as unknown as Record<string, unknown>;
const REACT_DOM_CLIENT_NS = ReactDOMClient as unknown as Record<string, unknown>;
const REACT_JSX_NS = ReactJsxRuntime as unknown as Record<string, unknown>;

const HOST_MODULES: Record<string, HostModule> = {
  react: hostModule(REACT_NS, React),
  "react-dom": hostModule(REACT_DOM_NS, ReactDOM),
  "react-dom/client": hostModule(REACT_DOM_CLIENT_NS, ReactDOMClient),
  "react/jsx-runtime": hostModule(REACT_JSX_NS, ReactJsxRuntime),
  "react/jsx-dev-runtime": hostModule(REACT_JSX_NS, ReactJsxRuntime),
};

/**
 * 3D game stack host modules, loaded on demand only when a generated app
 * actually imports them (detected by scanning the file tree). Kept out of the
 * static map so plain web apps never pay for three.js / R3F / Rapier.
 */
const HOST_3D_MODULES: Array<{
  specifier: string;
  loader: () => Promise<Record<string, unknown>>;
}> = [
  {
    specifier: "three",
    loader: async () => {
      const namespace = (await import("three")) as Record<string, unknown>;
      return { ...namespace, default: namespace.default ?? namespace };
    },
  },
  {
    specifier: "@react-three/fiber",
    loader: async () => {
      const namespace = (await import("@react-three/fiber")) as Record<string, unknown>;
      return namespace;
    },
  },
  {
    specifier: "@react-three/drei",
    loader: async () => {
      const namespace = (await import("@react-three/drei")) as Record<string, unknown>;
      return namespace;
    },
  },
  {
    specifier: "@react-three/rapier",
    loader: async () => {
      const namespace = (await import("@react-three/rapier")) as Record<string, unknown>;
      return namespace;
    },
  },
];

/** Scan a generated file tree for imports of the 3D game stack. */
export function needs3DHostModules(files: readonly AppGeneratedFile[]): boolean {
  return imported3DHostModules(files).size > 0;
}

const HOST_3D_SPECIFIERS: ReadonlySet<string> = new Set(
  HOST_3D_MODULES.map((module) => module.specifier),
);

const IMPORT_3D_PATTERNS = [
  /from\s+["']((?:@react-three\/(?:fiber|drei|rapier)|three))(?:[/"']|$)/g,
  /import\s+["']((?:@react-three\/(?:fiber|drei|rapier)|three))(?:[/"']|$)/g,
  /import\s*\(\s*["']((?:@react-three\/(?:fiber|drei|rapier)|three))(?:[/"']|$)/g,
];

/**
 * Return the subset of 3D host modules the generated file tree actually
 * imports, so only those bundles get pulled into the preview. Loading the whole
 * R3F stack whenever *any* reference appears (e.g. only `three`) pays for drei
 * and rapier unnecessarily.
 */
export function imported3DHostModules(files: readonly AppGeneratedFile[]): Set<string> {
  const used = new Set<string>();
  for (const file of files) {
    for (const pattern of IMPORT_3D_PATTERNS) {
      const re = new RegExp(pattern.source, "g");
      let match: RegExpExecArray | null;
      for (;;) {
        match = re.exec(file.content);
        if (!match) break;
        const specifier = match[1];
        if (HOST_3D_SPECIFIERS.has(specifier)) used.add(specifier);
      }
    }
  }
  return used;
}

// Entry files that bootstrap the app themselves (createRoot(container).render()).
const BOOTSTRAP_ENTRIES = new Set(["src/main.tsx"]);

const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js"];
const CSS_IMPORT_RE = /^\s*@import\b[^;]*;/gm;

/** Convert a path to a canonical POSIX form (no leading ./ or trailing /). */
function canonicalize(value: string): string {
  const parts: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

function resolveSpecifier(baseDir: string, specifier: string): string {
  return canonicalize(`${baseDir}/${specifier}`);
}

/** Strip @import lines so plain CSS files never try to load external deps. */
function sanitizeCss(source: string): string {
  return source.replace(CSS_IMPORT_RE, "").trim();
}

/**
 * Bounded cross-build cache of sucrase output, keyed by the exact source text.
 * Kept module-scoped (not per-mount) so unchanged files skip re-transpilation,
 * which is by far the most expensive step in the single-threaded browser
 * compile. The compiled string is realm-agnostic, so it is safe to reuse across
 * window mounts. The cache is size-capped so a long session editing many files
 * can't grow it without bound.
 */
const COMPILED_CODE_CACHE = new Map<string, string>();
const COMPILED_CODE_CACHE_MAX = 512;

interface CompileStats {
  compiled: number;
  cacheHits: number;
}

function cachedCompileSource(source: string, stats?: CompileStats): string {
  const hit = COMPILED_CODE_CACHE.get(source);
  if (hit) {
    if (stats) stats.cacheHits += 1;
    return hit;
  }
  const compiled = transform(source, {
    transforms: ["imports", "typescript", "jsx"],
    jsxRuntime: "automatic",
    production: true,
  }).code;
  if (stats) stats.compiled += 1;
  if (COMPILED_CODE_CACHE.size >= COMPILED_CODE_CACHE_MAX) {
    const oldest = COMPILED_CODE_CACHE.keys().next().value;
    if (oldest !== undefined) COMPILED_CODE_CACHE.delete(oldest);
  }
  COMPILED_CODE_CACHE.set(source, compiled);
  return compiled;
}

/** Bare specifiers the in-app runtime can resolve (mirrors the CJS loader). */
const ALLOWED_BARE_SPECIFIERS: ReadonlySet<string> = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "lucide-react",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "@react-three/rapier",
]);

/**
 * Matches `from "x"`, `import "x"` and `import("x")` (including multi-line).
 * Written as explicit alternatives with a capture group so stray quoted strings
 * like `getElementById("root")` are never mistaken for imports.
 */
const IMPORT_SPECIFIER_PATTERNS = [
  /from\s+["']([^"']+)["']/g,
  /import\s+["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']/g,
];

export interface DisallowedImport {
  file: string;
  specifier: string;
}

/**
 * Statically scan generated source for imports the in-app runtime cannot
 * resolve, so the preview can fail with precise guidance instead of a boot-time
 * `Cannot resolve …` crash. Relative imports ("./x", "../x") and the allowed
 * bare modules are ignored. CSS/JSON files never compile through sucrase, so
 * they are skipped.
 */
export function findDisallowedImports(files: readonly AppGeneratedFile[]): DisallowedImport[] {
  const found: DisallowedImport[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (file.path.endsWith(".css") || file.path.endsWith(".json")) continue;
    for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
      const re = new RegExp(pattern.source, "g");
      let match: RegExpExecArray | null;
      for (;;) {
        match = re.exec(file.content);
        if (!match) break;
        const specifier = match[1];
        // Relative path — resolved locally by the loader.
        if (specifier.startsWith(".")) continue;
        if (ALLOWED_BARE_SPECIFIERS.has(specifier)) continue;
        const key = `${file.path}\u0000${specifier}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ file: file.path, specifier });
      }
    }
  }
  return found;
}

/** Milliseconds clock that works in jsdom, browsers, and Workers. */
function performanceNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Lightweight metrics reported after a successful preview mount. */
export interface PreviewCompileStats {
  /** Number of source modules actually transpiled this mount. */
  compiled: number;
  /** Number of source modules served from the cross-build sucrase cache. */
  cacheHits: number;
  /** Wall-clock time of the entire boot (3D load + compile + render). */
  elapsedMs: number;
}

export interface AppPreviewOptions {
  files: readonly AppGeneratedFile[];
  /** Bootstrap module; defaults to src/main.tsx. */
  entry?: string;
  /** DOM node the app mounts into (inside the target window). */
  container: HTMLElement;
  /** Window whose realm the generated code runs in (iframe for isolation). */
  targetWindow: Window;
  /** Optional observer for compile/boot metrics (measuring preview cost). */
  onCompile?: (stats: PreviewCompileStats) => void;
}

/**
 * Compile and mount a generated app. Resolves the entry module (src/main.tsx
 * by default), executes it with a CJS loader bound to the target window, and
 * lets the generated code call createRoot() on the container. Returns a
 * cleanup that detaches anything we injected.
 */
export async function mountAppPreview(options: AppPreviewOptions): Promise<() => void> {
  const { files, container, targetWindow } = options;
  const doc = targetWindow.document;

  // Optional compile/boot metrics observer.
  const compileStats: CompileStats = { compiled: 0, cacheHits: 0 };
  const startedAt = performanceNow();

  // Fail fast with precise guidance before any compile/boot work if the project
  // imports modules the in-app runtime cannot resolve.
  const offenders = findDisallowedImports(files);
  if (offenders.length > 0) {
    throw new Error(
      `This project imports modules the preview can't run:\n${offenders
        .map((o) => `${o.file}: "${o.specifier}"`)
        .join(
          "\n",
        )}\n\nOnly React, lucide-react, and the three · @react-three/fiber · drei · rapier stack are available.`,
    );
  }

  // Loaded lazily so the whole icon library stays out of the main bundle until
  // an app preview actually needs it.
  const lucideNamespace = (await import("lucide-react")) as Record<string, unknown>;
  const hostModules: Record<string, HostModule> = {
    ...HOST_MODULES,
    "lucide-react": hostModule(lucideNamespace, lucideNamespace),
  };

  // Games that use the R3F stack pull in only the three.js / fiber / drei /
  // rapier host modules they actually import; load them before the entry
  // executes so their CJS imports resolve. Plain web apps skip this entirely.
  const needed3D = imported3DHostModules(files);
  if (needed3D.size > 0) {
    const loaded = await Promise.all(
      HOST_3D_MODULES.filter((entry) => needed3D.has(entry.specifier)).map(async (entry) => ({
        specifier: entry.specifier,
        namespace: await entry.loader(),
      })),
    );
    for (const { specifier, namespace } of loaded) {
      hostModules[specifier] = hostModule(namespace, namespace.default ?? namespace);
    }
  }

  const byPath = new Map<string, AppGeneratedFile>();
  for (const file of files) byPath.set(canonicalize(file.path), file);

  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const injectedStyles = new Set<string>();

  function injectStyles(source: string): void {
    if (injectedStyles.has(source)) return;
    injectedStyles.add(source);
    const cleaned = sanitizeCss(source);
    if (!cleaned) return;
    const style = doc.createElement("style");
    style.setAttribute("data-bloxmind-app", "");
    style.textContent = cleaned;
    doc.head.appendChild(style);
  }

  function resolveFile(path: string): string | null {
    for (const extension of EXTENSIONS) {
      const candidate = `${path}${extension}`;
      if (byPath.has(candidate)) return candidate;
    }
    for (const extension of EXTENSIONS) {
      const candidate = `${path}/index${extension}`;
      if (byPath.has(candidate)) return candidate;
    }
    return null;
  }

  function createRequire(baseDir: string): (specifier: string) => unknown {
    return (specifier: string): unknown => {
      if (specifier.startsWith(".")) {
        return loadModule(resolveSpecifier(baseDir, specifier));
      }
      const host = hostModules[specifier];
      if (host) return host;
      throw new Error(
        `Cannot resolve "${specifier}" — generated apps may only import react, react-dom, react-dom/client, react/jsx-runtime, lucide-react, three, @react-three/fiber, @react-three/drei, and @react-three/rapier.`,
      );
    };
  }

  function loadModule(path: string): unknown {
    const resolved = resolveFile(path);
    if (!resolved) throw new Error(`Cannot find module "${path}".`);

    const cached = modules.get(resolved);
    if (cached) return cached.exports;

    const file = byPath.get(resolved);
    if (!file) throw new Error(`Cannot find module "${path}".`);
    const moduleRecord = { exports: {} as Record<string, unknown> };
    modules.set(resolved, moduleRecord);

    if (resolved.endsWith(".css")) {
      injectStyles(file.content);
      return moduleRecord.exports;
    }

    if (resolved.endsWith(".json")) {
      try {
        moduleRecord.exports = JSON.parse(file.content) as Record<string, unknown>;
      } catch (cause) {
        throw new Error(
          `Invalid JSON in "${resolved}": ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      return moduleRecord.exports;
    }

    const compiled = cachedCompileSource(file.content, compileStats);
    const realmFunction = targetWindow as unknown as { Function: typeof Function };
    const factory = new realmFunction.Function("require", "module", "exports", compiled);
    factory(createRequire(dirname(resolved)), moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  }

  // Resolve and boot the app entry.
  const requestedEntry = canonicalize(options.entry ?? "src/main.tsx");
  let entry = resolveFile(requestedEntry);
  if (!entry) entry = resolveFile("src/App");
  if (!entry) {
    throw new Error(`The generated app has no ${requestedEntry} or src/App entry point.`);
  }

  try {
    const entryExports = loadModule(entry) as Record<string, unknown> | undefined;

    // Bootstrap entries (src/main.tsx) call createRoot(container).render() on
    // their own — just executing the module is enough. For fallback entries
    // (src/App.tsx etc.) mount the default-exported component.
    if (!BOOTSTRAP_ENTRIES.has(entry)) {
      const Component = entryExports?.default;
      if (typeof Component !== "function") {
        throw new Error(
          `The generated app's entry (${entry}) does not default-export a component.`,
        );
      }
      // flushSync renders synchronously so mount errors propagate to the caller.
      flushSync(() => {
        ReactDOMClient.createRoot(container).render(
          React.createElement(Component as React.ComponentType),
        );
      });
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Your app hit an error while running: ${message}`);
  }

  options.onCompile?.({
    compiled: compileStats.compiled,
    cacheHits: compileStats.cacheHits,
    elapsedMs: performanceNow() - startedAt,
  });

  return () => {
    for (const style of doc.querySelectorAll("style[data-bloxmind-app]")) {
      style.remove();
    }
    container.replaceChildren();
  };
}
