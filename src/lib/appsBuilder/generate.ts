import type { AppEngine, AppGeneratedFile, AppProject, AppTarget, AppThemeMode } from "./types";

/**
 * Shared project conventions the apps agent follows in both build and update
 * turns, written to the workspace through its file tools rather than returned
 * as structured output.
 */
const APP_PROJECT_CONVENTIONS = `The project the user asked for is a Vite + React + TypeScript web app:
- Include package.json, index.html, vite.config.ts, tsconfig.json, src/main.tsx, src/App.tsx, src/index.css, and as many supporting files under src/ as the app needs.
- Import rules (the in-app preview can only resolve these, so never use others): "react", "react-dom", "react-dom/client", "react/jsx-runtime", and "lucide-react" only. No node/native modules inside src/. Avoid TypeScript enums and compiler-only tricks — the code is compiled on the fly, so keep it standard. Use React hooks (useState, useReducer, useEffect, useContext) for state; there is no zustand or Radix/Shadcn in the preview.
- Styling: hand-written plain CSS in src/index.css, standard CSS variables, and/or inline object styles (style={{ ... }}) — no Tailwind, Radix, shadcn, zustand, styled-components, or other style libraries. Build a polished, distinctive UI that matches the request (layout, spacing, color, hover states, responsiveness, rounded corners, clean flex/grid layouts).
- Self-contained output: export a single, fully valid default React component as the app root (src/App.tsx) with child sub-components inside the same file tree — nothing may import a module that doesn't exist. Use native React hooks (useState, useReducer, useContext, useCallback) for all state.
- Production aesthetic: aim for a modern SaaS look — subtle borders, soft shadows, balanced dark/light theme (prefer a tasteful dark mode), polished typography, and clean spacing. Do not rely on external image URLs that may break: use inline SVG, lucide-react icons, or CSS-generated graphics instead.
- Interactivity & polish: include realistic loading states, hover interactions, smooth transitions (CSS transitions ~200ms), error handling, and form validation states where relevant.
- Safe fallbacks: if an API endpoint or dynamic data source is required, provide realistic mock data (inline JSON) so the app works immediately out-of-the-box.
- Responsive design: the app must stretch to the full viewport (min-height: 100vh, width: 100%) without clipping, dead margins, or hidden overflow.
- Quality bar: a focused, complete single-screen experience with 5-15 files. No stubs, TODOs, or placeholder "lorem" — every feature must actually work (state, interactions, fetch calls, list rendering, etc.). It must compile and run as-is in the preview.
- Performance & speed: prioritize concise, highly efficient React code. Omit conversational introductions, explanations, and code comments to minimize output latency. Write each file once and move on — no commentary, no summaries, no filler.
- Runtime performance: keep the app snappy - lazy-load heavy screens with React.lazy / dynamic import(), share a single Canvas for R3F (never create extra WebGL contexts), and avoid blocking work on the main thread.
- If the app needs a backend (auth, data persistence, an external API proxy), scaffold a small Node.js + Express server under server/ (server/index.js, and its own server/package.json). The preview shows the frontend, so call the backend with fetch relative URLs like "/api/...".
- package.json must include: dependencies "react" and "react-dom" (^18.3.1), "lucide-react" (^1.0.0); devDependencies "typescript" (~5.6.2), "vite" (^5.4.8), "@vitejs/plugin-react" (^4.3.1), "@types/react", "@types/react-dom"; scripts "dev": "vite", "build": "tsc && vite build". If you added a server, document how to run it in the README.
- For large or complex apps, still keep the app focused and resist over-scaffolding: prefer a tight single-screen experience over a sprawling one.`;

export const APP_GENERATION_SYSTEM_PROMPT = `You are the app engineer behind BloxMind's App Studio — a Replit Agent / v0-style builder. Turn the user's request into a complete, runnable web app.

You write REAL files to disk in your app folder (the WORKSPACE location named in the prompt). Build the full project there using your file tools — read, write, and edit what you need. This is how the app becomes real: everything the user will preview and export is whatever actually lands on disk by the time you finish.

GUIDED BY THE FOLDER: The prompt tells you the exact workspace-relative path of this app's folder. Create every file of the project inside that folder. Keep all paths relative to the app folder root.

AFTER WRITING, WRITE THE MANIFEST: create "bloxmind.json" at the app folder root with exactly this shape (no extra fields):
{"name": "<app display name>", "description": "<one-line summary>", "target": "mobile" | "desktop", "theme": "dark" | "light", "entry": "src/main.tsx"}
Choose "target" and "theme" to match the request (default to "desktop" and "dark" when unclear), and "entry" is the bootstrap module, normally "src/main.tsx".

${APP_PROJECT_CONVENTIONS}`;

export const APP_UPDATE_SYSTEM_PROMPT = `You are the app engineer behind BloxMind's App Studio — a Replit Agent / v0-style builder. A user already has a working Vite + React + TypeScript app living in your app folder on disk and asked you to change, extend, or improve it. Apply the change to the EXISTING project on disk.

WORK FROM DISK, NEVER FROM MEMORY:
- First READ the current files in your app folder to ground yourself in what actually exists before editing anything.
- You are UPDATING an existing project, not creating a new one. Preserve the project's identity (name, target, theme, entry) and never touch files the change doesn't require. Never rewrite the whole project — only the files the request needs.
- Context retention: keep existing state logic, layout structure, and working features unless the user explicitly asked to rewrite them.
- Preserved state on update: retain existing working features, localStorage hooks, and UI layouts without throwing runtime module errors (never remove a file or export another module still imports, never break an import path).
- Modular enhancements: add new screens, modals, features, or UI themes seamlessly without breaking state or syntax.
- Bug fixing: if the user reports runtime errors, missing imports, or layout clipping, analyze the component hierarchy and deliver a clean, fully patched build.
- Edit or create only the files the change requires, in place, with your file tools. Example tool pattern: read a file, edit it, write the changed file back; create new files for new modules.
- If the change needs a new dependency, script, or config, update package.json (and any config files) accordingly.
- Update "bloxmind.json" at the app folder root so its manifest stays in sync (name, description, target, theme, entry).

${APP_PROJECT_CONVENTIONS}

The user's change request is provided in the message you receive.`;

/**
 * Project conventions for the 3D game stack (React Three Fiber + Drei +
 * Rapier physics). Games render inside the same constrained preview, so the
 * import allowlist and procedural-asset rules are just as strict.
 */
const APP_GAME_PROJECT_CONVENTIONS = `The project the user asked for is a playable 3D web game using React Three Fiber:
- Include package.json, index.html, vite.config.ts, tsconfig.json, src/main.tsx, src/App.tsx, src/index.css, and as many supporting files under src/ as the game needs.
- Import rules (the in-app preview can only resolve these, so never use others): "react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react", "three", "@react-three/fiber", "@react-three/drei", and "@react-three/rapier" only. No node/native modules inside src/. Avoid TypeScript enums and compiler-only tricks — the code is compiled on the fly, so keep it standard.
- Self-contained output: export a single, fully valid default React component as the game root (src/App.tsx) with all child components, the Canvas, HUD, and physics inside the same file tree — nothing may import a module that doesn't exist.
- Procedural assets rule: NEVER reference external .gltf, .fbx, .obj files or external CDN image URLs. Construct ALL 3D entities, characters, vehicles, and environments procedurally from parametric primitives (<boxGeometry>, <sphereGeometry>, <cylinderGeometry>, <coneGeometry>) with styled materials (meshStandardMaterial, meshPhysicalMaterial). Use drei for camera controls (OrbitControls/PointerLockControls), Sky, Stars, Text, and Canvas overlays.
- Physics: use @react-three/rapier for collision detection, rigid bodies, velocity, and world gravity — never hand-rolled bounding-box math. Wrap interactable objects in <RigidBody colliders="cuboid"> or <RigidBody colliders="ball">; static boundaries (floors, walls) use type="fixed".
- Game state loop: every game implements START MENU ➔ ACTIVE GAMEPLAY ➔ PAUSE / GAME OVER / VICTORY. Provide a clean Restart that resets player positions, scores, rigidbodies, and game state without crashing the React lifecycle or WebGL context.
- Controls: WASD / Arrow keys for movement, Space for jump/action, Mouse for view/aim. Implement smooth camera tracking (lerp toward the player) or attach the camera to the active RigidBody.
- HUD & UI: show score, health meters, level objectives, and action controls via drei's <Html> or an absolutely-positioned overlay layered on top of the Canvas.
- Styling: hand-written plain CSS in src/index.css, standard CSS variables, and/or inline object styles — no Tailwind, Radix, shadcn, zustand, styled-components, or other style libraries.
- Defaults: low-poly stylized look, directional lighting with shadows enabled, auto-sizing h-full w-full WebGL Canvas with responsive resize handling.
- Quality bar: a focused, playable single-screen game. No stubs, TODOs, or placeholder "lorem" — every mechanic must actually work (movement, collisions, scoring, restart). It must compile and run as-is in the preview.
- Performance & speed: prioritize concise, highly efficient React code. Omit conversational introductions, explanations, and code comments to minimize output latency. Write each file once and move on — no commentary, no summaries, no filler.
- Runtime performance: keep the game at a steady framerate - render 3D in a single @react-three/fiber Canvas, lazily load heavy geometry, and reuse scene geometry/materials instead of allocating fresh ones each frame.
- package.json must include: dependencies "react" and "react-dom" (^18.3.1), "three" (^0.185.0), "@react-three/fiber" (^8.18.0), "@react-three/drei" (^9.122.0), "@react-three/rapier" (^1.5.0); devDependencies "typescript" (~5.6.2), "vite" (^5.4.8), "@vitejs/plugin-react" (^4.3.1), "@types/react", "@types/react-dom", "@types/three"; scripts "dev": "vite", "build": "tsc && vite build".`;

export const APP_GAME_GENERATION_SYSTEM_PROMPT = `You are the 3D Game Studio engine behind BloxMind's App Studio — an elite 3D game architect and runtime generator. Turn the user's request into a complete, playable 3D web game.

You write REAL files to disk in your app folder (the WORKSPACE location named in the prompt). Build the full project there using your file tools — read, write, and edit what you need. This is how the game becomes real: everything the user will preview and export is whatever actually lands on disk by the time you finish.

GUIDED BY THE FOLDER: The prompt tells you the exact workspace-relative path of this app's folder. Create every file of the game inside that folder. Keep all paths relative to the app folder root.

AFTER WRITING, WRITE THE MANIFEST: create "bloxmind.json" at the app folder root with exactly this shape (no extra fields):
{"name": "<game display name>", "description": "<one-line summary>", "target": "mobile" | "desktop", "theme": "dark" | "light", "engine": "3d", "entry": "src/main.tsx"}
Set "engine": "3d" so the studio knows this is a three.js game. Choose "target" and "theme" to match the request (default to "desktop" and "dark" when unclear), and "entry" is the bootstrap module, normally "src/main.tsx".

CRITICAL RUNTIME & TOKEN LIMIT RULES:
1. Single Level First: Always start by generating Level 1 (MVP) with a working core game loop instead of generating multi-level systems in the first response. Levels 2+ are follow-up requests the user will make later. A single polished, playable level is a success; an ambitious half-written game is a failure.
2. Concise Procedural Code: Do NOT write verbose or repetitive geometric coordinates. Use loops, arrays, and map() to procedurally generate platforms, obstacles, and level layouts. Keep every file tight and focused — the preview compiles on the fly, so compact standard code is expected.
3. Zero Pre-Explanations: Do NOT write intro text, conversational planning, or commentary before the code. Write the files directly with your file tools and move on. Every token spent on prose is a token not spent on the game itself.

${APP_GAME_PROJECT_CONVENTIONS}`;

export const APP_GAME_UPDATE_SYSTEM_PROMPT = `You are the 3D Game Studio engine behind BloxMind's App Studio. A user already has a working React Three Fiber game living in your app folder on disk and asked you to change, extend, or improve it. Apply the change to the EXISTING game on disk.

WORK FROM DISK, NEVER FROM MEMORY:
- First READ the current files in your app folder to ground yourself in what actually exists before editing anything.
- You are UPDATING an existing game, not creating a new one. Preserve the game's identity (name, target, theme, entry) and never touch files the change doesn't require. Never rewrite the whole project — only the files the request needs.
- Context retention: keep existing mechanics, physics configs, and scores intact unless the user explicitly asked to rewrite them.
- Isolated feature addition: inject requested features (weapons, dynamic weather, power-ups, AI enemies) modularly into the existing component structure without breaking state or syntax.
- Bug fixing: if the user reports a runtime error or console bug, diagnose the R3F/Rapier lifecycle mismatch immediately and deliver a clean, fully patched build.
- Preserved state on update: retain existing working features, localStorage hooks, and UI layouts without throwing runtime module errors (never remove a file or export another module still imports, never break an import path).
- Edit or create only the files the change requires, in place, with your file tools. Example tool pattern: read a file, edit it, write the changed file back; create new files for new modules.
- If the change needs a new dependency, script, or config, update package.json (and any config files) accordingly.
- Update "bloxmind.json" at the app folder root so its manifest stays in sync (name, description, target, theme, engine, entry).

CRITICAL RUNTIME & TOKEN LIMIT RULES:
1. Single Level First: Keep the existing scope. Do not expand a single-level game into a multi-level system — the user will ask for levels separately.
2. Concise Procedural Code: Edit surgically. Do NOT rewrite the whole project, do NOT emit verbose or repetitive geometry — use loops and arrays where level data repeats. Compact, on-the-fly-compilable code is expected.
3. Zero Pre-Explanations: Do NOT write intro text, conversational planning, or commentary. Apply the change with your file tools and move on.

${APP_GAME_PROJECT_CONVENTIONS}

The user's change request is provided in the message you receive.`;

/** Determine which rendering stack a request targets: 3D game or 2D web app. */
export function looksLikeGameRequest(text: string): boolean {
  const lower = text.toLowerCase();
  // Explicit engine mentions always win, so "game" never gets misrouted by a
  // tangential phrase like "build a website about game reviews".
  if (/\b(3d|three\.js|threejs|react three fiber)\b/.test(lower)) return true;
  return /\b(playable game|video game|web game|3d game|game with|build me a game|create a game|make a game|a game where|puzzle game|platformer|racing game|fps|first[- ]person shooter|physics game|sandbox game)\b/.test(
    lower,
  );
}

/** Render a project's files so the model can edit them during an update turn. */
export function serializeProject(project: AppProject): string {
  const fileBlocks = project.files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n");
  return `Project "${project.name}" (entry: ${project.entry})\n${fileBlocks}`;
}

/**
 * Fold an update response over the current project. The model only returns the
 * files it touched; everything else keeps its existing content, and the
 * project's identity (name/description/target/theme/engine/entry) is preserved.
 */
export function mergeUpdatedProject(existing: AppProject, patch: AppProject): AppProject {
  const files = new Map(existing.files.map((file) => [file.path, file]));
  for (const file of patch.files) files.set(file.path, file);
  return {
    name: existing.name,
    description: existing.description,
    target: existing.target,
    theme: existing.theme,
    engine: existing.engine,
    entry: existing.entry,
    files: Array.from(files.values()),
  };
}

/** Normalize a path to a canonical POSIX form (no leading ./ or trailing /). */
export function normalizeProjectPath(value: string): string {
  const cleaned = value
    .replace(/\\/g, "/")
    .split("/")
    .reduce<string[]>((parts, segment) => {
      if (segment === "" || segment === ".") return parts;
      if (segment === "..") {
        parts.pop();
        return parts;
      }
      parts.push(segment);
      return parts;
    }, [])
    .join("/");
  return cleaned;
}

/** Validate and normalize the model's structured output into an AppProject. */
export function parseAppProject(value: unknown): AppProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The generator returned an invalid app project.");
  }
  const raw = value as Record<string, unknown>;
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 64)
      : "Generated App";
  const description = typeof raw.description === "string" ? raw.description.slice(0, 400) : "";
  const target: AppTarget = raw.target === "mobile" ? "mobile" : "desktop";
  const theme: AppThemeMode = raw.theme === "light" ? "light" : "dark";
  const engine: AppEngine = raw.engine === "3d" ? "3d" : "web";
  const entry =
    typeof raw.entry === "string" && raw.entry.trim() ? raw.entry.trim() : "src/main.tsx";

  const files: AppGeneratedFile[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.files)) {
    for (const candidate of raw.files) {
      if (!candidate || typeof candidate !== "object") continue;
      const file = candidate as Record<string, unknown>;
      if (typeof file.path !== "string" || typeof file.content !== "string") continue;
      const path = normalizeProjectPath(file.path);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      files.push({ path, content: file.content });
    }
  }

  if (files.length === 0) {
    throw new Error("The generator produced an empty project.");
  }
  return { name, description, target, theme, engine, entry, files };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  // If the whole text is one fenced block, strip the delimiters.
  if (/^```(?:json)?\s*[\s\S]*\s*```$/.test(trimmed)) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  // Otherwise pull the first fenced JSON block out of surrounding prose.
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : trimmed;
}

/**
 * OpenCode asks schema-less models to wrap their JSON in literal
 * `<structured_output>` tags; when extraction fails those tags leak into the
 * text parts, so unwrap them before attempting to parse.
 */
function unwrapStructuredOutputTag(text: string): string {
  const match = text.match(/<structured_output>\s*([\s\S]*?)\s*<\/structured_output>/i);
  return match ? match[1].trim() : text;
}

/** Pull the outermost JSON object out of a response (first `{` to last `}`). */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  const end = text.lastIndexOf("}");
  return text.slice(start, end === -1 ? text.length : end + 1);
}

/**
 * Lenient repair for the JSON models actually emit: strips trailing commas,
 * converts raw newlines/tabs inside strings (invalid in strict JSON), and
 * closes unclosed structures when the output was truncated before the closing
 * braces. Returns null when there is no JSON object to repair.
 */
export function repairAppJson(text: string): string | null {
  const source = extractJsonObject(text);
  if (source === null) return null;

  let out = "";
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === "\n" || ch === "\t" || ch === "\r") {
        out += ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : "\\r";
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
      out += ch;
    } else if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if (open && ((open === "{" && ch === "}") || (open === "[" && ch === "]"))) {
        out = out.replace(/,\s*$/, "");
      }
      out += ch;
    } else {
      out += ch;
    }
  }

  if (inString) out += '"';
  while (stack.length) {
    const open = stack.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}

/**
 * Resolve the generated project from a prompt response. Structured output is
 * preferred, but providers without schema-mode support leave `structured`
 * undefined (sometimes with a StructuredOutputError on the message) while the
 * raw text still holds the JSON, so fall back to parsing the text parts.
 */
export function resolveAppProject(
  info:
    | { structured?: unknown; error?: { name?: string; data?: { message?: string } } }
    | undefined,
  parts: Array<{ type: string; text?: unknown }> | undefined,
): AppProject {
  if (info?.structured !== undefined) {
    try {
      return parseAppProject(info.structured);
    } catch {
      // Structured output came back unusable; fall back to the text parts.
    }
  }

  const text = (parts ?? [])
    .filter(
      (part): part is { type: string; text: string } =>
        part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
    )
    .map((part) => part.text.trim())
    .join("\n")
    .trim();

  if (!text) {
    if (info?.error?.name === "StructuredOutputError") {
      const detail = info.error.data?.message;
      throw new Error(
        `The model couldn't produce structured output${detail ? ` (${detail})` : ""}. Try a different model for app generation.`,
      );
    }
    throw new Error("The generator returned an empty response.");
  }

  const unwrapped = unwrapStructuredOutputTag(text);
  const candidates = [
    ...new Set([unwrapped, stripCodeFence(unwrapped), text, stripCodeFence(text)]),
  ];
  for (const candidateText of candidates) {
    try {
      return parseAppProject(JSON.parse(candidateText));
    } catch {
      // Not strict JSON — try the repaired version next.
    }
    const repaired = repairAppJson(candidateText);
    if (repaired && repaired !== candidateText) {
      try {
        return parseAppProject(JSON.parse(repaired));
      } catch {
        // Repaired JSON didn't yield a valid project either; try the next candidate.
      }
    }
  }

  const hint = text.length > 160 ? `${text.slice(0, 160)}…` : text;
  throw new Error(
    `The generator returned an invalid app project. Raw model output began: "${hint.replace(/\s+/g, " ")}"`,
  );
}

/**
 * Errors worth one automatic retry. These are model/SDK flakiness that can
 * resolve themselves on a fresh turn (empty / unusable structured output),
 * as opposed to cancellations, engine failures, or hard validation errors.
 */
export function isTransientGenerationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /empty response|invalid app project|couldn't produce structured output/i.test(error.message) ||
    error.message === "The generator returned an empty response."
  );
}

/** Convert an arbitrary string into a safe lowercase npm package / zip name. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "my-app";
}
