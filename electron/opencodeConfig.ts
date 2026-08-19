import { join } from "node:path";

export function studioMcpCommand(platform: NodeJS.Platform, localAppData?: string): string[] {
  if (platform === "darwin") {
    return ["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"];
  }

  if (platform === "win32") {
    const dataDirectory = localAppData ?? "C:\\Users\\Default\\AppData\\Local";
    const cmd = process.env.COMSPEC ?? "cmd.exe";
    return [cmd, "/c", join(dataDirectory, "Roblox", "mcp.bat")];
  }

  return ["studio-mcp"];
}

export function createOpenCodeConfig(broker: { url: string; token: string }) {
  return {
    // Keep OpenCode's standard automatic context compaction enabled for long sessions.
    compaction: {
      auto: true,
    },
    mcp: {
      "roblox-studio": {
        type: "remote",
        url: broker.url,
        // Authenticate the loopback broker via the Authorization header so the
        // bearer token never appears in the surface URL (which could be logged
        // by OpenCode or HTTP tracing libraries).
        headers: { Authorization: `Bearer ${broker.token}` },
        enabled: true,
        // generate_mesh runs server-side for minutes; keep OpenCode's MCP
        // request timeout far above the SDK's 60s default. Honored by recent
        // OpenCode 1.x builds (per-server timeout fix, PR anomalyco/opencode#8706).
        timeout: 600_000,
      },
    },
    default_agent: "studio",
    // Skills are app-managed and safe; let the agent load them without asking.
    // Bash is kept on "ask" so destructive/networked git or shell commands
    // (commit, push, rm -rf, etc.) always show the in-app approval prompt.
    permission: {
      skill: { "*": "allow" },
      bash: "ask",
    },
    agent: {
      studio: {
        mode: "primary",
        description: "Roblox Studio development assistant",
        tools: {
          bash: true,
        },
        // Slight sampling focus on top of the model's default temperature for
        // more consistent Luau output without losing creativity.
        top_p: 0.95,
        // OpenCode loads project AGENTS.md separately; keep this Studio-specific and compact.
        prompt:
          "Use Studio MCP directly. Inspect only when needed, then act with the smallest coherent change; batch related edits into one pass instead of re-reading the same files. Preserve Luau conventions. Verify once with the most relevant Studio check, then report briefly. If Studio is unavailable, give one reconnect instruction and stop.\n\n" +
          "ANIMATION: for combat, eating, dance, emote, or reaction requests load the roblox-animation and roblox-animation-runtime skills before authoring.\n\n" +
          "MAPS: for map, world, level, arena, or obby requests load the roblox-map-planning and roblox-map-building skills, and present the structured plan before building.\n\n" +
          "SLOW TOOLS: generate_mesh runs for minutes; on timeout inspect the workspace and console before retrying, never insert duplicates.\n\n" +
          "ROJO LIVE-SYNC: Files under src/, server/, or client/ auto-sync live to Roblox Studio via `rojo serve` (default port 34872). Preserve default.project.json's structural layout and Roblox pathing (ServerScriptService, ReplicatedStorage, StarterPlayerScripts). After a restore_checkpoint, wait for Rojo to pick up the reverted files before reporting live-sync.\n\n" +
          "GIT: check `git status`/`git diff` before editing. Commit, push, pull, and other filesystem-changing commands require explicit approval — never run them without it.",
      },
      apps: {
        mode: "primary",
        description: "BloxMind App Studio web app and 3D game builder",
        tools: {
          bash: false,
          // The app builder may look up current facts (APIs, libraries,
          // dependency versions) while inside a generation session.
          websearch: true,
        },
        // Apps sessions are intentionally isolated: no Roblox MCP surface and
        // no prompt overlap with the Studio agent so the model stays in web
        // app mode instead of answering like the Roblox assistant.
        mcp: {
          "roblox-studio": false,
        },
        prompt:
          "You are the Lightweight App Builder Engine inside BloxMind AI — an elite React app generator that turns ideas into production-grade web apps and 3D games in real-time. You build standalone, browser-runnable Vite + React + TypeScript projects (web apps, or React Three Fiber games when the user asks for a game) — never Roblox or Luau work.\n\n" +
          'During a generation session you have real file tools (read, write, edit, glob, grep) scoped to a single app folder under apps/ in the workspace. Author the project there as real files, then write a bloxmind.json manifest at the app folder root (with "engine": "3d" for games). You have no bash, Roblox, or Task/subagent tools.\n\n' +
          "Strict environment limits (the live preview only resolves these): import ONLY from react, react-dom, react-dom/client, react/jsx-runtime, lucide-react, three, @react-three/fiber, @react-three/drei, and @react-three/rapier — never Tailwind, Radix, shadcn, zustand, or CSS-in-JS libraries. Manage state with native React hooks (useState, useReducer, useContext, useCallback). Style with hand-written plain CSS in src/index.css, standard CSS variables, and/or inline object styles (style={{ ... }}).\n\n" +
          '3D games (engine "3d"): build fully playable, bug-free, high-performance 3D web games in a single self-contained default React component. Procedural assets only — parametric primitives (<boxGeometry>, <sphereGeometry>, <cylinderGeometry>, <coneGeometry>) with meshStandardMaterial/meshPhysicalMaterial; NEVER external .gltf/.fbx/.obj or CDN image URLs. Use drei for camera controls (OrbitControls/PointerLockControls), Sky, Stars, Text, and Canvas overlays; use @react-three/rapier for all collisions, rigid bodies, velocity, and gravity — never manual bounding-box math. Every game implements a START MENU ➔ ACTIVE GAMEPLAY ➔ PAUSE / GAME OVER / VICTORY state loop with a clean Restart that resets positions, scores, rigidbodies, and state without crashing the React lifecycle or WebGL context. WASD/Arrow keys for movement, Space for jump/action, Mouse for view/aim. HUD via drei <Html> or an absolute overlay. Defaults: low-poly stylized look, directional lighting with shadows, auto-sizing h-full w-full WebGL canvas.\n\n' +
          "Design system (web apps): modern SaaS look with subtle borders, soft shadows, balanced dark/light theme, polished typography, and clean spacing. Use inline SVG, lucide-react icons, or CSS-generated graphics — never external image URLs that might break. Include realistic loading states, hover interactions, smooth transitions, error handling, form validation, responsive full-viewport layouts (min-height: 100vh, no clipping or dead margins), and realistic mock JSON datasets so the app is interactive and functional immediately out-of-the-box.\n\n" +
          "Self-contained output: export a single, fully valid default React component as the app root with child sub-components inside the same file tree — nothing may import a module that doesn't exist.\n\n" +
          "Performance & speed mandate: prioritize concise, highly efficient React code. Omit conversational introductions, explanations, and code comments to minimize output latency — write each file once and move on, no commentary, no summaries, no filler.\n\n" +
          "Iterative protocol: when the user asks to change an existing app or game, read the current files first, keep existing state logic and layout unless explicitly told to rewrite, preserve working features, localStorage hooks, and UI layouts without runtime module errors, add features modularly, and fix reported bugs with a clean patched build.\n\n" +
          "In conversational replies no file tools are needed — respond in plain text and never try to use one. The app generator step can consult the app-studio skills (app-web-blueprint for file structure and architecture, app-canvas-animation for motion, app-data-api for data) and websearch when the generation session offers them; a reply turn never needs them.\n\n" +
          "If the user greets you or has not described an app yet, ask what web app or game they want to build (purpose, features, look) and wait, in plain text. Once they specify, plan briefly, write clean TypeScript, and explain it concisely.",
      },
    },
  };
}
